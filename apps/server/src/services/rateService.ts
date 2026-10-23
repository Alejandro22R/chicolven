import type { ExchangeRate, RateInfo, Settings } from '@chicolven/shared/types';
import { applyRateAdjust, formatRate, rateChangeBp } from '@chicolven/shared/money';
import type { Repos } from '../db/repositories/index.ts';
import { bcvProvider } from '../providers/bcvScrape.ts';
import { dolarApiProvider } from '../providers/dolarApi.ts';
import { jsonSourceProvider } from '../providers/jsonSource.ts';
import { assertSaneRate, type RateProvider, type RateQuote } from '../providers/types.ts';
import { caracasDate, caracasHour, caracasMinutes } from './time.ts';
import type { EventLog } from './eventLog.ts';

export interface ProviderStatus {
  id: string;
  label: string;
  last_attempt: string | null;
  last_success: string | null;
  last_error: string | null;
}

export interface RefreshResult {
  ok: boolean;
  rate?: ExchangeRate;
  pending?: boolean;
  errors: { provider: string; error: string }[];
}

export interface RateServiceOptions {
  /** Override providers (tests). Keys are provider ids. */
  providers?: Record<string, RateProvider>;
  now?: () => Date;
  timeoutMs?: number;
  log?: EventLog;
  /** Called whenever the active rate may have changed. */
  onChange?: () => void;
}

const RETRY_MINUTES = 5;
/** Settings key (private) with the Caracas date of the last successful daily query. */
const DAILY_DONE_KEY = 'rate_daily_last';
const MAX_RETRIES = 3;

export class RateService {
  private providerStatus = new Map<string, ProviderStatus>();
  private inflight: Promise<RefreshResult> | null = null;
  private lastAttemptAt = 0;
  private failures = 0;
  private lastActiveKey: string | null = null;
  private now: () => Date;

  constructor(
    private repos: Repos,
    private opts: RateServiceOptions = {},
  ) {
    this.now = opts.now ?? (() => new Date());
  }

  private settings(): Settings {
    return this.repos.settings.getAll();
  }

  /** Providers in the configured order (A: BCV, B: DolarApi, C: custom JSON sources). */
  providers(settings = this.settings()): RateProvider[] {
    if (this.opts.providers) {
      const ids = settings.rate_providers.filter((id) => this.opts.providers![id]);
      return (ids.length ? ids : Object.keys(this.opts.providers)).map((id) => this.opts.providers![id]!);
    }
    const builtIn: Record<string, RateProvider> = {
      bcv: bcvProvider({ insecureTls: () => this.settings().bcv_insecure_tls }),
      dolarapi: dolarApiProvider(),
    };
    const list = settings.rate_providers.map((id) => builtIn[id]).filter((p): p is RateProvider => Boolean(p));
    for (const custom of settings.rate_custom_sources) list.push(jsonSourceProvider(custom));
    return list;
  }

  /** The rate currently used for prices, or null if none was ever stored. */
  activeRate(settings = this.settings()): ExchangeRate | null {
    const today = settings.rate_mode === 'today' ? caracasDate(this.now()) : null;
    return this.repos.rates.active(today, settings.rate_source_mode === 'manual');
  }

  current(settings = this.settings()): RateInfo | null {
    const rate = this.activeRate(settings);
    if (!rate) return null;
    const effective = applyRateAdjust(rate.rate_e4, settings.rate_adjust_bp);
    const ageMs = this.now().getTime() - new Date(rate.fetched_at).getTime();
    return {
      rate_e4: rate.rate_e4,
      effective_rate_e4: effective,
      display: formatRate(effective),
      source: rate.source,
      effective_date: rate.effective_date,
      fetched_at: rate.fetched_at,
      is_manual: rate.is_manual,
      stale: ageMs > settings.rate_stale_hours * 3_600_000,
    };
  }

  status(): ProviderStatus[] {
    return this.providers().map(
      (p) =>
        this.providerStatus.get(p.id) ?? { id: p.id, label: p.label, last_attempt: null, last_success: null, last_error: null },
    );
  }

  /** Queries providers in order until one succeeds. Concurrent calls share the same request. */
  refresh(): Promise<RefreshResult> {
    if (!this.inflight) {
      this.inflight = this.doRefresh().finally(() => {
        this.inflight = null;
      });
    }
    return this.inflight;
  }

