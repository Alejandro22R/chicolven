import type { Settings } from '@chicolven/shared/types';
import { STORE } from '@chicolven/shared/brand';
import type { DB } from '../index.ts';

export const DEFAULT_SETTINGS: Settings = {
  store_name: STORE.name,
  store_rif: STORE.rif,
  logo_path: null,
  rounding_step_cents: 1,
  rounding_mode: 'nearest',
  show_usd: true,
  show_bs: true,
  primary_currency: 'usd',
  ticker_message: '¡Bienvenidos a Chicolven! Charcutería fresca todos los días • Precios en dólares calculados a la tasa BCV del día',
  low_power: false,
  rate_mode: 'today',
  rate_source_mode: 'auto',
  rate_providers: ['bcv', 'dolarapi'],
  rate_custom_sources: [],
  rate_max_jump_pct: 15,
  rate_adjust_bp: 0,
  rate_stale_hours: 36,
  rate_fetch_minutes: 30,
  store_open_hour: 7,
  store_close_hour: 21,
  bcv_insecure_tls: true,
  rate_daily_enabled: true,
  rate_daily_time: '20:00',
  rate_poll_enabled: true,
  header_logo_scale: 100,
  transition_logo_scale: 100,
  card_bg_color: '#0A0A0A',
  card_text_color: '#FFFFFF',
  card_image_scale: 100,
  footer_rate_style: 'red',
};

/** Internal keys that are never sent to the admin panel. */
const PRIVATE_KEYS = new Set(['admin_pin_hash']);

export class SettingsRepo {
  constructor(private db: DB) {}

  getAll(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const out: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const row of rows) {
      if (PRIVATE_KEYS.has(row.key) || !(row.key in DEFAULT_SETTINGS)) continue;
      try {
        out[row.key] = JSON.parse(row.value);
      } catch {
        // ignore corrupt values and keep the default
      }
    }
    return out as unknown as Settings;
  }

  update(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    );
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (!(key in DEFAULT_SETTINGS) || value === undefined) continue;
        stmt.run(key, JSON.stringify(value));
      }
    })();
    return this.getAll();
  }

  getRaw(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : null;
  }

  setRaw(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }
}
