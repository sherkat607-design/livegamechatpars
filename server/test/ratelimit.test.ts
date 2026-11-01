import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, serverWith, startServer, type TestServer } from './helpers';

// Rate limits follow accounts, not IPs: many mobile users share one IP behind carrier NAT.
let srv: TestServer;
beforeAll(async () => {
  srv = await startServer({ rateLimit: true });
});
afterAll(async () => {
  await srv.stop();
});

describe('rate limits', () => {
  it('limits message bursts per account, not per IP', async () => {
    const a = await Client.register(srv, 'rl_a');
    const b = await Client.register(srv, 'rl_b');
    const { text } = await serverWith(a, [b]);
    for (let i = 0; i < 10; i++) expect((await a.post(`/api/channels/${text.id}/messages`, { content: `m${i}` })).status).toBe(200);
    const limited = await a.post(`/api/channels/${text.id}/messages`, { content: 'one too many' });
    expect(limited.status).toBe(429);
    expect(limited.body.error).toBe('rate_limited');
    // Someone else on the same IP is unaffected.
    expect((await b.post(`/api/channels/${text.id}/messages`, { content: 'hi' })).status).toBe(200);
  });

  it('limits password guessing per account name', async () => {
    await Client.register(srv, 'rl_victim');
    await Client.register(srv, 'rl_other');
    const anon = new Client(srv.url);
    for (let i = 0; i < 10; i++) expect((await anon.post('/api/auth/login', { login: 'rl_victim', password: 'wrong-password' })).status).toBe(401);
    expect((await anon.post('/api/auth/login', { login: 'rl_victim', password: 'wrong-password' })).status).toBe(429);
    expect((await anon.post('/api/auth/login', { login: 'RL_VICTIM', password: 'password123' })).status).toBe(429);
    // Other accounts can still sign in from the same IP.
    expect((await anon.post('/api/auth/login', { login: 'rl_other', password: 'password123' })).status).toBe(200);
  });
});
