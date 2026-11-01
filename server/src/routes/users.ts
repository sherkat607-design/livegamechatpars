import { and, eq, inArray, ne } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS, USERNAME_RE } from '@shared/constants';
import type { RelationshipType, UserProfile } from '@shared/types';
import type { AppContext } from '../context';
import { members, relationships, servers, users } from '../db/schema';
import { hashPassword, verifyPassword } from '../lib/auth';
import { badRequest, conflict, forbidden, intParam, notFound, parse } from '../lib/errors';
import { publicUser, selfUser } from '../lib/serialize';

const profileSchema = z.object({
  displayName: z.string().trim().min(1).max(LIMITS.displayNameMax).optional(),
  username: z.string().trim().toLowerCase().regex(USERNAME_RE).optional(),
  bio: z.string().max(LIMITS.bioMax).optional(),
  customStatus: z.string().max(LIMITS.customStatusMax).optional(),
  activity: z.string().max(LIMITS.activityMax).optional(),
  status: z.enum(['online', 'idle', 'dnd', 'invisible']).optional(),
  bannerColor: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  locale: z.enum(['fa', 'en']).optional(),
});

export default async function userRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };

  app.get('/api/users/:id', authed, async (req): Promise<UserProfile> => {
    const id = intParam((req.params as { id: string }).id);
    const [user] = await ctx.db.select().from(users).where(eq(users.id, id));
    if (!user) throw notFound('unknown_user');
    const me = req.user.id;
    const [rel] = await ctx.db
      .select()
      .from(relationships)
      .where(and(eq(relationships.userId, me), eq(relationships.targetId, id)));
    const myServers = await ctx.db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, me));
    const theirServers = await ctx.db.select({ serverId: members.serverId }).from(members).where(eq(members.userId, id));
    const theirs = new Set(theirServers.map((s) => s.serverId));
    const mutualIds = myServers.map((s) => s.serverId).filter((s) => theirs.has(s));
    const mutualServers = mutualIds.length
      ? await ctx.db.select({ id: servers.id, name: servers.name, icon: servers.icon }).from(servers).where(inArray(servers.id, mutualIds))
      : [];
    let mutualFriends: UserProfile['mutualFriends'] = [];
    if (id !== me) {
      const myFriends = await ctx.db
        .select({ id: relationships.targetId })
        .from(relationships)
        .where(and(eq(relationships.userId, me), eq(relationships.type, 'friend')));
      const theirFriends = await ctx.db
        .select({ id: relationships.targetId })
        .from(relationships)
        .where(and(eq(relationships.userId, id), eq(relationships.type, 'friend')));
      const set = new Set(theirFriends.map((f) => f.id));
      const ids = myFriends.map((f) => f.id).filter((f) => set.has(f));
      if (ids.length) {
        const rows = await ctx.db.select().from(users).where(inArray(users.id, ids));
        mutualFriends = rows.map((u) => publicUser(u, ctx.presence));
      }
    }
    return {
      user: publicUser(user, ctx.presence),
      relationship: (rel?.type as RelationshipType) ?? null,
      mutualServers,
      mutualFriends,
    };
  });

  app.patch('/api/users/me', authed, async (req) => {
    const body = parse(profileSchema, req.body);
    if (body.username && body.username !== req.user.username) {
      const [taken] = await ctx.db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.username, body.username), ne(users.id, req.user.id)));
      if (taken) throw conflict('username_taken', 'Username is taken');
    }
    const [user] = await ctx.db.update(users).set(body).where(eq(users.id, req.user.id)).returning();
    if (body.status) ctx.presence.setPreferred(user.id, body.status);
    await ctx.gateway.broadcastUser(user);
    return { user: selfUser(user, ctx.presence) };
  });

  app.put('/api/users/me/avatar', authed, async (req) => {
    const file = await req.file({ limits: { fileSize: LIMITS.imageMaxBytes + 1 } });
    if (!file) throw badRequest('missing_file');
    const stored = await ctx.uploads.saveImage(await file.toBuffer(), 'avatar', LIMITS.imageMaxBytes);
    await ctx.uploads.remove(req.user.avatar);
    const [user] = await ctx.db.update(users).set({ avatar: stored.url }).where(eq(users.id, req.user.id)).returning();
    await ctx.gateway.broadcastUser(user);
    return { user: selfUser(user, ctx.presence) };
  });

  app.delete('/api/users/me/avatar', authed, async (req) => {
    await ctx.uploads.remove(req.user.avatar);
    const [user] = await ctx.db.update(users).set({ avatar: null }).where(eq(users.id, req.user.id)).returning();
    await ctx.gateway.broadcastUser(user);
    return { user: selfUser(user, ctx.presence) };
  });

  app.post('/api/users/me/password', authed, async (req, reply) => {
    const body = parse(
      z.object({
        currentPassword: z.string().min(1).max(LIMITS.passwordMax),
        newPassword: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
      }),
      req.body,
    );
    if (!(await verifyPassword(body.currentPassword, req.user.passwordHash))) throw forbidden('invalid_password');
    const [user] = await ctx.db
      .update(users)
      .set({ passwordHash: await hashPassword(body.newPassword), tokenVersion: req.user.tokenVersion + 1 })
      .where(eq(users.id, req.user.id))
      .returning();
    // Sign out other devices, keep this one signed in.
    ctx.gateway.disconnectUser(user.id);
    const token = await ctx.auth.setCookie(reply, user);
    return { ok: true, token };
  });

  app.delete('/api/users/me', authed, async (req, reply) => {
    const body = parse(z.object({ password: z.string().min(1).max(LIMITS.passwordMax) }), req.body);
    if (!(await verifyPassword(body.password, req.user.passwordHash))) throw forbidden('invalid_password');
    const owned = await ctx.db.select({ id: servers.id }).from(servers).where(eq(servers.ownerId, req.user.id));
    if (owned.length) throw badRequest('owns_servers', 'Delete or transfer your servers first');
    await ctx.gateway.voice.leave(req.user.id);
    await ctx.uploads.remove(req.user.avatar);
    await ctx.db.delete(users).where(eq(users.id, req.user.id));
    ctx.gateway.disconnectUser(req.user.id);
    ctx.auth.clearCookie(reply);
    return { ok: true };
  });
}
