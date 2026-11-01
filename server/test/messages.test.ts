import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { P } from '@shared/permissions';
import type { Bootstrap, Message } from '@shared/types';
import { rollDice } from '../src/lib/messages';
import { Client, serverWith, startServer, type TestServer } from './helpers';

let srv: TestServer;
let owner: Client;
let member: Client;
let serverId: number;
let textId: number;

beforeAll(async () => {
  srv = await startServer();
  owner = await Client.register(srv, 'm_owner');
  member = await Client.register(srv, 'm_member');
  const s = await serverWith(owner, [member]);
  serverId = s.serverId;
  textId = s.text.id;
});
afterAll(async () => {
  await srv.stop();
});

const send = (c: Client, content: string, extra: object = {}) => c.ok<Message>('POST', `/api/channels/${textId}/messages`, { content, ...extra });

describe('messages', () => {
  it('sends, pages, edits and deletes', async () => {
    const first = await send(owner, 'first message');
    for (let i = 0; i < 4; i++) await send(member, `msg ${i}`);
    const page = await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?limit=2`);
    expect(page.map((m) => m.content)).toEqual(['msg 2', 'msg 3']);
    const older = await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?limit=50&before=${page[0].id}`);
    expect(older.map((m) => m.content)).toContain('first message');
    const around = await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?around=${first.id}&limit=4`);
    expect(around.some((m) => m.id === first.id)).toBe(true);

    expect((await member.patch(`/api/messages/${first.id}`, { content: 'hacked' })).status).toBe(403);
    const edited = await owner.ok<Message>('PATCH', `/api/messages/${first.id}`, { content: 'first (edited)' });
    expect(edited.content).toBe('first (edited)');
    expect(edited.editedAt).not.toBeNull();

    expect((await member.del(`/api/messages/${first.id}`)).status).toBe(403);
    expect((await owner.del(`/api/messages/${first.id}`)).status).toBe(200);
    expect((await owner.post(`/api/channels/${textId}/messages`, { content: '   ' })).status).toBe(400);
  });

  it('moderators can delete messages of others, which is audited', async () => {
    const m = await send(member, 'delete me');
    expect((await owner.del(`/api/messages/${m.id}`)).status).toBe(200);
    const log = await owner.ok('GET', `/api/servers/${serverId}/audit-log`);
    expect(log.some((e: { action: string }) => e.action === 'message_delete')).toBe(true);
  });

  it('tracks mentions, replies and @everyone permission', async () => {
    const m = await send(owner, `hey <@${member.user.id}> check this`);
    expect(m.mentions).toEqual([member.user.id]);
    let boot = await member.ok<Bootstrap>('GET', '/api/bootstrap');
    expect(boot.readStates.find((r) => r.channelId === textId)!.mentionCount).toBeGreaterThanOrEqual(1);

    const reply = await send(member, 'replying', { replyToId: m.id });
    expect(reply.replyTo?.id).toBe(m.id);
    expect(reply.replyTo?.author?.id).toBe(owner.user.id);

    // Members lack MENTION_EVERYONE by default.
    const everyone = await send(member, '@everyone wake up');
    expect(everyone.mentionEveryone).toBe(false);
    const ownerEveryone = await send(owner, '@everyone raid at 9');
    expect(ownerEveryone.mentionEveryone).toBe(true);
    // @everyone inside code is not a mention.
    const code = await send(owner, '`@everyone`');
    expect(code.mentionEveryone).toBe(false);

    await member.ok('POST', `/api/channels/${textId}/ack`, {});
    boot = await member.ok<Bootstrap>('GET', '/api/bootstrap');
    const rs = boot.readStates.find((r) => r.channelId === textId)!;
    expect(rs.mentionCount).toBe(0);
    expect(rs.lastReadId).toBeGreaterThanOrEqual(ownerEveryone.id);

    // Mentions of people outside the server are dropped.
    const outsider = await Client.register(srv, 'm_outsider');
    const m2 = await send(owner, `<@${outsider.user.id}> hi`);
    expect(m2.mentions).toEqual([]);

    const inbox = await member.ok<Message[]>('GET', '/api/me/mentions');
    expect(inbox.some((x) => x.id === m.id)).toBe(true);
  });

  it('adds and removes reactions', async () => {
    const m = await send(owner, 'react to me');
    await member.ok('PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent('🔥')}`);
    await owner.ok('PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent('🔥')}`);
    await owner.ok('PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent('👍🏽')}`);
    expect((await owner.put(`/api/messages/${m.id}/reactions/abc`)).status).toBe(400);
    expect((await owner.put(`/api/messages/${m.id}/reactions/123`)).status).toBe(400);
    let [msg] = (await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?around=${m.id}&limit=1`)).filter((x) => x.id === m.id);
    const fire = msg.reactions.find((r) => r.emoji === '🔥')!;
    expect(fire.count).toBe(2);
    expect(fire.me).toBe(true);
    await member.ok('DELETE', `/api/messages/${m.id}/reactions/${encodeURIComponent('🔥')}`);
    [msg] = (await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?around=${m.id}&limit=1`)).filter((x) => x.id === m.id);
    expect(msg.reactions.find((r) => r.emoji === '🔥')!.count).toBe(1);
  });

  it('pins need Manage Messages and post a system message', async () => {
    const m = await send(member, 'pin worthy');
    expect((await member.put(`/api/messages/${m.id}/pin`)).status).toBe(403);
    await owner.ok('PUT', `/api/messages/${m.id}/pin`);
    const pins = await member.ok<Message[]>('GET', `/api/channels/${textId}/pins`);
    expect(pins[0].id).toBe(m.id);
    const latest = await member.ok<Message[]>('GET', `/api/channels/${textId}/messages?limit=1`);
    expect(latest[0].type).toBe('pin');
    expect(latest[0].replyToId).toBe(m.id);
    await owner.ok('DELETE', `/api/messages/${m.id}/pin`);
    expect(await member.ok('GET', `/api/channels/${textId}/pins`)).toHaveLength(0);
  });

  it('creates threads from messages and chats inside them', async () => {
    const m = await send(owner, 'thread starter');
    const thread = await member.ok('POST', `/api/channels/${textId}/threads`, { name: 'Strategy', messageId: m.id });
    expect(thread.type).toBe('thread');
    expect(thread.parentId).toBe(textId);
    expect((await member.post(`/api/channels/${textId}/threads`, { name: 'dup', messageId: m.id })).status).toBe(400);
    const inThread = await owner.ok<Message>('POST', `/api/channels/${thread.id}/messages`, { content: 'inside the thread' });
    expect(inThread.channelId).toBe(thread.id);
    const threads = await owner.ok('GET', `/api/channels/${textId}/threads`);
    expect(threads[0].id).toBe(thread.id);
    const [starter] = (await owner.ok<Message[]>('GET', `/api/channels/${textId}/messages?around=${m.id}&limit=1`)).filter((x) => x.id === m.id);
    expect(starter.thread?.id).toBe(thread.id);
    // Archive: only owner of thread or moderators; archived threads reject new messages from members.
    await member.ok('PATCH', `/api/channels/${thread.id}`, { archived: true });
    expect((await member.post(`/api/channels/${thread.id}/messages`, { content: 'late' })).status).toBe(403);
  });

  it('runs polls with single and multiple choice', async () => {
    const poll = await send(owner, '', { poll: { question: 'Which map?', options: ['Dust2', 'Mirage', 'Inferno'], durationHours: 1 } });
    expect(poll.poll?.options).toHaveLength(3);
    expect((await member.put(`/api/messages/${poll.id}/poll/votes`, { options: [0, 1] })).status).toBe(400);
    const result = await member.ok('PUT', `/api/messages/${poll.id}/poll/votes`, { options: [1] });
    expect(result.options[1].votes).toBe(1);
    expect(result.myVotes).toEqual([1]);
    const multi = await send(owner, '', { poll: { question: 'Days?', options: ['Sat', 'Sun'], multi: true } });
    const r2 = await member.ok('PUT', `/api/messages/${multi.id}/poll/votes`, { options: [0, 1] });
    expect(r2.totalVoters).toBe(1);
    expect(r2.options.map((o: { votes: number }) => o.votes)).toEqual([1, 1]);
    expect((await owner.post(`/api/channels/${textId}/messages`, { poll: { question: 'x', options: ['only one'] } })).status).toBe(400);
  });

  it('searches messages with filters, respecting permissions', async () => {
    await send(owner, 'searchable unicorn text');
    await send(member, 'another unicorn from member');
    const all = await member.ok('GET', `/api/search?serverId=${serverId}&q=unicorn`);
    expect(all.total).toBe(2);
    const byOwner = await member.ok('GET', `/api/search?serverId=${serverId}&q=unicorn&authorId=${owner.user.id}`);
    expect(byOwner.total).toBe(1);
    // A private channel's messages do not show up for people who cannot see it.
    const secret = await owner.ok('POST', `/api/servers/${serverId}/channels`, { name: 'staff', type: 'text', private: true });
    await owner.ok('POST', `/api/channels/${secret.id}/messages`, { content: 'staff unicorn plans' });
    expect((await member.ok('GET', `/api/search?serverId=${serverId}&q=unicorn`)).total).toBe(2);
    expect((await owner.ok('GET', `/api/search?serverId=${serverId}&q=unicorn`)).total).toBe(3);
    // Wildcards are escaped.
    expect((await member.ok('GET', `/api/search?serverId=${serverId}&q=%25`)).total).toBe(0);
  });

  it('uploads attachments and serves them safely', async () => {
    const form = new FormData();
    form.append('payload_json', JSON.stringify({ content: 'files!' }));
    form.append('files', new Blob(['hello world'], { type: 'text/plain' }), 'notes.txt');
    form.append('files', new Blob(['<html><script>alert(1)</script>'], { type: 'text/html' }), 'evil.html');
    const res = await member.post(`/api/channels/${textId}/messages`, form);
    expect(res.status).toBe(200);
    const atts = res.body.attachments;
    expect(atts.map((a: { filename: string }) => a.filename)).toEqual(['notes.txt', 'evil.html']);
    const html = await fetch(srv.url + atts[1].url);
    expect(html.headers.get('content-disposition')).toBe('attachment');
    expect(html.headers.get('content-security-policy')).toContain('sandbox');
    const txt = await fetch(srv.url + atts[0].url);
    expect(await txt.text()).toBe('hello world');
    // Path traversal is not possible.
    expect((await fetch(srv.url + '/uploads/../package.json')).status).toBe(404);

    // Without Attach Files permission uploads are refused.
    const b = await owner.ok('GET', `/api/servers/${serverId}`);
    const everyone = b.roles.find((r: { isDefault: boolean }) => r.isDefault);
    await owner.ok('PATCH', `/api/roles/${everyone.id}`, { permissions: everyone.permissions & ~P.ATTACH_FILES });
    const form2 = new FormData();
    form2.append('files', new Blob(['x']), 'x.txt');
    expect((await member.post(`/api/channels/${textId}/messages`, form2)).status).toBe(403);
    await owner.ok('PATCH', `/api/roles/${everyone.id}`, { permissions: everyone.permissions });
  });

  it('enforces slowmode for regular members only', async () => {
    const ch = await owner.ok('POST', `/api/servers/${serverId}/channels`, { name: 'slow', type: 'text' });
    await owner.ok('PATCH', `/api/channels/${ch.id}`, { slowmode: 30 });
    expect((await member.post(`/api/channels/${ch.id}/messages`, { content: 'one' })).status).toBe(200);
    const second = await member.post(`/api/channels/${ch.id}/messages`, { content: 'two' });
    expect(second.status).toBe(429);
    expect(second.body.retryAfter).toBeGreaterThan(0);
    expect((await owner.post(`/api/channels/${ch.id}/messages`, { content: 'mods are exempt' })).status).toBe(200);
    expect((await owner.post(`/api/channels/${ch.id}/messages`, { content: 'still exempt' })).status).toBe(200);
  });

  it('rolls dice', async () => {
    expect(rollDice('/roll 2d6', () => 0.5)).toBe('🎲 **2d6** → 4 + 4 = **8**');
    expect(rollDice('/roll', () => 0)).toBe('🎲 **1d6** → 1');
    expect(rollDice('hello')).toBeNull();
    const m = await send(member, '/roll 3d20');
    expect(m.content).toMatch(/^🎲 \*\*3d20\*\* → \d+ \+ \d+ \+ \d+ = \*\*\d+\*\*$/);
  });

  it('runs webhooks with a secret token', async () => {
    expect((await member.post(`/api/channels/${textId}/webhooks`, { name: 'bot' })).status).toBe(403);
    const hook = await owner.ok('POST', `/api/channels/${textId}/webhooks`, { name: 'Match Bot' });
    const anon = new Client(srv.url);
    expect((await anon.post(`/api/webhooks/${hook.id}/wrong-token`, { content: 'x' })).status).toBe(404);
    const res = await anon.post(hook.url, { content: 'Match started: Team A vs Team B', username: 'Scoreboard' });
    expect(res.status).toBe(200);
    expect(res.body.author).toBeNull();
    expect(res.body.webhook.name).toBe('Scoreboard');
    const latest = await member.ok<Message[]>('GET', `/api/channels/${textId}/messages?limit=1`);
    expect(latest[0].content).toBe('Match started: Team A vs Team B');
    const list = await owner.ok('GET', `/api/servers/${serverId}/webhooks`);
    expect(list).toHaveLength(1);
    await owner.ok('DELETE', `/api/webhooks/${hook.id}`);
    expect((await anon.post(hook.url, { content: 'x' })).status).toBe(404);
  });

  it('manages custom emojis', async () => {
    const png = Buffer.from(
      '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6300010000000500010d0a2db40000000049454e44ae426082',
      'hex',
    );
    const form = new FormData();
    form.append('name', 'pars_gg');
    form.append('file', new Blob([png], { type: 'image/png' }), 'gg.png');
    const emoji = await owner.ok('POST', `/api/servers/${serverId}/emojis`, form);
    expect(emoji.name).toBe('pars_gg');
    const m = await send(member, `gg <:pars_gg:${emoji.id}>`);
    await member.ok('PUT', `/api/messages/${m.id}/reactions/${encodeURIComponent(`pars_gg:${emoji.id}`)}`);
    const form2 = new FormData();
    form2.append('name', 'pars_gg');
    form2.append('file', new Blob([png], { type: 'image/png' }), 'gg.png');
    expect((await owner.post(`/api/servers/${serverId}/emojis`, form2)).status).toBe(409);
    await owner.ok('DELETE', `/api/emojis/${emoji.id}`);
  });
});
