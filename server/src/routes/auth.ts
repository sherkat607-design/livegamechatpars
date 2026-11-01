import { eq, or } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { LIMITS, USERNAME_RE } from '@shared/constants';
import type { AppContext } from '../context';
import { users } from '../db/schema';
import { hashPassword, verifyPassword } from '../lib/auth';
import { conflict, parse, unauthorized } from '../lib/errors';
import { selfUser } from '../lib/serialize';

const registerSchema = z.object({
  username: z
    .string()
    .trim()
    .toLowerCase()
    .regex(USERNAME_RE, 'Use 2-32 lowercase letters, digits, "." or "_"'),
  displayName: z.string().trim().max(LIMITS.displayNameMax).optional(),
  email: z.string().trim().toLowerCase().email().max(254),
  password: z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax),
  locale: z.enum(['fa', 'en']).optional(),
});

const loginSchema = z.object({
  login: z.string().trim().toLowerCase().min(1).max(254),
  password: z.string().min(1).max(LIMITS.passwordMax),
});

export default async function authRoutes(app: FastifyInstance, ctx: AppContext) {
  // Sign-ups per IP; generous because many users can share one IP on mobile networks.
  const signupLimit = { config: { rateLimit: { max: 60, timeWindow: '1 minute' } } };
  // Password guessing is limited per account name, whatever IP it comes from.
  const loginLimit = {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: '1 minute',
        hook: 'preHandler' as const,
        keyGenerator: (req: FastifyRequest) => {
          const login = (req.body as { login?: unknown } | undefined)?.login;
          return typeof login === 'string' && login.trim() ? `login:${login.trim().toLowerCase().slice(0, 254)}` : `ip:${req.ip}`;
        },
      },
    },
  };

  app.post('/api/auth/register', signupLimit, async (req, reply) => {
    const body = parse(registerSchema, req.body);
    const existing = await ctx.db
      .select({ username: users.username, email: users.email })
      .from(users)
      .where(or(eq(users.username, body.username), eq(users.email, body.email)));
    if (existing.some((u) => u.username === body.username)) throw conflict('username_taken', 'Username is taken');
    if (existing.some((u) => u.email === body.email)) throw conflict('email_taken', 'Email is already registered');
    const [user] = await ctx.db
      .insert(users)
      .values({
        username: body.username,
        displayName: body.displayName || body.username,
        email: body.email,
        passwordHash: await hashPassword(body.password),
        locale: body.locale ?? 'fa',
      })
      .returning();
    const token = await ctx.auth.setCookie(reply, user);
    reply.code(201);
    return { user: selfUser(user, ctx.presence), token };
  });

  app.post('/api/auth/login', loginLimit, async (req, reply) => {
    const body = parse(loginSchema, req.body);
    const [user] = await ctx.db
      .select()
      .from(users)
      .where(or(eq(users.username, body.login), eq(users.email, body.login)));
    if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
      throw unauthorized('invalid_credentials', 'Wrong username or password');
    }
    const token = await ctx.auth.setCookie(reply, user);
    return { user: selfUser(user, ctx.presence), token };
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    ctx.auth.clearCookie(reply);
    return { ok: true };
  });

  // Like /me, but answers 200 with user: null for visitors (no console noise on public pages).
  app.get('/api/auth/session', async (req) => {
    const user = await ctx.auth.userFromToken(ctx.auth.tokenFromRequest(req));
    return { user: user ? selfUser(user, ctx.presence) : null };
  });

  app.get('/api/auth/me', { preHandler: ctx.auth.requireUser }, async (req) => {
    return { user: selfUser(req.user, ctx.presence) };
  });
}
