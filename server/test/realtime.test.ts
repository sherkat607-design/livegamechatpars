import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { P } from '@shared/permissions';
import type { Message, VoiceParticipant } from '@shared/types';
import { Client, expectNoEvent, serverWith, startServer, waitFor, type TestServer } from './helpers';

let srv: TestServer;
const clients: Client[] = [];
async function user(name: string) {
  const c = await Client.register(srv, name);
  clients.push(c);
  return c;
}

beforeAll(async () => {
  srv = await startServer();
});
afterAll(async () => {
  for (const c of clients) c.closeSockets();
  await srv.stop();
});

describe('gateway', () => {
  it('rejects sockets without a valid token', async () => {
    const c = new Client(srv.url, 'garbage');
    await expect(c.connect()).rejects.toThrow();
    c.closeSockets();
  });

  it('delivers messages, edits, reactions and deletes in real time', async () => {
    const owner = await user('rt_owner');
    const member = await user('rt_member');
    const { text } = await serverWith(owner, [member]);
    const sock = await member.connect();

    const created = waitFor<Message>(sock, 'message:create', (m) => m.content === 'live!');
    const sent = await owner.ok<Message>('POST', `/api/channels/${text.id}/messages`, { content: 'live!' });
    expect((await created).id).toBe(sent.id);

    const updated = waitFor<Message>(sock, 'message:update', (m) => m.id === sent.id);
    await owner.ok('PATCH', `/api/messages/${sent.id}`, { content: 'live (edited)' });
    expect((await updated).content).toBe('live (edited)');

    const reacted = waitFor(sock, 'reaction:add', (r) => r.messageId === sent.id);
    await owner.ok('PUT', `/api/messages/${sent.id}/reactions/${encodeURIComponent('🎮')}`);
    expect(await reacted).toEqual(expect.objectContaining({ emoji: '🎮', userId: owner.user.id }));

    const deleted = waitFor(sock, 'message:delete', (d) => d.id === sent.id);
    await owner.ok('DELETE', `/api/messages/${sent.id}`);
    expect((await deleted).channelId).toBe(text.id);
  });

  it('does not leak private channel messages', async () => {
    const owner = await user('leak_owner');
    const member = await user('leak_member');
    const { serverId } = await serverWith(owner, [member]);
    const secret = await owner.ok('POST', `/api/servers/${serverId}/channels`, { name: 'secret', type: 'text', private: true });
    const sock = await member.connect();
    const noEvent = expectNoEvent(sock, 'message:create', (m) => m.channelId === secret.id, 600);
    const noTyping = expectNoEvent(sock, 'typing', (t) => t.channelId === secret.id, 600);
    const ownerSock = await owner.connect();
    ownerSock.emit('typing', { channelId: secret.id });
    await owner.ok('POST', `/api/channels/${secret.id}/messages`, { content: 'top secret' });
    await noEvent;
    await noTyping;
  });

  it('relays typing indicators and presence changes', async () => {
    const owner = await user('ty_owner');
    const member = await user('ty_member');
    const { text } = await serverWith(owner, [member]);
    const memberSock = await member.connect();

    const online = waitFor(memberSock, 'user:update', (u) => u.id === owner.user.id && u.status === 'online');
    const ownerSock = await owner.connect();
    await online;

    const typing = waitFor(memberSock, 'typing', (t) => t.channelId === text.id);
    ownerSock.emit('typing', { channelId: text.id });
    expect((await typing).userId).toBe(owner.user.id);

    const idle = waitFor(memberSock, 'user:update', (u) => u.id === owner.user.id && u.status === 'idle');
    ownerSock.emit('idle', true);
    await idle;

    const dnd = waitFor(memberSock, 'user:update', (u) => u.id === owner.user.id && u.status === 'dnd');
    await owner.ok('PATCH', '/api/users/me', { status: 'dnd', activity: 'Playing Rocket League' });
    expect((await dnd).activity).toBe('Playing Rocket League');

    const offline = waitFor(memberSock, 'user:update', (u) => u.id === owner.user.id && u.status === 'offline');
    owner.closeSockets();
    await offline;
  });

  it('notifies about members joining and server changes', async () => {
    const owner = await user('ev_owner');
    const guest = await user('ev_guest');
    const b = await owner.createServer('Events');
    const ownerSock = await owner.connect();
    const guestSock = await guest.connect();
    const invite = await owner.ok('POST', `/api/servers/${b.server.id}/invites`, {});

    const memberAdd = waitFor(ownerSock, 'member:add', (m) => m.userId === guest.user.id);
    const serverCreate = waitFor(guestSock, 'server:create', (s) => s.server.id === b.server.id);
    await guest.ok('POST', `/api/invites/${invite.code}`);
    await memberAdd;
    await serverCreate;

    // The guest's socket joined the server room, so it receives server updates.
    const renamed = waitFor(guestSock, 'server:update', (s) => s.id === b.server.id);
    await owner.ok('PATCH', `/api/servers/${b.server.id}`, { name: 'Renamed Events' });
    expect((await renamed).name).toBe('Renamed Events');

    // Kicked members receive server:delete and stop receiving server events.
    const gone = waitFor(guestSock, 'server:delete', (s) => s.id === b.server.id);
    await owner.ok('DELETE', `/api/servers/${b.server.id}/members/${guest.user.id}`);
    await gone;
    const quiet = expectNoEvent(guestSock, 'server:update', (s) => s.id === b.server.id);
    await owner.ok('PATCH', `/api/servers/${b.server.id}`, { name: 'Again' });
    await quiet;
  });

  it('runs voice channels: join, state, signaling, mute and moderation', async () => {
    const owner = await user('vc_owner');
    const member = await user('vc_member');
    const { voice, text } = await serverWith(owner, [member]);
    const a = await owner.connect();
    const b = await member.connect();

    const joinA = await new Promise<any>((resolve) => a.emit('voice:join', { channelId: voice.id }, resolve));
    expect(joinA.ok).toBe(true);
    expect(joinA.participants).toEqual([]);

    const stateSeen = waitFor<{ channelId: number; participants: VoiceParticipant[] }>(
      a,
      'voice:state',
      (s) => s.channelId === voice.id && s.participants.length === 2,
    );
    const joinB = await new Promise<any>((resolve) => b.emit('voice:join', { channelId: voice.id }, resolve));
    expect(joinB.ok).toBe(true);
    expect(joinB.participants.map((p: VoiceParticipant) => p.userId)).toEqual([owner.user.id]);
    await stateSeen;

    // Signals are relayed only between participants.
    const signal = waitFor(a, 'voice:signal', (s) => s.from === member.user.id);
    b.emit('voice:signal', { to: owner.user.id, data: { type: 'offer', sdp: 'v=0...' } });
    expect((await signal).data).toEqual({ type: 'offer', sdp: 'v=0...' });

    const muted = waitFor<{ participants: VoiceParticipant[] }>(a, 'voice:state', (s) =>
      s.participants.some((p) => p.userId === member.user.id && p.selfMute),
    );
    b.emit('voice:update', { selfMute: true, video: true, streams: { camera: 'stream-1' } });
    const mutedState = await muted;
    const me = mutedState.participants.find((p) => p.userId === member.user.id)!;
    expect(me.video).toBe(true);
    expect(me.streams.camera).toBe('stream-1');

    // Text channels are not voice channels.
    const wrong = await new Promise<any>((resolve) => b.emit('voice:join', { channelId: text.id }, resolve));
    expect(wrong).toEqual({ ok: false, error: 'not_voice_channel' });

    // Moderators can server-mute and disconnect.
    const serverMuted = waitFor<{ participants: VoiceParticipant[] }>(b, 'voice:state', (s) =>
      s.participants.some((p) => p.userId === member.user.id && p.serverMute),
    );
    await owner.ok('POST', `/api/voice/${voice.id}/members/${member.user.id}`, { serverMute: true });
    await serverMuted;
    expect((await member.post(`/api/voice/${voice.id}/members/${owner.user.id}`, { serverMute: true })).status).toBe(403);

    const kicked = waitFor(b, 'voice:kicked');
    await owner.ok('POST', `/api/voice/${voice.id}/members/${member.user.id}`, { disconnect: true });
    await kicked;
    const after = await member.ok('GET', '/api/bootstrap');
    expect(after.voiceStates.map((p: VoiceParticipant) => p.userId)).toEqual([owner.user.id]);
  });

  it('denies voice without the Connect permission and leaves on disconnect', async () => {
    const owner = await user('vp_owner');
    const member = await user('vp_member');
    const { serverId, voice } = await serverWith(owner, [member]);
    const b = await owner.ok('GET', `/api/servers/${serverId}`);
    const everyone = b.roles.find((r: { isDefault: boolean }) => r.isDefault);
    await owner.ok('PUT', `/api/channels/${voice.id}/overwrites/role/${everyone.id}`, { allow: 0, deny: P.CONNECT });
    const sock = await member.connect();
    const res = await new Promise<any>((resolve) => sock.emit('voice:join', { channelId: voice.id }, resolve));
    expect(res).toEqual({ ok: false, error: 'missing_permissions' });

    const ownerSock = await owner.connect();
    const ok = await new Promise<any>((resolve) => ownerSock.emit('voice:join', { channelId: voice.id }, resolve));
    expect(ok.ok).toBe(true);
    const left = waitFor<{ participants: VoiceParticipant[] }>(sock, 'voice:state', (s) => s.participants.length === 0);
    ownerSock.disconnect();
    await left;
  });

  it('rings the other person when a DM call starts', async () => {
    const a = await user('call_a');
    const b = await user('call_b');
    await serverWith(a, [b]);
    const dm = await a.ok('POST', '/api/dms', { recipientIds: [b.user.id] });
    const sockA = await a.connect();
    const sockB = await b.connect();
    const ring = waitFor(sockB, 'call:ring', (r) => r.channelId === dm.id);
    const callMsg = waitFor<Message>(sockB, 'message:create', (m) => m.type === 'call');
    const res = await new Promise<any>((resolve) => sockA.emit('voice:join', { channelId: dm.id }, resolve));
    expect(res.ok).toBe(true);
    expect((await ring).from).toBe(a.user.id);
    await callMsg;
  });
});
