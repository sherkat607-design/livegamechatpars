import type { Server as HttpServer } from 'node:http';
import { and, eq, inArray, ne } from 'drizzle-orm';
import { Server as IOServer, type Socket } from 'socket.io';
import { has, P } from '@shared/permissions';
import type { AppContext } from '../context';
import {
  channelRecipients,
  channels,
  members,
  overwrites,
  relationships,
  roles,
  users,
  type ChannelRow,
  type UserRow,
} from '../db/schema';
import { filterViewers, loadChannelAccess } from '../lib/access';
import { COOKIE_NAME } from '../lib/auth';
import { dmChannelDto } from '../lib/dms';
import { publicUser } from '../lib/serialize';
import { VoiceManager } from './voice';

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    try {
      out[key] = decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      out[key] = part.slice(i + 1).trim();
    }
  }
  return out;
}

export class Gateway {
  readonly io: IOServer;
  readonly voice: VoiceManager;
  /** Last relayed typing event per `${userId}:${channelId}` (anti-spam). */
  private typingAt = new Map<string, number>();

  constructor(
    private app: AppContext,
    httpServer: HttpServer,
  ) {
    this.io = new IOServer(httpServer, {
      path: '/socket.io',
      serveClient: false,
      maxHttpBufferSize: 256 * 1024,
      cors: { origin: app.config.corsOrigins, credentials: false },
      pingInterval: 20000,
      pingTimeout: 20000,
    });
    this.voice = new VoiceManager(app, this);

    this.io.use(async (socket, next) => {
      const token =
        (typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined) ??
        parseCookies(socket.handshake.headers.cookie)[COOKIE_NAME];
      const user = await app.auth.userFromToken(token);
      if (!user) return next(new Error('unauthorized'));
      socket.data.userId = user.id;
      next();
    });
    this.io.on('connection', (socket) => {
      this.onConnection(socket).catch((err) => console.error('gateway connection error', err));
    });
  }

  // ---------- emit helpers used by routes ----------

  toUser(userIds: number | number[], event: string, data: unknown) {
    const ids = Array.isArray(userIds) ? userIds : [userIds];
    if (ids.length) this.io.to(ids.map((id) => `user:${id}`)).emit(event, data);
  }

  toServer(serverId: number, event: string, data: unknown) {
    this.io.to(`server:${serverId}`).emit(event, data);
  }

  async onlineUserIds(room: string): Promise<number[]> {
    const sockets = await this.io.in(room).fetchSockets();
    return [...new Set(sockets.map((s) => s.data.userId as number))];
  }

  /** Emit to everyone who can see a channel (DM recipients or permitted server members). */
  async toChannel(channel: ChannelRow, event: string, data: unknown, recipientIds?: number[]) {
    const { db } = this.app;
    if (channel.type === 'dm' || channel.type === 'group_dm') {
      const ids =
        recipientIds ??
        (await db.select({ userId: channelRecipients.userId }).from(channelRecipients).where(eq(channelRecipients.channelId, channel.id))).map(
          (r) => r.userId,
        );
      this.toUser(ids, event, data);
      return;
    }
    if (!channel.serverId) return;
    if (await this.everyoneCanView(channel)) {
      this.toServer(channel.serverId, event, data);
      return;
    }
    const online = await this.onlineUserIds(`server:${channel.serverId}`);
    this.toUser(await filterViewers(db, channel, online), event, data);
  }

  /** Fast path: no overwrite hides the channel and @everyone can view it. */
  private async everyoneCanView(channel: ChannelRow): Promise<boolean> {
    const { db } = this.app;
    const sourceId = channel.type === 'thread' && channel.parentId ? channel.parentId : channel.id;
    const ows = await db.select().from(overwrites).where(eq(overwrites.channelId, sourceId));
    if (ows.some((o) => (o.deny & P.VIEW_CHANNEL) !== 0)) return false;
    const [everyone] = await db
      .select()
      .from(roles)
      .where(and(eq(roles.serverId, channel.serverId!), eq(roles.isDefault, true)));
    if (!everyone) return false;
    const everyoneOw = ows.find((o) => o.targetType === 'role' && o.targetId === everyone.id);
    return (
      has(everyone.permissions, P.VIEW_CHANNEL) ||
      has(everyone.permissions, P.ADMINISTRATOR) ||
      (!!everyoneOw && (everyoneOw.allow & P.VIEW_CHANNEL) !== 0)
    );
  }

  addToServer(userId: number, serverId: number) {
    this.io.in(`user:${userId}`).socketsJoin(`server:${serverId}`);
  }

  removeFromServer(userId: number, serverId: number) {
    this.io.in(`user:${userId}`).socketsLeave(`server:${serverId}`);
  }

  /** Un-hide a DM for recipients who closed it, so a new message shows up. */
  async revealDm(channelId: number, recipientIds: number[]) {
    const { db } = this.app;
    const revealed = await db
      .update(channelRecipients)
      .set({ hidden: false })
      .where(and(eq(channelRecipients.channelId, channelId), eq(channelRecipients.hidden, true)))
      .returning({ userId: channelRecipients.userId });
    if (revealed.length === 0) return;
    const [channel] = await db.select().from(channels).where(eq(channels.id, channelId));
    if (!channel) return;
    const dto = await dmChannelDto(this.app, channel);
    this.toUser(
      revealed.map((r) => r.userId).filter((id) => recipientIds.includes(id)),
      'channel:create',
      dto,
    );
  }

