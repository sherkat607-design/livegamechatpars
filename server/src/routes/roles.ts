import { and, eq, gte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { LIMITS } from '@shared/constants';
import { ALL_PERMISSIONS, has, P } from '@shared/permissions';
import type { AppContext } from '../context';
import { memberRoles, overwrites, roles, type RoleRow } from '../db/schema';
import { requirePerm, requireServerAccess, type ServerAccess } from '../lib/access';
import { audit } from '../lib/audit';
import { refreshServer } from '../lib/bundles';
import { badRequest, forbidden, intParam, notFound, parse } from '../lib/errors';
import { roleDto } from '../lib/serialize';

const roleBody = z.object({
  name: z.string().trim().min(1).max(LIMITS.roleNameMax).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullable()
    .optional(),
  permissions: z.number().int().min(0).max(ALL_PERMISSIONS).optional(),
  hoist: z.boolean().optional(),
  mentionable: z.boolean().optional(),
});

/** Non-admins can only hand out permissions they have themselves. */
function checkGrant(access: ServerAccess, permissions: number | undefined, previous = 0) {
  if (permissions === undefined || access.isOwner || has(access.perms, P.ADMINISTRATOR)) return;
  const added = permissions & ~previous;
  if ((added & ~access.perms) !== 0) throw forbidden('cannot_grant_permissions_you_lack');
}

export default async function roleRoutes(app: FastifyInstance, ctx: AppContext) {
  const authed = { preHandler: ctx.auth.requireUser };
  const { db } = ctx;

  async function loadRole(roleId: number, userId: number): Promise<{ role: RoleRow; access: ServerAccess }> {
    const [role] = await db.select().from(roles).where(eq(roles.id, roleId));
    if (!role) throw notFound('unknown_role');
    const access = await requireServerAccess(db, role.serverId, userId);
    requirePerm(access.perms, P.MANAGE_ROLES);
    return { role, access };
  }

  function requireAbove(access: ServerAccess, role: RoleRow) {
    if (!access.isOwner && !role.isDefault && role.position >= access.top) throw forbidden('role_hierarchy');
  }

  app.post('/api/servers/:id/roles', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_ROLES);
    const body = parse(roleBody, req.body ?? {});
    checkGrant(access, body.permissions);
    const role = await db.transaction(async (tx) => {
      // New roles go to the bottom, just above @everyone.
      await tx
        .update(roles)
        .set({ position: sql`${roles.position} + 1` })
        .where(and(eq(roles.serverId, serverId), gte(roles.position, 1)));
      const [created] = await tx
        .insert(roles)
        .values({
          serverId,
          name: body.name ?? 'new role',
          color: body.color ?? null,
          permissions: body.permissions ?? 0,
          hoist: body.hoist ?? false,
          mentionable: body.mentionable ?? false,
          position: 1,
        })
        .returning();
      return created;
    });
    await audit(db, { serverId, actorId: req.user.id, action: 'role_create', targetId: role.id, targetType: 'role', details: { name: role.name } });
    const all = await db.select().from(roles).where(eq(roles.serverId, serverId));
    ctx.gateway.toServer(serverId, 'roles:update', { serverId, roles: all.map(roleDto) });
    return roleDto(role);
  });

  app.patch('/api/roles/:id', authed, async (req) => {
    const { role, access } = await loadRole(intParam((req.params as { id: string }).id), req.user.id);
    requireAbove(access, role);
    const body = parse(roleBody, req.body ?? {});
    checkGrant(access, body.permissions, role.permissions);
    const patch = role.isDefault ? { permissions: body.permissions } : body;
    const [updated] = await db.update(roles).set(patch).where(eq(roles.id, role.id)).returning();
    await audit(db, {
      serverId: role.serverId,
      actorId: req.user.id,
      action: 'role_update',
      targetId: role.id,
      targetType: 'role',
      details: { changed: Object.keys(patch).filter((k) => (patch as Record<string, unknown>)[k] !== undefined) },
    });
    const all = await db.select().from(roles).where(eq(roles.serverId, role.serverId));
    ctx.gateway.toServer(role.serverId, 'roles:update', { serverId: role.serverId, roles: all.map(roleDto) });
    if (body.permissions !== undefined) await refreshServer(ctx, role.serverId);
    return roleDto(updated);
  });

  app.delete('/api/roles/:id', authed, async (req) => {
    const { role, access } = await loadRole(intParam((req.params as { id: string }).id), req.user.id);
    if (role.isDefault) throw badRequest('cannot_delete_everyone');
    requireAbove(access, role);
    await db.transaction(async (tx) => {
      await tx.delete(overwrites).where(and(eq(overwrites.targetType, 'role'), eq(overwrites.targetId, role.id)));
      await tx.delete(roles).where(eq(roles.id, role.id));
      await tx
        .update(roles)
        .set({ position: sql`${roles.position} - 1` })
        .where(and(eq(roles.serverId, role.serverId), gte(roles.position, role.position)));
    });
    await audit(db, { serverId: role.serverId, actorId: req.user.id, action: 'role_delete', targetId: role.id, targetType: 'role', details: { name: role.name } });
    const all = await db.select().from(roles).where(eq(roles.serverId, role.serverId));
    ctx.gateway.toServer(role.serverId, 'roles:update', { serverId: role.serverId, roles: all.map(roleDto) });
    await refreshServer(ctx, role.serverId);
    return { ok: true };
  });

  // Reorder roles: ids from top to bottom (excluding @everyone).
  app.put('/api/servers/:id/roles/order', authed, async (req) => {
    const serverId = intParam((req.params as { id: string }).id);
    const access = await requireServerAccess(db, serverId, req.user.id);
    requirePerm(access.perms, P.MANAGE_ROLES);
    const ids = parse(z.array(z.number().int().positive()).max(250), req.body);
    const all = await db.select().from(roles).where(eq(roles.serverId, serverId));
    const movable = all.filter((r) => !r.isDefault);
    if (ids.length !== movable.length || !movable.every((r) => ids.includes(r.id))) throw badRequest('invalid_order');
    const newPos = new Map(ids.map((id, i) => [id, ids.length - i]));
    if (!access.isOwner) {
      // Roles at or above your own top role must keep their position.
      for (const r of movable) {
        if (r.position >= access.top && newPos.get(r.id) !== r.position) throw forbidden('role_hierarchy');
      }
      for (const r of movable) {
        if (r.position < access.top && newPos.get(r.id)! >= access.top) throw forbidden('role_hierarchy');
      }
    }
    await db.transaction(async (tx) => {
      for (const [id, position] of newPos) await tx.update(roles).set({ position }).where(eq(roles.id, id));
    });
    const updated = await db.select().from(roles).where(eq(roles.serverId, serverId));
    ctx.gateway.toServer(serverId, 'roles:update', { serverId, roles: updated.map(roleDto) });
    return updated.map(roleDto);
  });

  void memberRoles;
}
