import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Both src/config.ts (dev) and dist/server.mjs (build) live three levels below the repo root.
const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = process.env.CHICOLVEN_ROOT ?? path.resolve(here, '..', '..', '..');

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  dbFile: string;
  mediaDir: string;
  backupDir: string;
  playerDir: string;
  adminDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const dataDir = path.resolve(env.CHICOLVEN_DATA ?? path.join(ROOT_DIR, 'data'));
  return {
    port: Number(env.PORT ?? 3000),
    host: env.HOST ?? '0.0.0.0',
    dataDir,
    dbFile: path.join(dataDir, 'chicolven.db'),
    mediaDir: path.join(dataDir, 'media'),
    backupDir: path.join(dataDir, 'backups'),
    playerDir: path.join(ROOT_DIR, 'apps', 'player', 'public'),
    adminDir: path.join(ROOT_DIR, 'apps', 'admin', 'dist'),
  };
}
