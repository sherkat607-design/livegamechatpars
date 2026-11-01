import type { Config } from './config';
import type { Db } from './db';
import type { Gateway } from './gateway';
import type { AuthService } from './lib/auth';
import type { PresenceTracker } from './lib/presence';
import type { UploadService } from './lib/uploads';

/** Everything route handlers and the gateway need, created once in app.ts. */
export interface AppContext {
  db: Db;
  config: Config;
  auth: AuthService;
  presence: PresenceTracker;
  uploads: UploadService;
  gateway: Gateway;
}
