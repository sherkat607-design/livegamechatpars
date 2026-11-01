import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { P } from '@shared/permissions';
import type { AuditLogEntry, Member } from '@shared/types';
import { Client, serverWith, startServer, type TestServer } from './helpers';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.stop();
});

describe('moderation', () => {
  it('kicks members, who can come back with a new invite', async () => {
    const owner = await Client.register(srv, 'k_owner');
    const member = await Client.register(srv, 'k_member');
    const { serverId, invite } = await serverWith(owner, [member]);
    expect((await member.del(`/api/servers/${serverId}/members/${owner.user.id}`)).status).toBe(403);
    await owner.ok('DELETE', `/api/servers/${serverId}/members/${member.user.id}?reason=spam`);
    expect((await member.get(`/api/servers/${serverId}`)).status).toBe(404);
    await member.ok('POST', `/api/invites/${invite.code}`);
    expect((await member.get(`/api/servers/${serverId}`)).status).toBe(200);
  });

  it('bans members, deletes their recent messages and blocks rejoining until unbanned', async () => {
    const owner = await Client.register(srv, 'b_owner');
    const member = await Client.register(srv, 'b_member');
    const { serverId, invite, text } = await serverWith(owner, [member]);
    await member.ok('POST', `/api/channels/${text.id}/messages`, { content: 'spam spam spam' });
    await owner.ok('PUT', `/api/servers/${serverId}/bans/${member.user.id}`, { reason: 'spamming', deleteMessageSeconds: 3600 });
    const msgs = await owner.ok('GET', `/api/channels/${text.id}/messages`);
    expect(msgs.some((m: { content: string }) => m.content === 'spam spam spam')).toBe(false);
    expect((await member.post(`/api/invites/${invite.code}`)).status).toBe(403);
    const bans = await owner.ok('GET', `/api/servers/${serverId}/bans`);
    expect(bans[0]).toEqual(expect.objectContaining({ reason: 'spamming', user: expect.objectContaining({ id: member.user.id }) }));
    await owner.ok('DELETE', `/api/servers/${serverId}/bans/${member.user.id}`);
    expect((await member.post(`/api/invites/${invite.code}`)).status).toBe(200);
  });

  it('moderators can only act on members below them', async () => {
    const owner = await Client.register(srv, 'h_owner');
    const mod = await Client.register(srv, 'h_mod');
    const peer = await Client.register(srv, 'h_peer');
    const user = await Client.register(srv, 'h_user');
    const { serverId } = await serverWith(owner, [mod, peer, user]);
    const modRole = await owner.ok('POST', `/api/servers/${serverId}/roles`, {
      name: 'Mod',
      permissions: P.KICK_MEMBERS | P.BAN_MEMBERS | P.MODERATE_MEMBERS | P.MANAGE_NICKNAMES,
    });
    await owner.ok('PUT', `/api/servers/${serverId}/members/${mod.user.id}/roles/${modRole.id}`);
    await owner.ok('PUT', `/api/servers/${serverId}/members/${peer.user.id}/roles/${modRole.id}`);

    // Same rank: not allowed.
    expect((await mod.del(`/api/servers/${serverId}/members/${peer.user.id}`)).status).toBe(403);
    expect((await mod.put(`/api/servers/${serverId}/bans/${owner.user.id}`, {})).status).toBe(403);
    // Lower rank: allowed.
    const nick = await mod.ok<Member>('PATCH', `/api/servers/${serverId}/members/${user.user.id}`, { nickname: 'Rookie' });
    expect(nick.nickname).toBe('Rookie');
    await mod.ok('DELETE', `/api/servers/${serverId}/members/${user.user.id}`);
    // Members can set their own nickname.
    const self = await peer.ok<Member>('PATCH', `/api/servers/${serverId}/members/@me`, { nickname: 'Peer' });
    expect(self.nickname).toBe('Peer');
  });

  it('records an audit log visible only with permission', async () => {
    const owner = await Client.register(srv, 'a_owner');
    const member = await Client.register(srv, 'a_member');
    const { serverId } = await serverWith(owner, [member]);
    await owner.ok('PATCH', `/api/servers/${serverId}`, { name: 'Renamed' });
    await owner.ok('POST', `/api/servers/${serverId}/roles`, { name: 'Helper' });
    expect((await member.get(`/api/servers/${serverId}/audit-log`)).status).toBe(403);
    const log = await owner.ok<AuditLogEntry[]>('GET', `/api/servers/${serverId}/audit-log`);
    const actions = log.map((e) => e.action);
    expect(actions).toContain('server_update');
    expect(actions).toContain('role_create');
    expect(actions).toContain('invite_create');
    expect(log[0].actor?.id).toBe(owner.user.id);
  });

  it('invites can be listed and revoked', async () => {
    const owner = await Client.register(srv, 'i_owner');
    const member = await Client.register(srv, 'i_member');
    const { serverId, invite } = await serverWith(owner, [member]);
    expect((await member.get(`/api/servers/${serverId}/invites`)).status).toBe(403);
    const list = await owner.ok('GET', `/api/servers/${serverId}/invites`);
    expect(list.map((i: { code: string }) => i.code)).toContain(invite.code);
    await owner.ok('DELETE', `/api/invites/${invite.code}`);
    expect((await new Client(srv.url).get(`/api/invites/${invite.code}`)).status).toBe(404);
  });
});
