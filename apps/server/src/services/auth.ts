import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { DB } from '../db/index.ts';
import type { SettingsRepo } from '../db/repositories/settings.ts';

export const DEFAULT_PIN = '1234';
const SESSION_DAYS = 30;

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `scrypt$${salt.toString('hex')}$${hash.toString('hex')}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split('$');
  if (scheme !== 'scrypt' || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(pin, Buffer.from(saltHex, 'hex'), expected.length);
  return timingSafeEqual(actual, expected);
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

/** Single-PIN admin auth with persistent session tokens (only their hash is stored). */
export class AuthService {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private db: DB,
    private settings: SettingsRepo,
  ) {}

  usingDefaultPin(): boolean {
    return this.settings.getRaw('admin_pin_hash') === null;
  }

  checkPin(pin: string): boolean {
    const stored = this.settings.getRaw('admin_pin_hash');
    return stored === null ? pin === DEFAULT_PIN : verifyPin(pin, stored);
  }

  setPin(pin: string): void {
    this.settings.setRaw('admin_pin_hash', hashPin(pin));
    // Changing the PIN logs out every other session.
    this.db.prepare('DELETE FROM sessions').run();
  }

  /** Returns false when the client exceeded 5 failed attempts in the last minute. */
  allowAttempt(key: string): boolean {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) return true;
    return entry.count < 5;
  }

  recordFailure(key: string): void {
    const now = Date.now();
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) this.attempts.set(key, { count: 1, resetAt: now + 60_000 });
    else entry.count++;
  }

  createSession(): string {
    const token = randomBytes(32).toString('hex');
    const now = new Date();
    const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000);
    this.db.prepare("DELETE FROM sessions WHERE expires_at < ?").run(now.toISOString());
    this.db
      .prepare('INSERT INTO sessions (token_hash, created_at, expires_at) VALUES (?, ?, ?)')
      .run(sha256(token), now.toISOString(), expires.toISOString());
    return token;
  }

  validate(token: string | undefined | null): boolean {
    if (!token) return false;
    const row = this.db.prepare('SELECT expires_at FROM sessions WHERE token_hash = ?').get(sha256(token)) as
      | { expires_at: string }
      | undefined;
    return Boolean(row && row.expires_at > new Date().toISOString());
  }

  revoke(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token));
  }
}
