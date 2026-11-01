import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Bootstrap, Channel, Relationship } from '@shared/types';
import { Client, serverWith, startServer, type TestServer } from './helpers';

let srv: TestServer;
beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  await srv.stop();
});

describe('friends', () => {
  it('sends, accepts and removes friend requests', async () => {
    const a = await Client.register(srv, 'f_a');
    const b = await Client.register(srv, 'f_b');
    expect((await a.post('/api/relationships', { username: 'nobody_here' })).status).toBe(400);
    expect((await a.post('/api/relationships', { username: 'f_a' })).status).toBe(400);
    expect((await a.ok('POST', '/api/relationships', { username: 'f_b' })).type).toBe('outgoing');
    let rels = await b.ok<Relationship[]>('GET', '/api/relationships');
    expect(rels).toEqual([expect.objectContaining({ type: 'incoming', user: expect.objectContaining({ id: a.user.id }) })]);
    expect((await a.put(`/api/relationships/${b.user.id}`)).status).toBe(400);
    await b.ok('PUT', `/api/relationships/${a.user.id}`);
    rels = await a.ok<Relationship[]>('GET', '/api/relationships');
    expect(rels[0].type).toBe('friend');
    await a.ok('DELETE', `/api/relationships/${b.user.id}`);
    expect(await b.ok('GET', '/api/relationships')).toEqual([]);
  });

  it('mutual requests become a friendship', async () => {
    const a = await Client.register(srv, 'f_c');
    const b = await Client.register(srv, 'f_d');
    await a.ok('POST', '/api/relationships', { username: 'f_d' });
    expect((await b.ok('POST', '/api/relationships', { username: 'f_c' })).type).toBe('friend');
  });

  it('blocking stops requests and DMs', async () => {
    const a = await Client.register(srv, 'blk_a');
    const b = await Client.register(srv, 'blk_b');
    await a.ok('POST', '/api/relationships', { username: 'blk_b' });
    await b.ok('PUT', `/api/relationships/${a.user.id}`);
    const dm = await a.ok<Channel>('POST', '/api/dms', { recipientIds: [b.user.id] });
    await a.ok('POST', `/api/channels/${dm.id}/messages`, { content: 'hi' });
    await b.ok('PUT', `/api/relationships/${a.user.id}/block`);
    expect((await a.post(`/api/channels/${dm.id}/messages`, { content: 'still there?' })).status).toBe(403);
    expect((await b.post(`/api/channels/${dm.id}/messages`, { content: 'go away' })).status).toBe(403);
    expect((await a.post('/api/relationships', { username: 'blk_b' })).status).toBe(400);
    const relsA = await a.ok<Relationship[]>('GET', '/api/relationships');
    expect(relsA).toEqual([]);
    await b.ok('DELETE', `/api/relationships/${a.user.id}`);
    expect((await a.post(`/api/channels/${dm.id}/messages`, { content: 'unblocked' })).status).toBe(200);
  });
});

