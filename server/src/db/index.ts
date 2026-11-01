import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';
import { drizzle as drizzlePglite, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate as migratePglite } from 'drizzle-orm/pglite/migrator';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import * as schema from './schema';

export type Db = PgliteDatabase<typeof schema>;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close: () => Promise<void>;
}

// Works both from src/db (tsx, vitest) and from the bundled dist/index.js.
function migrationsFolder(): string {
  const fromSource = import.meta.url.includes('/src/db/');
  return fileURLToPath(new URL(fromSource ? '../../drizzle' : '../drizzle', import.meta.url));
}

/**
 * Opens the database and applies migrations.
 * - `postgres://...` / `postgresql://...` → a real PostgreSQL server (production)
 * - `memory`                              → in-memory embedded Postgres (tests)
 * - any other value                       → embedded Postgres (PGlite) stored in that folder
 */
export async function openDatabase(url: string): Promise<DbHandle> {
  const folder = migrationsFolder();
  if (/^postgres(ql)?:\/\//.test(url)) {
    const pool = new pg.Pool({ connectionString: url, max: 10 });
    const db = drizzlePg(pool, { schema, casing: 'snake_case' });
    await migratePg(db, { migrationsFolder: folder });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }
  let client: PGlite;
  if (url === 'memory') {
    client = new PGlite();
  } else {
    mkdirSync(url, { recursive: true });
    client = new PGlite(url);
  }
  const db = drizzlePglite(client, { schema, casing: 'snake_case' });
  await migratePglite(db, { migrationsFolder: folder });
  return { db, kind: 'pglite', close: () => client.close() };
}

export { schema };
