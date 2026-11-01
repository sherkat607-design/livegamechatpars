import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { eq } from 'drizzle-orm';
import { jwtVerify, SignJWT } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Db } from '../db';
import { users, type UserRow } from '../db/schema';
import { unauthorized } from './errors';

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, keylen: number, opts: object) => Promise<Buffer>;
const SCRYPT = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export const COOKIE_NAME = 'lgcp_token';
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, 64, SCRYPT);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, n, r, p, saltB64, hashB64] = stored.split('$');
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export class AuthService {
  private key: Uint8Array;

  constructor(
    private db: Db,
    secret: string,
    private secureCookies: boolean,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async sign(user: Pick<UserRow, 'id' | 'tokenVersion'>): Promise<string> {
    return new SignJWT({ tv: user.tokenVersion })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(String(user.id))
      .setIssuedAt()
      .setExpirationTime(`${TOKEN_TTL_SECONDS}s`)
      .sign(this.key);
  }

  /** Returns the user for a token, or null if the token is invalid or revoked. */
  async userFromToken(token: string | undefined): Promise<UserRow | null> {
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
      const id = Number(payload.sub);
      if (!Number.isInteger(id)) return null;
      const [user] = await this.db.select().from(users).where(eq(users.id, id));
      if (!user || user.tokenVersion !== payload.tv) return null;
      return user;
    } catch {
      return null;
    }
  }

  /**
   * Rate-limit key: the signed-in account when the token's signature checks out, otherwise the IP.
   * Many mobile users share one IP behind carrier NAT, so limits must follow accounts.
   */
  rateKey = async (req: FastifyRequest): Promise<string> => {
    const token = this.tokenFromRequest(req);
    if (token) {
      try {
        const { payload } = await jwtVerify(token, this.key, { algorithms: ['HS256'] });
        if (payload.sub) return `u:${payload.sub}`;
      } catch {
        // fall through to the IP
      }
    }
    return `ip:${req.ip}`;
  };

  tokenFromRequest(req: FastifyRequest): string | undefined {
    const header = req.headers.authorization;
    if (header?.startsWith('Bearer ')) return header.slice(7);
    return req.cookies?.[COOKIE_NAME];
  }

  async setCookie(reply: FastifyReply, user: Pick<UserRow, 'id' | 'tokenVersion'>) {
    const token = await this.sign(user);
    reply.setCookie(COOKIE_NAME, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: this.secureCookies,
      path: '/',
      maxAge: TOKEN_TTL_SECONDS,
    });
    return token;
  }

  clearCookie(reply: FastifyReply) {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
  }

  /** Fastify preHandler: loads req.user or answers 401. */
  requireUser = async (req: FastifyRequest) => {
    const user = await this.userFromToken(this.tokenFromRequest(req));
    if (!user) throw unauthorized();
    req.user = user;
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    user: UserRow;
  }
}
