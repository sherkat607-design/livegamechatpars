import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { io, type Socket } from 'socket.io-client';
import type { SelfUser, ServerBundle } from '@shared/types';
import { buildApp, type BuiltApp } from '../src/app';
import { loadConfig } from '../src/config';

export interface TestServer extends BuiltApp {
  url: string;
  stop: () => Promise<void>;
}

export async function startServer(): Promise<TestServer> {
  const dir = mkdtempSync(join(tmpdir(), 'lgcp-test-'));
  const config = loadConfig(
    { NODE_ENV: 'test' },
    {
      dataDir: dir,
      uploadsDir: join(dir, 'uploads'),
      databaseUrl: 'memory',
      jwtSecret: 'test-secret-test-secret-test-secret-123',
      rateLimit: false,
      logLevel: 'silent',
      iceServers: [],
    },
  );
  const built = await buildApp(config);
  await built.app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = built.app.server.address() as AddressInfo;
  return {
    ...built,
    url: `http://127.0.0.1:${port}`,
    stop: async () => {
      await built.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

export interface Res<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

export class Client {
  user!: SelfUser;
  sockets: Socket[] = [];

  constructor(
    public base: string,
    public token?: string,
  ) {}

  async req<T = any>(method: string, path: string, body?: unknown): Promise<Res<T>> {
    const headers: Record<string, string> = {};
    if (this.token) headers.authorization = `Bearer ${this.token}`;
    let payload: RequestInit["body"];
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    const text = await res.text();
    let parsed: unknown = text;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      // keep text
    }
    return { status: res.status, body: parsed as T, headers: res.headers };
  }

  get<T = any>(path: string) {
    return this.req<T>('GET', path);
  }
  post<T = any>(path: string, body?: unknown) {
    return this.req<T>('POST', path, body);
  }
  patch<T = any>(path: string, body?: unknown) {
    return this.req<T>('PATCH', path, body);
  }
  put<T = any>(path: string, body?: unknown) {
    return this.req<T>('PUT', path, body);
  }
  del<T = any>(path: string, body?: unknown) {
    return this.req<T>('DELETE', path, body);
  }

  /** Expect a 2xx and return the body. */
  async ok<T = any>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.req<T>(method, path, body);
    if (res.status >= 300) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  static async register(server: { url: string }, username: string, password = 'password123'): Promise<Client> {
    const c = new Client(server.url);
    const res = await c.post('/api/auth/register', { username, email: `${username}@example.com`, password });
    if (res.status !== 201) throw new Error(`register failed: ${JSON.stringify(res.body)}`);
    c.token = res.body.token;
    c.user = res.body.user;
    return c;
  }

  async createServer(name = 'Test Server', template = 'default'): Promise<ServerBundle> {
    return this.ok('POST', '/api/servers', { name, template });
  }

  async connect(): Promise<Socket> {
    const socket = io(this.base, { auth: { token: this.token }, transports: ['websocket'], forceNew: true, reconnection: false });
    this.sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('ready', () => resolve());
      socket.once('connect_error', reject);
    });
    return socket;
  }

  closeSockets() {
    for (const s of this.sockets) s.disconnect();
    this.sockets = [];
  }
}

/** Wait for one event (optionally matching a predicate). */
export function waitFor<T = any>(socket: Socket, event: string, predicate: (data: T) => boolean = () => true, ms = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`timeout waiting for ${event}`));
    }, ms);
    const handler = (data: T) => {
      if (!predicate(data)) return;
      clearTimeout(timer);
      socket.off(event, handler);
      resolve(data);
    };
    socket.on(event, handler);
  });
}

/** Resolve if the event does NOT arrive within the time window. */
export function expectNoEvent(socket: Socket, event: string, predicate: (data: any) => boolean = () => true, ms = 400): Promise<void> {
  return new Promise((resolve, reject) => {
    const handler = (data: unknown) => {
      if (!predicate(data)) return;
      socket.off(event, handler);
      clearTimeout(timer);
      reject(new Error(`unexpected ${event}: ${JSON.stringify(data)}`));
    };
    const timer = setTimeout(() => {
      socket.off(event, handler);
      resolve();
    }, ms);
    socket.on(event, handler);
  });
}

/** Create a server owned by `owner` and have `others` join through an invite. */
export async function serverWith(owner: Client, others: Client[], template = 'default') {
  const bundle = await owner.createServer('Squad', template);
  const invite = await owner.ok('POST', `/api/servers/${bundle.server.id}/invites`, {});
  for (const c of others) await c.ok('POST', `/api/invites/${invite.code}`);
  const text = bundle.channels.find((ch) => ch.type === 'text')!;
  const voice = bundle.channels.find((ch) => ch.type === 'voice')!;
  return { bundle, serverId: bundle.server.id, text, voice, invite };
}
