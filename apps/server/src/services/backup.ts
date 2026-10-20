import fs from 'node:fs';
import path from 'node:path';
import type { DB } from '../db/index.ts';

const KEEP = 14;
const NAME_RE = /^chicolven-[\d-]+\.db$/;

export interface BackupInfo {
  name: string;
  size: number;
  created_at: string;
}

/** Daily SQLite backups (online, consistent) with rotation, plus restore-on-next-start. */
export class BackupService {
  constructor(
    private db: DB,
    private dir: string,
  ) {}

  async create(): Promise<BackupInfo> {
    fs.mkdirSync(this.dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
    const name = `chicolven-${stamp}.db`;
    await this.db.backup(path.join(this.dir, name));
    this.rotate();
    return this.info(name)!;
  }

  list(): BackupInfo[] {
    if (!fs.existsSync(this.dir)) return [];
    return fs
      .readdirSync(this.dir)
      .filter((n) => NAME_RE.test(n))
      .sort()
      .reverse()
      .map((n) => this.info(n)!)
      .filter(Boolean);
  }

  /** Resolves a backup name to its path, rejecting anything that is not a backup file. */
  resolve(name: string): string | null {
    if (!NAME_RE.test(name)) return null;
    const file = path.join(this.dir, name);
    return fs.existsSync(file) ? file : null;
  }

  /** Marks a backup to replace the database on the next start (the DB cannot be swapped while open). */
  scheduleRestore(name: string): boolean {
    if (!this.resolve(name)) return false;
    fs.writeFileSync(path.join(this.dir, 'restore.pending'), name);
    return true;
  }

  private info(name: string): BackupInfo | null {
    const file = path.join(this.dir, name);
    if (!fs.existsSync(file)) return null;
    const st = fs.statSync(file);
    return { name, size: st.size, created_at: st.mtime.toISOString() };
  }

  private rotate(): void {
    for (const old of this.list().slice(KEEP)) fs.rmSync(path.join(this.dir, old.name), { force: true });
  }
}

/** Applies a pending restore before the database is opened. Returns the restored backup name. */
export function applyPendingRestore(dbFile: string, backupDir: string): string | null {
  const marker = path.join(backupDir, 'restore.pending');
  if (!fs.existsSync(marker)) return null;
  const name = fs.readFileSync(marker, 'utf8').trim();
  fs.rmSync(marker, { force: true });
  if (!NAME_RE.test(name)) return null;
  const source = path.join(backupDir, name);
  if (!fs.existsSync(source)) return null;
  if (fs.existsSync(dbFile)) fs.copyFileSync(dbFile, `${dbFile}.before-restore`);
  for (const suffix of ['-wal', '-shm']) fs.rmSync(dbFile + suffix, { force: true });
  fs.copyFileSync(source, dbFile);
  return name;
}