  /** Tell friends, people with pending requests and fellow members about a profile/presence change. */
  async broadcastUser(user: UserRow) {
    const { db, presence } = this.app;
    const dto = publicUser(user, presence);
    const [rels, memberships] = await Promise.all([
      db
        .select({ userId: relationships.userId })
        .from(relationships)
        .where(and(eq(relationships.targetId, user.id), ne(relationships.type, 'blocked'))),
      db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, user.id)),
    ]);
    const rooms = [
      `user:${user.id}`,
      ...rels.map((r) => `user:${r.userId}`),
      ...memberships.map((m) => `server:${m.serverId}`),
    ];
    this.io.to(rooms).emit('user:update', dto);
  }

  async broadcastUserById(userId: number) {
    const [user] = await this.app.db.select().from(users).where(eq(users.id, userId));
    if (user) await this.broadcastUser(user);
  }

  /** Force-disconnect every socket of a user (password change, account deletion). */
  disconnectUser(userId: number) {
    this.io.in(`user:${userId}`).disconnectSockets(true);
  }

  // ---------- connection lifecycle ----------

  private async onConnection(socket: Socket) {
    const { db, presence } = this.app;
    const userId = socket.data.userId as number;
    socket.join(`user:${userId}`);
    const memberships = await db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, userId));
    for (const m of memberships) socket.join(`server:${m.serverId}`);
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    if (!user) {
      socket.disconnect(true);
      return;
    }
    const before = presence.statusOf(userId);
    presence.connect(userId, socket.id, user.status);
    if (presence.statusOf(userId) !== before) await this.broadcastUser(user);
    socket.emit('ready', { userId });

    socket.on('typing', (payload: { channelId?: unknown }) => {
      this.onTyping(socket, payload).catch(() => undefined);
    });

    socket.on('idle', async (idle: unknown) => {
      const was = presence.statusOf(userId);
      presence.setIdle(socket.id, idle === true);
      if (presence.statusOf(userId) !== was) await this.broadcastUserById(userId);
    });

    socket.on('voice:join', async (payload: { channelId?: unknown }, ack?: (res: unknown) => void) => {
      const result = await this.voice.join(socket, Number(payload?.channelId)).catch(() => ({ ok: false, error: 'failed' }));
      if (typeof ack === 'function') ack(result);
    });
    socket.on('voice:leave', () => {
      this.voice.leaveSocket(socket.id).catch(() => undefined);
    });
    socket.on('voice:update', (patch: unknown) => {
      this.voice.update(socket, patch).catch(() => undefined);
    });
    socket.on('voice:signal', (payload: { to?: unknown; data?: unknown }) => {
      this.voice.signal(socket, Number(payload?.to), payload?.data);
    });

    socket.on('disconnect', async () => {
      await this.voice.leaveSocket(socket.id).catch(() => undefined);
      const was = presence.statusOf(userId);
      presence.disconnect(userId, socket.id);
      if (!presence.isOnline(userId)) {
        for (const key of this.typingAt.keys()) if (key.startsWith(`${userId}:`)) this.typingAt.delete(key);
      }
      if (presence.statusOf(userId) !== was) await this.broadcastUserById(userId).catch(() => undefined);
    });
  }

  private async onTyping(socket: Socket, payload: { channelId?: unknown }) {
    const userId = socket.data.userId as number;
    const channelId = Number(payload?.channelId);
    if (!Number.isInteger(channelId) || channelId <= 0) return;
    const key = `${userId}:${channelId}`;
    const now = Date.now();
    if (now - (this.typingAt.get(key) ?? 0) < 2000) return;
    this.typingAt.set(key, now);
    const access = await loadChannelAccess(this.app.db, channelId, userId);
    if (!has(access.perms, P.SEND_MESSAGES)) return;
    await this.toChannel(access.channel, 'typing', { channelId, userId }, access.isDm ? access.recipientIds : undefined);
  }

  /** A sent message ends "typing", so the next keystroke may be relayed right away. */
  clearTypingThrottle(userId: number, channelId: number) {
    this.typingAt.delete(`${userId}:${channelId}`);
  }

  /** Users currently online in a set of user ids. */
  onlineOf(userIds: number[]): number[] {
    return userIds.filter((id) => this.app.presence.isOnline(id));
  }

  /** Members (ids) of a server, for counts. */
  async memberIds(serverId: number): Promise<number[]> {
    const rows = await this.app.db.select({ userId: members.userId }).from(members).where(eq(members.serverId, serverId));
    return rows.map((r) => r.userId);
  }

  /** Recipient ids of a DM channel. */
  async recipientIds(channelIds: number[]): Promise<Map<number, number[]>> {
    const map = new Map<number, number[]>();
    if (!channelIds.length) return map;
    const rows = await this.app.db
      .select()
      .from(channelRecipients)
      .where(inArray(channelRecipients.channelId, channelIds));
    for (const r of rows) map.set(r.channelId, [...(map.get(r.channelId) ?? []), r.userId]);
    return map;
  }

  close() {
    this.io.close();
  }
}
