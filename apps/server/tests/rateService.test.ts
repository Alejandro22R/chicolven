import { describe, expect, it, vi } from 'vitest';
import { RateService } from '../src/services/rateService.ts';
import type { RateProvider, RateQuote } from '../src/providers/types.ts';
import { memoryRepos } from './helpers.ts';

function fixed(quote: Partial<RateQuote> & { rate_e4: number }, id = 'bcv'): RateProvider {
  return { id, label: id, fetch: async () => ({ source: id, effective_date: null, ...quote }) };
}

function failing(id: string): RateProvider {
  return {
    id,
    label: id,
    fetch: async () => {
      throw new Error(`${id} caído`);
    },
  };
}

// 2026-10-20 15:00 in Caracas
const NOW = new Date('2026-10-20T19:00:00Z');

describe('RateService', () => {
  it('falls back to the next provider and stores the rate', async () => {
    const repos = memoryRepos();
    const service = new RateService(repos, {
      now: () => NOW,
      providers: { bcv: failing('bcv'), dolarapi: fixed({ rate_e4: 2056789 }, 'dolarapi') },
    });
    const result = await service.refresh();
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([{ provider: 'bcv', error: 'bcv caído' }]);
    const current = service.current()!;
    expect(current.rate_e4).toBe(2056789);
    expect(current.display).toBe('205,68');
    expect(current.source).toBe('dolarapi');
    expect(current.effective_date).toBe('2026-10-20');
    expect(service.status().find((s) => s.id === 'bcv')?.last_error).toBe('bcv caído');
  });

  it('keeps the last stored rate when every provider fails (offline)', async () => {
    const repos = memoryRepos();
    const ok = new RateService(repos, { now: () => NOW, providers: { bcv: fixed({ rate_e4: 2000000 }) } });
    await ok.refresh();
    const offline = new RateService(repos, { now: () => NOW, providers: { bcv: failing('bcv'), dolarapi: failing('dolarapi') } });
    const result = await offline.refresh();
    expect(result.ok).toBe(false);
    expect(offline.current()?.rate_e4).toBe(2000000);
  });

  it('holds big jumps as pending until the admin confirms', async () => {
    const repos = memoryRepos();
    let value = 2000000;
    const onChange = vi.fn();
    const service = new RateService(repos, {
      now: () => NOW,
      onChange,
      providers: { bcv: { id: 'bcv', label: 'bcv', fetch: async () => ({ source: 'bcv', rate_e4: value, effective_date: null }) } },
    });
    await service.refresh();
    value = 2500000; // +25 % → suspicious
    const result = await service.refresh();
    expect(result.pending).toBe(true);
    expect(service.current()?.rate_e4).toBe(2000000);
    expect(repos.rates.pending()).toHaveLength(1);

    service.setStatus(result.rate!.id, 'ok');
    expect(service.current()?.rate_e4).toBe(2500000);
    expect(onChange).toHaveBeenCalled();
  });

  it('accepts small changes directly and does not duplicate identical polls', async () => {
    const repos = memoryRepos();
    let value = 2000000;
    const service = new RateService(repos, {
      now: () => NOW,
      providers: { bcv: { id: 'bcv', label: 'bcv', fetch: async () => ({ source: 'bcv', rate_e4: value, effective_date: null }) } },
    });
    await service.refresh();
    await service.refresh();
    expect(repos.rates.history()).toHaveLength(1);
    value = 2100000; // +5 %
    await service.refresh();
    expect(service.current()?.rate_e4).toBe(2100000);
    expect(repos.rates.history()).toHaveLength(2);
  });

  it("uses today's rate, not tomorrow's, in 'today' mode", () => {
    const repos = memoryRepos();
    const service = new RateService(repos, { now: () => NOW, providers: {} });
    service.accept({ source: 'bcv', rate_e4: 2000000, effective_date: '2026-10-20' });
    service.accept({ source: 'bcv', rate_e4: 2050000, effective_date: '2026-10-21' }); // published at 4 pm for tomorrow
    expect(service.current()?.rate_e4).toBe(2000000);
    repos.settings.update({ rate_mode: 'latest' });
    expect(service.current()?.rate_e4).toBe(2050000);
  });

  it('gives a manual rate priority for its date and supports manual-only mode', () => {
    const repos = memoryRepos();
    const service = new RateService(repos, { now: () => NOW, providers: {} });
    service.accept({ source: 'bcv', rate_e4: 2000000, effective_date: '2026-10-20' });
    service.setManual(2010000, '2026-10-20', null);
    expect(service.current()?.is_manual).toBe(true);
    expect(service.current()?.rate_e4).toBe(2010000);
    // a newer automatic rate (next day) wins again once it is effective
    const tomorrow = new RateService(repos, { now: () => new Date('2026-10-21T15:00:00Z'), providers: {} });
    tomorrow.accept({ source: 'bcv', rate_e4: 2020000, effective_date: '2026-10-21' });
    expect(tomorrow.current()?.rate_e4).toBe(2020000);
    repos.settings.update({ rate_source_mode: 'manual' });
    expect(tomorrow.current()?.rate_e4).toBe(2010000);
  });

  it('applies the configured adjustment and flags stale rates', () => {
    const repos = memoryRepos();
    let now = NOW;
    const service = new RateService(repos, { now: () => now, providers: {} });
    service.accept({ source: 'bcv', rate_e4: 2000000, effective_date: '2026-10-20' });
    repos.settings.update({ rate_adjust_bp: 200 });
    expect(service.current()?.effective_rate_e4).toBe(2040000);
    expect(service.current()?.stale).toBe(false);
    now = new Date(NOW.getTime() + 40 * 3_600_000);
    expect(service.current()?.stale).toBe(true);
  });

  it('only polls when due', async () => {
    const repos = memoryRepos();
    const fetch = vi.fn(async () => ({ source: 'bcv', rate_e4: 2000000, effective_date: null }));
    let now = NOW;
    const service = new RateService(repos, { now: () => now, providers: { bcv: { id: 'bcv', label: 'bcv', fetch } } });
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 10 * 60_000);
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = new Date(NOW.getTime() + 31 * 60_000);
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('queries every day at 20:00 Caracas time and only once per day', async () => {
    const repos = memoryRepos();
    repos.settings.update({ rate_poll_enabled: false });
    const fetch = vi.fn(async () => ({ source: 'bcv', rate_e4: 2000000, effective_date: null }));
    let now = new Date('2026-10-20T15:00:00Z'); // 11:00 Caracas
    const service = new RateService(repos, { now: () => now, providers: { bcv: { id: 'bcv', label: 'bcv', fetch } } });
    service.setManual(1990000, '2026-10-20', null);

    await service.tick();
    expect(fetch).not.toHaveBeenCalled();

    now = new Date('2026-10-20T23:59:00Z'); // 19:59
    await service.tick();
    expect(fetch).not.toHaveBeenCalled();

    now = new Date('2026-10-21T00:00:00Z'); // 20:00
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(service.dailyStatus().last_done).toBe('2026-10-20');

    now = new Date('2026-10-21T01:30:00Z'); // 21:30, already done today
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1);

    now = new Date('2026-10-22T00:01:00Z'); // next day 20:01
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('retries the daily query every 5 minutes until it succeeds, also after a restart', async () => {
    const repos = memoryRepos();
    repos.settings.update({ rate_poll_enabled: false, rate_daily_time: '20:00' });
    repos.rates.insert({ source: 'manual', rate_e4: 2000000, effective_date: '2026-10-20', fetched_at: '2026-10-20T12:00:00Z', is_manual: true, status: 'ok' });
    let ok = false;
    const fetch = vi.fn(async () => {
      if (!ok) throw new Error('sin internet');
      return { source: 'bcv', rate_e4: 2010000, effective_date: '2026-10-21' };
    });
    let now = new Date('2026-10-21T00:10:00Z'); // 20:10 — server started after 20:00
    const service = new RateService(repos, { now: () => now, providers: { bcv: { id: 'bcv', label: 'bcv', fetch } } });
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1);
    now = new Date('2026-10-21T00:12:00Z');
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(1); // waits 5 minutes
    ok = true;
    now = new Date('2026-10-21T00:15:00Z');
    await service.tick();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(service.dailyStatus().last_done).toBe('2026-10-20');
  });

  it('can disable the daily query', async () => {
    const repos = memoryRepos();
    repos.settings.update({ rate_poll_enabled: false, rate_daily_enabled: false });
    repos.rates.insert({ source: 'manual', rate_e4: 2000000, effective_date: '2026-10-20', fetched_at: '2026-10-20T12:00:00Z', is_manual: true, status: 'ok' });
    const fetch = vi.fn(async () => ({ source: 'bcv', rate_e4: 2000000, effective_date: null }));
    const service = new RateService(repos, { now: () => new Date('2026-10-21T00:30:00Z'), providers: { bcv: { id: 'bcv', label: 'bcv', fetch } } });
    await service.tick();
    expect(fetch).not.toHaveBeenCalled();
  });
});
