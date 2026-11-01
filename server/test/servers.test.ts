import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { P } from '@shared/permissions';
import type { Bootstrap, ServerBundle } from '@shared/types';
import { Client, serverWith, startServer, type TestServer } from './helpers';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.stop();
});

describe('accounts', () => {
  it('registers, rejects duplicates, logs in and out', async () => {
    const alice = await Client.register(srv, 'alice');
    expect(alice.user.username).toBe('alice');
    expect(alice.user.email).toBe('alice@example.com');

    const anon = new Client(srv.url);
    expect((await anon.post('/api/auth/register', { username: 'alice', email: 'x@example.com', password: 'password123' })).status).toBe(409);
    expect((await anon.post('/api/auth/register', { username: 'Bad Name!', email: 'y@example.com', password: 'password123' })).status).toBe(400);
    expect((await anon.post('/api/auth/register', { username: 'short', email: 'z@example.com', password: '123' })).status).toBe(400);
    expect((await anon.post('/api/auth/login', { login: 'alice', password: 'wrong-password' })).status).toBe(401);

    const login = await anon.post('/api/auth/login', { login: 'ALICE@example.com', password: 'password123' });
    expect(login.status).toBe(200);
    expect(login.headers.get('set-cookie')).toContain('lgcp_token=');
    expect(login.headers.get('set-cookie')).toContain('HttpOnly');

    expect((await anon.get('/api/auth/me')).status).toBe(401);
    // The session probe never fails, so public pages stay quiet for visitors.
    const visitor = await anon.get('/api/auth/session');
    expect(visitor.status).toBe(200);
    expect(visitor.body.user).toBeNull();
    expect((await alice.get('/api/auth/session')).body.user.id).toBe(alice.user.id);
    expect((await alice.get('/api/auth/me')).body.user.id).toBe(alice.user.id);
  });

  it('lets the Android app call the API from its own origin with a bearer token', async () => {
    const c = await Client.register(srv, 'native_user');
    const pre = await fetch(`${srv.url}/api/bootstrap`, {
      method: 'OPTIONS',
      headers: { origin: 'https://localhost', 'access-control-request-method': 'GET', 'access-control-request-headers': 'authorization' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('https://localhost');
    expect(pre.headers.get('access-control-allow-headers')).toContain('authorization');
    const res = await fetch(`${srv.url}/api/bootstrap`, { headers: { origin: 'https://localhost', authorization: `Bearer ${c.token}` } });
    expect(res.status).toBe(200);
    expect(res.headers.get('access-control-allow-origin')).toBe('https://localhost');
    // Other websites get no CORS permission.
    const evil = await fetch(`${srv.url}/api/bootstrap`, {
      method: 'OPTIONS',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    });
    expect(evil.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('updates the profile and rejects taken usernames', async () => {
    const c = await Client.register(srv, 'profile_user');
    const res = await c.patch('/api/users/me', { displayName: 'پروفایل', bio: 'سلام', activity: 'Valorant', status: 'dnd' });
    expect(res.status).toBe(200);
    expect(res.body.user.displayName).toBe('پروفایل');
    expect(res.body.user.preferredStatus).toBe('dnd');
    expect((await c.patch('/api/users/me', { username: 'alice' })).status).toBe(409);
  });

  it('changing the password revokes old tokens', async () => {
    const c = await Client.register(srv, 'pw_user');
    const oldToken = c.token;
    const res = await c.post('/api/users/me/password', { currentPassword: 'password123', newPassword: 'newpassword456' });
    expect(res.status).toBe(200);
    expect((await new Client(srv.url, oldToken).get('/api/auth/me')).status).toBe(401);
    expect((await new Client(srv.url, res.body.token).get('/api/auth/me')).status).toBe(200);
  });

  it('rejects non-image avatars and accepts PNGs', async () => {
    const c = await Client.register(srv, 'avatar_user');
    const bad = new FormData();
    bad.append('file', new Blob(['<svg onload=alert(1)>'], { type: 'image/svg+xml' }), 'x.svg');
    expect((await c.put('/api/users/me/avatar', bad)).status).toBe(400);

    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
      'hex',
    );
    const good = new FormData();
    good.append('file', new Blob([png], { type: 'image/png' }), 'me.png');
    const res = await c.put('/api/users/me/avatar', good);
    expect(res.status).toBe(200);
    expect(res.body.user.avatar).toMatch(/^\/uploads\/[0-9a-f]{24}\/avatar\.png$/);
    const file = await fetch(srv.url + res.body.user.avatar);
    expect(file.status).toBe(200);
    expect(file.headers.get('content-type')).toBe('image/png');
    expect(file.headers.get('x-content-type-options')).toBe('nosniff');
  });
});

describe('servers and invites', () => {
  it('creates a server from the gaming template', async () => {
    const owner = await Client.register(srv, 'gamer');
    const b = await owner.createServer('Pars Gamers', 'gaming');
    expect(b.server.name).toBe('Pars Gamers');
    expect(b.server.ownerId).toBe(owner.user.id);
    expect(b.roles).toHaveLength(1);
    expect(b.roles[0].isDefault).toBe(true);
    expect(b.channels.filter((c) => c.type === 'category')).toHaveLength(3);
    expect(b.channels.filter((c) => c.type === 'voice')).toHaveLength(3);
    expect(b.server.systemChannelId).toBe(b.channels.find((c) => c.name === 'عمومی')!.id);
    expect(b.memberCount).toBe(1);
  });

  it('joins with an invite, posts a welcome message and enforces limits', async () => {
    const owner = await Client.register(srv, 'inv_owner');
    const guest = await Client.register(srv, 'inv_guest');
    const third = await Client.register(srv, 'inv_third');
    const b = await owner.createServer('Invites');
    const invite = await owner.ok('POST', `/api/servers/${b.server.id}/invites`, { maxUses: 1, maxAgeSeconds: 3600 });
    expect(invite.code).toMatch(/^[A-Za-z0-9]{10}$/);

    const preview = await new Client(srv.url).get(`/api/invites/${invite.code}`);
    expect(preview.status).toBe(200);
    expect(preview.body.server.name).toBe('Invites');
    expect(preview.body.memberCount).toBe(1);

    const joined = await guest.ok<ServerBundle>('POST', `/api/invites/${invite.code}`);
    expect(joined.server.id).toBe(b.server.id);
    expect(joined.memberCount).toBe(2);
    // Used up.
    expect((await third.post(`/api/invites/${invite.code}`)).status).toBe(404);

    const msgs = await owner.ok('GET', `/api/channels/${b.server.systemChannelId}/messages`);
    expect(msgs.at(-1).type).toBe('join');
    expect(msgs.at(-1).author.id).toBe(guest.user.id);

    const boot = await guest.ok<Bootstrap>('GET', '/api/bootstrap');
    expect(boot.servers.map((s) => s.server.id)).toContain(b.server.id);
  });

  it('hides servers from non-members and only lets the owner delete', async () => {
    const owner = await Client.register(srv, 'del_owner');
    const member = await Client.register(srv, 'del_member');
    const stranger = await Client.register(srv, 'del_stranger');
    const { serverId } = await serverWith(owner, [member]);
    expect((await stranger.get(`/api/servers/${serverId}`)).status).toBe(404);
    expect((await member.del(`/api/servers/${serverId}`)).status).toBe(403);
    expect((await owner.del(`/api/servers/${serverId}/members/@me`)).status).toBe(400);
    expect((await member.del(`/api/servers/${serverId}/members/@me`)).status).toBe(200);
    expect((await owner.del(`/api/servers/${serverId}`)).status).toBe(200);
    expect((await owner.get(`/api/servers/${serverId}`)).status).toBe(404);
  });

  it('lists public servers in discovery and lets people join them', async () => {
    const owner = await Client.register(srv, 'disc_owner');
    const visitor = await Client.register(srv, 'disc_visitor');
    const b = await owner.createServer('CS2 Iran');
    expect((await visitor.post(`/api/discover/${b.server.id}/join`)).status).toBe(404);
    await owner.ok('PATCH', `/api/servers/${b.server.id}`, { isPublic: true, description: 'Counter-Strike community' });
    const found = await visitor.ok('GET', '/api/discover?q=counter');
    expect(found.map((s: { id: number }) => s.id)).toContain(b.server.id);
    const joined = await visitor.ok('POST', `/api/discover/${b.server.id}/join`);
    expect(joined.memberCount).toBe(2);
  });

  it('transfers ownership', async () => {
    const owner = await Client.register(srv, 'own_a');
    const next = await Client.register(srv, 'own_b');
    const { serverId } = await serverWith(owner, [next]);
    expect((await next.patch(`/api/servers/${serverId}`, { ownerId: next.user.id })).status).toBe(403);
    await owner.ok('PATCH', `/api/servers/${serverId}`, { ownerId: next.user.id });
    expect((await next.del(`/api/servers/${serverId}`)).status).toBe(200);
  });
});

describe('channels, roles and permissions', () => {
  it('creates, renames, reorders and deletes channels', async () => {
    const owner = await Client.register(srv, 'chan_owner');
    const member = await Client.register(srv, 'chan_member');
    const { serverId, bundle } = await serverWith(owner, [member]);
    const category = bundle.channels.find((c) => c.type === 'category')!;
    const created = await owner.ok('POST', `/api/servers/${serverId}/channels`, { name: 'Game Night  Plans', type: 'text', parentId: category.id });
    expect(created.name).toBe('game-night-plans');
    const persian = await owner.ok('POST', `/api/servers/${serverId}/channels`, { name: 'گپ و گفت', type: 'text' });
    expect(persian.name).toBe('گپ-و-گفت');
    expect((await member.post(`/api/servers/${serverId}/channels`, { name: 'nope', type: 'text' })).status).toBe(403);

    const renamed = await owner.ok('PATCH', `/api/channels/${created.id}`, { name: 'events', topic: 'Weekly events', slowmode: 10 });
    expect(renamed.name).toBe('events');
    expect(renamed.slowmode).toBe(10);

    await owner.ok('PUT', `/api/servers/${serverId}/channels/order`, [{ id: created.id, position: 0, parentId: null }]);
    const after = await owner.ok<ServerBundle>('GET', `/api/servers/${serverId}`);
    expect(after.channels.find((c) => c.id === created.id)!.parentId).toBeNull();

    await owner.ok('DELETE', `/api/channels/${category.id}`);
    const final = await owner.ok<ServerBundle>('GET', `/api/servers/${serverId}`);
    expect(final.channels.some((c) => c.id === category.id)).toBe(false);
    expect(final.channels.filter((c) => c.parentId === category.id)).toHaveLength(0);
  });

  it('private channels are invisible until a role is allowed in', async () => {
    const owner = await Client.register(srv, 'priv_owner');
    const member = await Client.register(srv, 'priv_member');
    const { serverId } = await serverWith(owner, [member]);
    const role = await owner.ok('POST', `/api/servers/${serverId}/roles`, { name: 'VIP', color: '#f5b942' });
    const secret = await owner.ok('POST', `/api/servers/${serverId}/channels`, {
      name: 'vip-lounge',
      type: 'text',
      private: true,
      allowedRoleIds: [role.id],
    });
    await owner.ok('POST', `/api/channels/${secret.id}/messages`, { content: 'secret stuff' });

    let view = await member.ok<ServerBundle>('GET', `/api/servers/${serverId}`);
    expect(view.channels.some((c) => c.id === secret.id)).toBe(false);
    expect((await member.get(`/api/channels/${secret.id}/messages`)).status).toBe(404);
    expect((await member.post(`/api/channels/${secret.id}/messages`, { content: 'hi' })).status).toBe(404);

    await owner.ok('PUT', `/api/servers/${serverId}/members/${member.user.id}/roles/${role.id}`);
    view = await member.ok<ServerBundle>('GET', `/api/servers/${serverId}`);
    expect(view.channels.some((c) => c.id === secret.id)).toBe(true);
    const msgs = await member.ok('GET', `/api/channels/${secret.id}/messages`);
    expect(msgs[0].content).toBe('secret stuff');

    // Deny sending for the role through an overwrite.
    await owner.ok('PUT', `/api/channels/${secret.id}/overwrites/role/${role.id}`, { allow: P.VIEW_CHANNEL, deny: P.SEND_MESSAGES });
    expect((await member.post(`/api/channels/${secret.id}/messages`, { content: 'hi' })).status).toBe(403);
  });

  it('enforces the role hierarchy and permission grants', async () => {
    const owner = await Client.register(srv, 'hier_owner');
    const mod = await Client.register(srv, 'hier_mod');
    const { serverId } = await serverWith(owner, [mod]);
    const high = await owner.ok('POST', `/api/servers/${serverId}/roles`, { name: 'Admin', permissions: P.ADMINISTRATOR });
    const modRole = await owner.ok('POST', `/api/servers/${serverId}/roles`, { name: 'Mod', permissions: P.MANAGE_ROLES | P.KICK_MEMBERS });
    const low = await owner.ok('POST', `/api/servers/${serverId}/roles`, { name: 'Member' });
    // Newest role is at the bottom: Member(1) < Mod(2) < Admin(3)
    await owner.ok('PUT', `/api/servers/${serverId}/members/${mod.user.id}/roles/${modRole.id}`);

    expect((await mod.patch(`/api/roles/${high.id}`, { name: 'hacked' })).status).toBe(403);
    expect((await mod.patch(`/api/roles/${low.id}`, { name: 'Regulars' })).status).toBe(200);
    // Mod cannot grant permissions it does not have.
    expect((await mod.patch(`/api/roles/${low.id}`, { permissions: P.BAN_MEMBERS })).status).toBe(403);
    expect((await mod.patch(`/api/roles/${low.id}`, { permissions: P.KICK_MEMBERS })).status).toBe(200);
    // Mod cannot give itself the admin role.
    expect((await mod.put(`/api/servers/${serverId}/members/${mod.user.id}/roles/${high.id}`)).status).toBe(403);
    // Mod cannot create a role with admin.
    expect((await mod.post(`/api/servers/${serverId}/roles`, { name: 'x', permissions: P.ADMINISTRATOR })).status).toBe(403);
    // Cannot delete @everyone.
    const b = await owner.ok<ServerBundle>('GET', `/api/servers/${serverId}`);
    const everyone = b.roles.find((r) => r.isDefault)!;
    expect((await owner.del(`/api/roles/${everyone.id}`)).status).toBe(400);
  });

  it('applies timeouts to sending messages', async () => {
    const owner = await Client.register(srv, 'to_owner');
    const member = await Client.register(srv, 'to_member');
    const { serverId, text } = await serverWith(owner, [member]);
    const until = new Date(Date.now() + 60_000).toISOString();
    await owner.ok('PATCH', `/api/servers/${serverId}/members/${member.user.id}`, { timeoutUntil: until, reason: 'spam' });
    expect((await member.post(`/api/channels/${text.id}/messages`, { content: 'hello?' })).status).toBe(403);
    expect((await member.get(`/api/channels/${text.id}/messages`)).status).toBe(200);
    await owner.ok('PATCH', `/api/servers/${serverId}/members/${member.user.id}`, { timeoutUntil: null });
    expect((await member.post(`/api/channels/${text.id}/messages`, { content: 'back' })).status).toBe(200);
    // Members cannot time out the owner.
    expect(
      (await member.patch(`/api/servers/${serverId}/members/${owner.user.id}`, { timeoutUntil: until })).status,
    ).toBe(403);
  });
});
