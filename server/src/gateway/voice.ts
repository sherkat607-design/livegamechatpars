import type { Socket } from 'socket.io';
import { has, P } from '@shared/permissions';
import type { VoiceParticipant } from '@shared/types';
import type { AppContext } from '../context';
import type { ChannelRow } from '../db/schema';
import { loadChannelAccess } from '../lib/access';
import { isBlockedBetween } from '../lib/dms';
import { createMessage } from '../lib/messages';
import type { Gateway } from './index';

interface Session extends VoiceParticipant {
  socketId: string;
  canVideo: boolean;
}

interface Room {
  channel: ChannelRow;
  recipientIds: number[];
  sessions: Map<number, Session>;
}

export type JoinResult =
  | { ok: true; participants: VoiceParticipant[]; iceServers: AppContext['config']['iceServers'] }
  | { ok: false; error: string };

const MAX_SIGNAL_BYTES = 64 * 1024;

function strip(s: Session): VoiceParticipant {
  const { socketId: _s, canVideo: _c, ...rest } = s;
  return rest;
}

/** Tracks voice channel membership and relays WebRTC signaling between participants. */
export class VoiceManager {
  private rooms = new Map<number, Room>();
  private byUser = new Map<number, Session>();

  constructor(
    private app: AppContext,
    private gw: Gateway,
  ) {}

  participants(channelId: number): VoiceParticipant[] {
    return [...(this.rooms.get(channelId)?.sessions.values() ?? [])].map(strip);
  }

  /** Participants of the given channels (used by bootstrap and server fetches). */
  participantsIn(channelIds: number[]): VoiceParticipant[] {
    return channelIds.flatMap((id) => this.participants(id));
  }

  sessionOf(userId: number): VoiceParticipant | null {
    const s = this.byUser.get(userId);
    return s ? strip(s) : null;
  }

  async join(socket: Socket, channelId: number): Promise<JoinResult> {
    const userId = socket.data.userId as number;
    if (!Number.isInteger(channelId) || channelId <= 0) return { ok: false, error: 'unknown_channel' };
    let access;
    try {
      access = await loadChannelAccess(this.app.db, channelId, userId);
    } catch {
      return { ok: false, error: 'unknown_channel' };
    }
    const { channel } = access;
    if (!['voice', 'dm', 'group_dm'].includes(channel.type)) return { ok: false, error: 'not_voice_channel' };
    if (!has(access.perms, P.CONNECT)) return { ok: false, error: 'missing_permissions' };
    if (channel.type === 'dm') {
      const other = access.recipientIds.find((id) => id !== userId);
      if (other && (await isBlockedBetween(this.app, userId, other))) return { ok: false, error: 'blocked' };
    }

    const existing = this.byUser.get(userId);
    if (existing) {
      if (existing.channelId === channelId && existing.socketId === socket.id) {
        return { ok: true, participants: this.others(channelId, userId), iceServers: this.app.config.iceServers };
      }
      // Joining from another tab or channel: drop the old session first.
      if (existing.socketId !== socket.id) this.gw.io.to(existing.socketId).emit('voice:kicked', { channelId: existing.channelId });
      await this.leave(userId);
    }

    let room = this.rooms.get(channelId);
    const firstInCall = !room || room.sessions.size === 0;
    if (!room) {
      room = { channel, recipientIds: access.recipientIds, sessions: new Map() };
      this.rooms.set(channelId, room);
    }
    const session: Session = {
      userId,
      channelId,
      serverId: channel.serverId,
      selfMute: false,
      selfDeaf: false,
      serverMute: !has(access.perms, P.SPEAK),
      serverDeaf: false,
      video: false,
      screen: false,
      streams: {},
      joinedAt: new Date().toISOString(),
      socketId: socket.id,
      canVideo: has(access.perms, P.VIDEO),
    };
    room.sessions.set(userId, session);
    this.byUser.set(userId, session);
    await this.broadcast(room);

    if (firstInCall && (channel.type === 'dm' || channel.type === 'group_dm')) {
      const others = access.recipientIds.filter((id) => id !== userId);
      this.gw.toUser(others, 'call:ring', { channelId, from: userId });
      await createMessage(this.app, {
        channel,
        authorId: userId,
        content: '',
        type: 'call',
        recipientIds: access.recipientIds,
      }).catch(() => undefined);
    }
    return { ok: true, participants: this.others(channelId, userId), iceServers: this.app.config.iceServers };
  }

  private others(channelId: number, userId: number): VoiceParticipant[] {
    return this.participants(channelId).filter((p) => p.userId !== userId);
  }

