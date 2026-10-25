import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Where the app lives:
 * - repo checkout: src/config.ts (dev) and dist/server.mjs (build) are three levels below the root;
 * - packaged .exe: the folder that contains the executable (CHICOLVEN_ROOT is set by the bundle).
 */
function rootDir(): string {
  if (process.env.CHICOLVEN_ROOT) return process.env.CHICOLVEN_ROOT;
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
}

export const ROOT_DIR = rootDir();

export interface AppConfig {
  port: number;
  host: string;
  /** Name announced on the local network: http://<localName>.local */
  localName: string;
  dataDir: string;
  dbFile: string;
  mediaDir: string;
  backupDir: string;
  playerDir: string;
  adminDir: string;
}

/** Reads KEY=VALUE lines from config.ini next to the app (packaged version); # starts a comment. */
export function readIni(file: string): Record<string, string> {
  if (!fs.existsSync(file)) return {};
  const out: Record<string, string> = {};
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq).trim().toUpperCase()] = line.slice(eq + 1).trim();
  }
  return out;
}

/** Packaged layout keeps the web files in web/; the repo keeps them under apps/. */
function firstExisting(...dirs: string[]): string {
  return dirs.find((d) => fs.existsSync(d)) ?? dirs[dirs.length - 1]!;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const ini = readIni(path.join(ROOT_DIR, 'config.ini'));
  const get = (key: string) => env[key] ?? env[`CHICOLVEN_${key}`] ?? ini[key];
  const dataDir = path.resolve(ROOT_DIR, get('DATA') ?? 'data');
  const name = (get('NOMBRE') ?? get('LOCAL_NAME') ?? 'chicolven').toLowerCase().replace(/[^a-z0-9-]/g, '') || 'chicolven';
  return {
    port: Number(get('PORT') ?? 3000),
    host: get('HOST') ?? '0.0.0.0',
    localName: name,
    dataDir,
    dbFile: path.join(dataDir, 'chicolven.db'),
    mediaDir: path.join(dataDir, 'media'),
    backupDir: path.join(dataDir, 'backups'),
    playerDir: firstExisting(path.join(ROOT_DIR, 'web', 'player'), path.join(ROOT_DIR, 'apps', 'player', 'public')),
    adminDir: firstExisting(path.join(ROOT_DIR, 'web', 'admin'), path.join(ROOT_DIR, 'apps', 'admin', 'dist')),
  };
}
