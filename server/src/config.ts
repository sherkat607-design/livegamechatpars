import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { ClientConfig } from '@shared/types';

export interface Config {
  port: number;
  host: string;
  /** postgres://... for PostgreSQL, "memory" for tests, or a folder for embedded Postgres. */
  databaseUrl: string;
  dataDir: string;
  uploadsDir: string;
  jwtSecret: string;
  /** Folder with the built client to serve, if any. */
  clientDist: string | null;
  iceServers: ClientConfig['iceServers'];
  maxUploadMB: number;
  secureCookies: boolean;
  trustProxy: boolean;
  logLevel: string;
  /** Disable rate limits (tests). */
  rateLimit: boolean;
  /** Origins of native apps allowed to call the API (Capacitor uses https://localhost on Android). */
  corsOrigins: string[];
}

function parseIceServers(env: NodeJS.ProcessEnv): ClientConfig['iceServers'] {
  if (env.ICE_SERVERS) {
    try {
      const parsed = JSON.parse(env.ICE_SERVERS);
      if (Array.isArray(parsed)) return parsed;
    } catch {
      throw new Error('ICE_SERVERS must be a JSON array, e.g. [{"urls":"stun:stun.l.google.com:19302"}]');
    }
  }
  const servers: ClientConfig['iceServers'] = [{ urls: 'stun:stun.l.google.com:19302' }];
  if (env.TURN_URL) {
    servers.push({ urls: env.TURN_URL, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL });
  }
  return servers;
}

function loadSecret(env: NodeJS.ProcessEnv, dataDir: string): string {
  if (env.JWT_SECRET) {
    if (env.JWT_SECRET.length < 32) throw new Error('JWT_SECRET must be at least 32 characters');
    return env.JWT_SECRET;
  }
  // Generate once and keep it next to the data so logins survive restarts.
  const file = join(dataDir, '.jwt-secret');
  if (existsSync(file)) return readFileSync(file, 'utf8').trim();
  const secret = randomBytes(48).toString('base64url');
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env, overrides: Partial<Config> = {}): Config {
  const dataDir = resolve(overrides.dataDir ?? env.DATA_DIR ?? './data');
  mkdirSync(dataDir, { recursive: true });
  const uploadsDir = overrides.uploadsDir ?? join(dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const production = env.NODE_ENV === 'production';
  const base: Config = {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    databaseUrl: env.DATABASE_URL ?? join(dataDir, 'db'),
    dataDir,
    uploadsDir,
    jwtSecret: overrides.jwtSecret ?? loadSecret(env, dataDir),
    clientDist: env.CLIENT_DIST ?? null,
    iceServers: parseIceServers(env),
    maxUploadMB: Number(env.MAX_UPLOAD_MB ?? 25),
    secureCookies: env.SECURE_COOKIES ? env.SECURE_COOKIES === 'true' : production,
    trustProxy: env.TRUST_PROXY === 'true',
    logLevel: env.LOG_LEVEL ?? (production ? 'info' : 'debug'),
    rateLimit: env.RATE_LIMIT !== 'false',
    corsOrigins: (env.CORS_ORIGINS ?? 'https://localhost,http://localhost,capacitor://localhost')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean),
  };
  return { ...base, ...overrides };
}