  async leave(userId: number) {
    const session = this.byUser.get(userId);
    if (!session) return;
    this.byUser.delete(userId);
    const room = this.rooms.get(session.channelId);
    if (!room) return;
    room.sessions.delete(userId);
    await this.broadcast(room);
    if (room.sessions.size === 0) this.rooms.delete(session.channelId);
  }

  async leaveSocket(socketId: string) {
    for (const s of this.byUser.values()) {
      if (s.socketId === socketId) {
        await this.leave(s.userId);
        return;
      }
    }
  }

  async update(socket: Socket, patch: unknown) {
    const userId = socket.data.userId as number;
    const s = this.byUser.get(userId);
    if (!s || s.socketId !== socket.id || typeof patch !== 'object' || patch === null) return;
    const p = patch as Record<string, unknown>;
    if (typeof p.selfMute === 'boolean') s.selfMute = p.selfMute;
    if (typeof p.selfDeaf === 'boolean') s.selfDeaf = p.selfDeaf;
    if (typeof p.video === 'boolean') s.video = p.video && s.canVideo;
    if (typeof p.screen === 'boolean') s.screen = p.screen && s.canVideo;
    if (typeof p.streams === 'object' && p.streams !== null) {
      const st = p.streams as Record<string, unknown>;
      const ok = (v: unknown) => typeof v === 'string' && v.length > 0 && v.length <= 100;
      s.streams = {
        ...(s.video && ok(st.camera) ? { camera: st.camera as string } : {}),
        ...(s.screen && ok(st.screen) ? { screen: st.screen as string } : {}),
      };
    }
    const room = this.rooms.get(s.channelId);
    if (room) await this.broadcast(room);
  }

  /** Relay an SDP offer/answer or ICE candidate to another participant of the same channel. */
  signal(socket: Socket, to: number, data: unknown) {
    const from = socket.data.userId as number;
    const me = this.byUser.get(from);
    const target = this.byUser.get(to);
    if (!me || !target || me.socketId !== socket.id || me.channelId !== target.channelId || from === to) return;
    let size = 0;
    try {
      size = JSON.stringify(data ?? null).length;
    } catch {
      return;
    }
    if (size > MAX_SIGNAL_BYTES) return;
    this.gw.io.to(target.socketId).emit('voice:signal', { from, data });
  }

  /** Server mute / deafen by a moderator. */
  async moderate(userId: number, patch: { serverMute?: boolean; serverDeaf?: boolean }): Promise<boolean> {
    const s = this.byUser.get(userId);
    if (!s) return false;
    if (typeof patch.serverMute === 'boolean') s.serverMute = patch.serverMute;
    if (typeof patch.serverDeaf === 'boolean') s.serverDeaf = patch.serverDeaf;
    const room = this.rooms.get(s.channelId);
    if (room) await this.broadcast(room);
    return true;
  }

  /** Remove a user from voice (moderator disconnect, kick, ban). */
  async kick(userId: number, onlyServerId?: number) {
    const s = this.byUser.get(userId);
    if (!s || (onlyServerId !== undefined && s.serverId !== onlyServerId)) return;
    this.gw.io.to(s.socketId).emit('voice:kicked', { channelId: s.channelId });
    await this.leave(userId);
  }

  /** Everyone leaves (channel deleted). */
  async closeChannel(channelId: number) {
    const room = this.rooms.get(channelId);
    if (!room) return;
    for (const userId of [...room.sessions.keys()]) await this.kick(userId);
  }

  /** Re-check permissions of everyone in a server's voice channels (after role/overwrite changes). */
  async recheckServer(serverId: number) {
    for (const room of [...this.rooms.values()]) {
      if (room.channel.serverId !== serverId) continue;
      for (const s of [...room.sessions.values()]) {
        try {
          const access = await loadChannelAccess(this.app.db, room.channel.id, s.userId);
          if (!has(access.perms, P.CONNECT)) {
            await this.kick(s.userId);
            continue;
          }
          s.canVideo = has(access.perms, P.VIDEO);
          if (!s.canVideo) {
            s.video = false;
            s.screen = false;
            s.streams = {};
          }
        } catch {
          await this.kick(s.userId);
        }
      }
      if (this.rooms.has(room.channel.id)) await this.broadcast(room);
    }
  }

  private async broadcast(room: Room) {
    const payload = {
      channelId: room.channel.id,
      serverId: room.channel.serverId,
      participants: [...room.sessions.values()].map(strip),
    };
    await this.gw.toChannel(room.channel, 'voice:state', payload, room.channel.serverId ? undefined : room.recipientIds);
  }
}
