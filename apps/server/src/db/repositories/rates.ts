import type { ExchangeRate, RateStatus } from '@chicolven/shared/types';
import { withBooleans, type DB } from '../index.ts';

const RATE_BOOLS = ['is_manual'] as const;

export interface NewRate {
  source: string;
  rate_e4: number;
  effective_date: string;
  fetched_at: string;
  is_manual: boolean;
  status: RateStatus;
  note?: string | null;
}

export class RateRepo {
  constructor(private db: DB) {}

  get(id: number): ExchangeRate | null {
    const row = this.db.prepare('SELECT * FROM exchange_rates WHERE id = ?').get(id);
    return row ? withBooleans<ExchangeRate>(row, RATE_BOOLS) : null;
  }

  /**
   * Inserts a rate. If the latest row from the same source and effective date already has the
   * same value and status, only its fetched_at is refreshed (avoids one row per poll).
   */
  insert(rate: NewRate): ExchangeRate {
    const existing = this.db
      .prepare(
        `SELECT id FROM exchange_rates WHERE source = ? AND effective_date = ? AND rate_e4 = ? AND status = ?
         AND is_manual = ? ORDER BY id DESC LIMIT 1`,
      )
      .get(rate.source, rate.effective_date, rate.rate_e4, rate.status, rate.is_manual ? 1 : 0) as
      | { id: number }
      | undefined;
    if (existing && !rate.is_manual) {
      this.db.prepare('UPDATE exchange_rates SET fetched_at = ? WHERE id = ?').run(rate.fetched_at, existing.id);
      return this.get(existing.id)!;
    }
    const info = this.db
      .prepare(
        `INSERT INTO exchange_rates (source, rate_e4, effective_date, fetched_at, is_manual, status, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(rate.source, rate.rate_e4, rate.effective_date, rate.fetched_at, rate.is_manual ? 1 : 0, rate.status, rate.note ?? null);
    return this.get(Number(info.lastInsertRowid))!;
  }

  setStatus(id: number, status: RateStatus): ExchangeRate | null {
    this.db.prepare('UPDATE exchange_rates SET status = ? WHERE id = ?').run(status, id);
    return this.get(id);
  }

  /**
   * The active rate: most recent accepted rate whose effective date is on or before `today`
   * (or any date when `today` is null). For the same date a manual rate wins.
   */
  active(today: string | null, manualOnly: boolean): ExchangeRate | null {
    const where = ["status = 'ok'"];
    const params: unknown[] = [];
    if (today) {
      where.push('effective_date <= ?');
      params.push(today);
    }
    if (manualOnly) where.push('is_manual = 1');
    const row = this.db
      .prepare(
        `SELECT * FROM exchange_rates WHERE ${where.join(' AND ')}
         ORDER BY effective_date DESC, is_manual DESC, fetched_at DESC, id DESC LIMIT 1`,
      )
      .get(...params);
    if (row) return withBooleans<ExchangeRate>(row, RATE_BOOLS);
    // Nothing effective yet (e.g. only a future-dated rate): fall back to the oldest accepted one
    // rather than leaving the screens without prices.
    if (today) {
      const any = this.db
        .prepare(
          `SELECT * FROM exchange_rates WHERE status = 'ok' ${manualOnly ? 'AND is_manual = 1' : ''}
           ORDER BY effective_date ASC, fetched_at DESC LIMIT 1`,
        )
        .get();
      return any ? withBooleans<ExchangeRate>(any, RATE_BOOLS) : null;
    }
    return null;
  }

  history(limit = 60): ExchangeRate[] {
    return this.db
      .prepare('SELECT * FROM exchange_rates ORDER BY fetched_at DESC, id DESC LIMIT ?')
      .all(limit)
      .map((r) => withBooleans<ExchangeRate>(r, RATE_BOOLS));
  }

  pending(): ExchangeRate[] {
    return this.db
      .prepare("SELECT * FROM exchange_rates WHERE status = 'pending' ORDER BY fetched_at DESC")
      .all()
      .map((r) => withBooleans<ExchangeRate>(r, RATE_BOOLS));
  }
}
