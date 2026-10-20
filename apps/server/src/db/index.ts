import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { MIGRATIONS } from './migrations.ts';

export type DB = Database.Database;

/** Opens (or creates) the SQLite database in WAL mode and applies pending migrations. */
export function openDatabase(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

export function migrate(db: DB): void {
  const current = db.pragma('user_version', { simple: true }) as number;
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]!);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}

export const nowIso = (): string => new Date().toISOString();

/** SQLite stores booleans as 0/1; converts the listed keys back to booleans. */
export function withBooleans<T>(row: unknown, keys: readonly string[]): T {
  const out = { ...(row as Record<string, unknown>) };
  for (const key of keys) out[key] = Boolean(out[key]);
  return out as T;
}