  private async doRefresh(): Promise<RefreshResult> {
    const settings = this.settings();
    this.lastAttemptAt = this.now().getTime();
    const errors: RefreshResult['errors'] = [];
    for (const provider of this.providers(settings)) {
      const st: ProviderStatus = this.providerStatus.get(provider.id) ?? {
        id: provider.id,
        label: provider.label,
        last_attempt: null,
        last_success: null,
        last_error: null,
      };
      st.last_attempt = this.now().toISOString();
      this.providerStatus.set(provider.id, st);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.opts.timeoutMs ?? 15_000);
      try {
        const quote = await provider.fetch(controller.signal);
        st.last_success = this.now().toISOString();
        st.last_error = null;
        const result = this.accept(quote, settings);
        this.failures = 0;
        return { ok: true, rate: result.rate, pending: result.pending, errors };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        st.last_error = message;
        errors.push({ provider: provider.id, error: message });
      } finally {
        clearTimeout(timer);
      }
    }
    this.failures++;
    this.opts.log?.add('warn', `No se pudo obtener la tasa: ${errors.map((e) => `${e.provider}: ${e.error}`).join(' | ') || 'sin proveedores'}`);
    return { ok: false, errors };
  }

  /**
   * Validates and stores a quote. Rates that jump more than the configured % against the
   * active rate are stored as "pending" and need confirmation from the admin.
   */
  accept(quote: RateQuote, settings = this.settings()): { rate: ExchangeRate; pending: boolean } {
    assertSaneRate(quote.rate_e4, quote.source);
    const fetchedAt = this.now().toISOString();
    const effectiveDate = quote.effective_date ?? caracasDate(this.now());
    const previous = this.repos.rates.active(null, false);
    const jumpBp = previous ? rateChangeBp(previous.rate_e4, quote.rate_e4) : 0;
    const pending = previous !== null && jumpBp > settings.rate_max_jump_pct * 100;
    const rate = this.repos.rates.insert({
      source: quote.source,
      rate_e4: quote.rate_e4,
      effective_date: effectiveDate,
      fetched_at: fetchedAt,
      is_manual: false,
      status: pending ? 'pending' : 'ok',
      note: pending ? `Variación de ${(jumpBp / 100).toFixed(2)} % respecto a la tasa anterior` : null,
    });
    if (pending) {
      this.opts.log?.add('warn', `Tasa ${formatRate(quote.rate_e4, 4)} de ${quote.source} requiere confirmación (${(jumpBp / 100).toFixed(2)} %)`);
    }
    this.checkActiveChanged();
    return { rate, pending };
  }

  setManual(rateE4: number, effectiveDate: string | null, note: string | null): ExchangeRate {
    assertSaneRate(rateE4, 'manual');
    const rate = this.repos.rates.insert({
      source: 'manual',
      rate_e4: rateE4,
      effective_date: effectiveDate ?? caracasDate(this.now()),
      fetched_at: this.now().toISOString(),
      is_manual: true,
      status: 'ok',
      note,
    });
    this.opts.log?.add('info', `Tasa manual registrada: ${formatRate(rateE4, 4)} (${rate.effective_date})`);
    this.checkActiveChanged(true);
    return rate;
  }

  setStatus(id: number, status: 'ok' | 'rejected'): ExchangeRate | null {
    const rate = this.repos.rates.setStatus(id, status);
    if (rate) {
      this.opts.log?.add('info', `Tasa ${formatRate(rate.rate_e4, 4)} ${status === 'ok' ? 'confirmada' : 'rechazada'}`);
      this.checkActiveChanged(true);
    }
    return rate;
  }

  /** Daily query state shown in the admin panel. */
  dailyStatus(settings = this.settings()): { enabled: boolean; time: string; last_done: string | null; next: string } {
    const lastDone = this.repos.settings.getRaw(DAILY_DONE_KEY);
    const today = caracasDate(this.now());
    const doneToday = lastDone === today;
    const passed = caracasMinutes(this.now()) >= parseHHMM(settings.rate_daily_time);
    return {
      enabled: settings.rate_daily_enabled,
      time: settings.rate_daily_time,
      last_done: lastDone,
      next: doneToday || passed ? 'mañana' : 'hoy',
    };
  }

  /**
   * Called every minute by the scheduler:
   * - the daily query at the configured time (20:00 by default), retried every 5 min until it
   *   succeeds that day; the date is persisted so a restart after 20:00 still runs it;
   * - optional periodic checks during store hours, with faster retries after failures;
   * - a query at start-up when there is no rate at all;
   * - notifies when the active rate changes (e.g. at midnight when tomorrow's rate takes effect).
   */
  async tick(): Promise<void> {
    this.checkActiveChanged();
    const settings = this.settings();
    if (settings.rate_source_mode === 'manual') return;
    const now = this.now();
    const minutesSince = (now.getTime() - this.lastAttemptAt) / 60_000;
    const today = caracasDate(now);

    if (
      settings.rate_daily_enabled &&
      caracasMinutes(now) >= parseHHMM(settings.rate_daily_time) &&
      this.repos.settings.getRaw(DAILY_DONE_KEY) !== today &&
      (this.lastAttemptAt === 0 || minutesSince >= RETRY_MINUTES)
    ) {
      this.opts.log?.add('info', `Consulta diaria de la tasa (${settings.rate_daily_time})`);
      const result = await this.refresh();
      if (result.ok) this.repos.settings.setRaw(DAILY_DONE_KEY, today);
      return;
    }

    const hour = caracasHour(now);
    const open = hour >= settings.store_open_hour && hour < settings.store_close_hour;
    const active = this.activeRate(settings);
    const missingToday = !active || active.effective_date < today;
    let due = false;
    if (this.failures > 0 && this.failures <= MAX_RETRIES) due = minutesSince >= RETRY_MINUTES;
    else if (settings.rate_poll_enabled && (open || missingToday)) due = minutesSince >= settings.rate_fetch_minutes;
    else if (!active && this.lastAttemptAt === 0) due = true;
    if (due) await this.refresh();
  }

  /** Emits onChange when the active rate (or the forced flag) differs from last time. */
  checkActiveChanged(force = false): void {
    const settings = this.settings();
    const active = this.activeRate(settings);
    const key = active ? `${active.id}:${active.rate_e4}:${settings.rate_adjust_bp}` : 'none';
    if (force || key !== this.lastActiveKey) {
      const first = this.lastActiveKey === null;
      this.lastActiveKey = key;
      if (!first || force) this.opts.onChange?.();
    }
  }
}

/** "20:00" → 1200 minutes since midnight. */
function parseHHMM(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}
