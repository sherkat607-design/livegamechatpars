import { existsSync } from 'node:fs';
import { extname } from 'node:path';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import type { Config } from './config';
import type { AppContext } from './context';
import { openDatabase } from './db';
import { Gateway } from './gateway';
import { AuthService } from './lib/auth';
import { HttpError } from './lib/errors';
import { PresenceTracker } from './lib/presence';
import { UploadService } from './lib/uploads';
import authRoutes from './routes/auth';
import channelRoutes from './routes/channels';
import emojiWebhookRoutes from './routes/emojis';
import inviteRoutes from './routes/invites';
import memberRoutes from './routes/members';
import messageRoutes from './routes/messages';
import roleRoutes from './routes/roles';
import searchRoutes from './routes/search';
import serverRoutes from './routes/servers';
import socialRoutes from './routes/social';
import userRoutes from './routes/users';

// Files shown inline by the browser; everything else downloads.
const INLINE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.ogg', '.wav', '.m4a', '.txt']);

export interface BuiltApp {
  app: FastifyInstance;
  ctx: AppContext;
  close: () => Promise<void>;
}

export async function buildApp(config: Config): Promise<BuiltApp> {
  const database = await openDatabase(config.databaseUrl);
  const app = Fastify({
    logger: config.logLevel === 'silent' ? false : { level: config.logLevel },
    trustProxy: config.trustProxy,
    bodyLimit: 1024 * 1024,
  });

  const ctx = {
    db: database.db,
    config,
    presence: new PresenceTracker(),
    uploads: new UploadService(config.uploadsDir, config.maxUploadMB * 1024 * 1024),
  } as AppContext;
  ctx.auth = new AuthService(database.db, config.jwtSecret, config.secureCookies);
  ctx.gateway = new Gateway(ctx, app.server);

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        fontSrc: ["'self'", 'data:'],
        connectSrc: ["'self'", 'ws:', 'wss:'],
        frameSrc: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });
  if (config.rateLimit) {
    await app.register(rateLimit, {
      max: 600,
      timeWindow: '1 minute',
      errorResponseBuilder: (_req, context) =>
        Object.assign(new Error('Too many requests'), {
          statusCode: 429,
          code: 'rate_limited',
          retryAfter: Math.ceil(context.ttl / 1000),
        }),
    });
  }
  await app.register(multipart, {
    limits: {
      fileSize: config.maxUploadMB * 1024 * 1024,
      files: 10,
      fields: 10,
      fieldSize: 64 * 1024,
    },
  });

  await app.register(fastifyStatic, {
    root: config.uploadsDir,
    prefix: '/uploads/',
    decorateReply: false,
    index: false,
    list: false,
    dotfiles: 'deny',
    setHeaders(res, filePath) {
      res.header('X-Content-Type-Options', 'nosniff');
      res.header('Content-Security-Policy', "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
      res.header('Cache-Control', 'public, max-age=31536000, immutable');
      res.header('Cross-Origin-Resource-Policy', 'same-origin');
      if (!INLINE_EXT.has(extname(filePath).toLowerCase())) res.header('Content-Disposition', 'attachment');
    },
  });

  app.setErrorHandler((err: FastifyError & { retryAfter?: number }, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.status).send({ error: err.code, message: err.message, ...err.extra });
    }
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '23505') return reply.code(409).send({ error: 'conflict', message: 'Already exists' });
    if (pgCode === '23503') return reply.code(400).send({ error: 'invalid_reference', message: 'Referenced item not found' });
    if (err.statusCode === 429) {
      return reply.code(429).send({ error: 'rate_limited', message: err.message, retryAfter: err.retryAfter });
    }
    if (err.code === 'FST_REQ_FILE_TOO_LARGE' || err.statusCode === 413) {
      return reply.code(413).send({ error: 'file_too_large', message: 'File is too large' });
    }
    if (err.validation || err.code === 'FST_ERR_CTP_INVALID_MEDIA_TYPE' || err.code === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
      return reply.code(400).send({ error: 'bad_request', message: err.message });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: err.code ?? 'bad_request', message: err.message });
    }
    req.log.error(err);
    return reply.code(500).send({ error: 'internal', message: 'Something went wrong' });
  });

  app.get('/api/health', async () => ({ ok: true, db: database.kind }));

  for (const routes of [
    authRoutes,
    userRoutes,
    socialRoutes,
    serverRoutes,
    channelRoutes,
    messageRoutes,
    roleRoutes,
    memberRoutes,
    inviteRoutes,
    emojiWebhookRoutes,
    searchRoutes,
  ]) {
    await routes(app, ctx);
  }

  // Serve the built web client and fall back to index.html for client-side routes.
  if (config.clientDist && existsSync(config.clientDist)) {
    await app.register(fastifyStatic, {
      root: config.clientDist,
      prefix: '/',
      wildcard: false,
      setHeaders(res, filePath) {
        if (filePath.includes('/assets/')) res.header('Cache-Control', 'public, max-age=31536000, immutable');
        else res.header('Cache-Control', 'no-cache');
      },
    });
  }
  app.setNotFoundHandler((req, reply) => {
    const isPage =
      req.method === 'GET' && !req.url.startsWith('/api/') && !req.url.startsWith('/uploads/') && !req.url.startsWith('/socket.io');
    if (isPage && config.clientDist && existsSync(config.clientDist)) {
      return reply.header('Cache-Control', 'no-cache').sendFile('index.html');
    }
    return reply.code(404).send({ error: 'not_found', message: 'Not found' });
  });

  return {
    app,
    ctx,
    close: async () => {
      ctx.gateway.close();
      await app.close();
      await database.close();
    },
  };
}