describe('direct messages', () => {
  it('only friends or server-mates can open a DM; DMs are reused and hidden until a message arrives', async () => {
    const a = await Client.register(srv, 'dm_a');
    const b = await Client.register(srv, 'dm_b');
    const stranger = await Client.register(srv, 'dm_c');
    expect((await stranger.post('/api/dms', { recipientIds: [a.user.id] })).status).toBe(403);
    await serverWith(a, [b]);
    const dm = await a.ok<Channel>('POST', '/api/dms', { recipientIds: [b.user.id] });
    expect(dm.type).toBe('dm');
    expect(dm.recipients!.map((u) => u.id).sort()).toEqual([a.user.id, b.user.id].sort());
    const again = await a.ok<Channel>('POST', '/api/dms', { recipientIds: [b.user.id] });
    expect(again.id).toBe(dm.id);

    // b does not see the DM until a message is sent.
    expect((await b.ok<Channel[]>('GET', '/api/dms')).map((c) => c.id)).not.toContain(dm.id);
    await a.ok('POST', `/api/channels/${dm.id}/messages`, { content: 'سلام!' });
    expect((await b.ok<Channel[]>('GET', '/api/dms')).map((c) => c.id)).toContain(dm.id);
    const boot = await b.ok<Bootstrap>('GET', '/api/bootstrap');
    expect(boot.readStates.find((r) => r.channelId === dm.id)!.mentionCount).toBe(1);
    expect((await stranger.get(`/api/channels/${dm.id}/messages`)).status).toBe(404);

    // Pinning works for everyone in DMs.
    const msgs = await b.ok('GET', `/api/channels/${dm.id}/messages`);
    expect((await b.put(`/api/messages/${msgs[0].id}/pin`)).status).toBe(200);

    // Closing hides it again.
    await b.ok('DELETE', `/api/dms/${dm.id}/recipients/${b.user.id}`);
    expect((await b.ok<Channel[]>('GET', '/api/dms')).map((c) => c.id)).not.toContain(dm.id);
  });

  it('group DMs are for friends, can be renamed and left', async () => {
    const a = await Client.register(srv, 'g_a');
    const b = await Client.register(srv, 'g_b');
    const c = await Client.register(srv, 'g_c');
    for (const other of [b, c]) {
      await a.ok('POST', '/api/relationships', { username: other.user.username });
      await other.ok('PUT', `/api/relationships/${a.user.id}`);
    }
    const group = await a.ok<Channel>('POST', '/api/dms', { recipientIds: [b.user.id, c.user.id], name: 'Squad' });
    expect(group.type).toBe('group_dm');
    expect(group.recipients).toHaveLength(3);
    expect((await b.post('/api/dms', { recipientIds: [a.user.id, c.user.id] })).status).toBe(403);
    await c.ok('PATCH', `/api/dms/${group.id}`, { name: 'Squad 🎮' });
    await c.ok('POST', `/api/channels/${group.id}/messages`, { content: 'gg' });
    expect((await b.del(`/api/dms/${group.id}/recipients/${c.user.id}`)).status).toBe(403);
    await a.ok('DELETE', `/api/dms/${group.id}/recipients/${a.user.id}`);
    expect((await a.get(`/api/channels/${group.id}/messages`)).status).toBe(404);
    const msgs = await b.ok('GET', `/api/channels/${group.id}/messages`);
    expect(msgs.at(-1).type).toBe('system');
    expect(msgs.at(-1).content).toBe('leave');
    const groups = await b.ok<Channel[]>('GET', '/api/dms');
    expect(groups.find((g) => g.id === group.id)!.ownerId).not.toBe(a.user.id);
  });

  it('shows profiles with mutual servers and friends', async () => {
    const a = await Client.register(srv, 'p_a');
    const b = await Client.register(srv, 'p_b');
    const { serverId } = await serverWith(a, [b]);
    const profile = await a.ok('GET', `/api/users/${b.user.id}`);
    expect(profile.user.username).toBe('p_b');
    expect(profile.mutualServers.map((s: { id: number }) => s.id)).toEqual([serverId]);
    expect(profile.relationship).toBeNull();
    expect((await a.get('/api/users/999999')).status).toBe(404);
  });

  it('deletes an account only after servers are handed over', async () => {
    const a = await Client.register(srv, 'gone_a');
    const b = await Client.register(srv, 'gone_b');
    const { serverId, text } = await serverWith(a, [b]);
    await a.ok('POST', `/api/channels/${text.id}/messages`, { content: 'bye' });
    expect((await a.del('/api/users/me', { password: 'password123' })).status).toBe(400);
    await a.ok('PATCH', `/api/servers/${serverId}`, { ownerId: b.user.id });
    expect((await a.del('/api/users/me', { password: 'wrong' })).status).toBe(403);
    await a.ok('DELETE', '/api/users/me', { password: 'password123' });
    const msgs = await b.ok('GET', `/api/channels/${text.id}/messages`);
    expect(msgs.find((m: { content: string }) => m.content === 'bye').author).toBeNull();
    expect((await a.get('/api/auth/me')).status).toBe(401);
  });
});
