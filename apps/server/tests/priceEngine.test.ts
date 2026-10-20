import { describe, expect, it } from 'vitest';
import type { RateInfo } from '@chicolven/shared/types';
import { buildPlayerPayload, toPlayerProduct } from '../src/services/priceEngine.ts';
import { memoryRepos, product, screen } from './helpers.ts';

const rate: RateInfo = {
  rate_e4: 365012,
  effective_rate_e4: 365012,
  display: '36,50',
  source: 'bcv',
  effective_date: '2026-10-20',
  fetched_at: '2026-10-20T12:00:00Z',
  is_manual: false,
  stale: false,
};

describe('toPlayerProduct', () => {
  const ctx = { rateE4: 365012, rounding: { stepCents: 1, mode: 'nearest' as const } };

  it('formats USD and Bs', () => {
    const p = toPlayerProduct({ ...product({ price_usd_cents: 500 }), id: 1, updated_at: '' }, ctx);
    expect(p.usd).toBe('$ 5,00');
    expect(p.bs).toBe('Bs 182,51');
    expect(p.old_usd).toBeNull();
  });

  it('shows the offer price with the regular one crossed out', () => {
    const p = toPlayerProduct(
      { ...product({ price_usd_cents: 1150, is_offer: true, offer_price_usd_cents: 990 }), id: 1, updated_at: '' },
      ctx,
    );
    expect(p.usd).toBe('$ 9,90');
    expect(p.old_usd).toBe('$ 11,50');
    expect(p.bs).toBe('Bs 361,36');
    expect(p.old_bs).toBe('Bs 419,76');
    expect(p.badge).toBe('oferta');
  });

  it('omits Bs when there is no rate', () => {
    const p = toPlayerProduct({ ...product(), id: 1, updated_at: '' }, { ...ctx, rateE4: null });
    expect(p.bs).toBeNull();
    expect(p.usd).toBe('$ 10,00');
  });

  it('applies the configured rounding', () => {
    const p = toPlayerProduct({ ...product({ price_usd_cents: 500 }), id: 1, updated_at: '' }, { rateE4: 365012, rounding: { stepCents: 50, mode: 'up' } });
    expect(p.bs).toBe('Bs 183,00');
  });
});

describe('buildPlayerPayload', () => {
  it('shows every active category by default, paginated by the grid size', () => {
    const repos = memoryRepos();
    const cat = repos.categories.create({ name: 'Quesos', color: '#FFD21F', icon: null, sort_order: 0, active: true });
    for (let i = 0; i < 8; i++) repos.products.create(product({ name: `Queso ${i}`, category_id: cat.id, sort_order: i }));
    repos.products.create(product({ name: 'Oculto', category_id: cat.id, active: false }));
    const s = repos.screens.create(screen({ grid_cols: 3, grid_rows: 2 }));
    const payload = buildPlayerPayload(repos, s, rate);
    expect(payload.slides).toHaveLength(2);
    expect(payload.slides[0]).toMatchObject({ type: 'products', title: 'Quesos', layout: 'grid' });
    const names = payload.slides.flatMap((sl) => (sl.type === 'products' ? sl.items.map((i) => i.name) : []));
    expect(names).toHaveLength(8);
    expect(names).not.toContain('Oculto');
  });

  it('follows the playlist: category, offers and promos', () => {
    const repos = memoryRepos();
    const cat = repos.categories.create({ name: 'Charcutería', color: '#D7191C', icon: null, sort_order: 0, active: true });
    repos.products.create(product({ name: 'Jamón', category_id: cat.id }));
    repos.products.create(product({ name: 'Mortadela', is_offer: true, offer_price_usd_cents: 500 }));
    const promo = repos.promos.create({ title: 'Promo', subtitle: '', image_path: null, starts_at: null, ends_at: null, active: true });
    const expired = repos.promos.create({ title: 'Vieja', subtitle: '', image_path: null, starts_at: null, ends_at: '2020-01-01T00:00:00Z', active: true });
    const s = repos.screens.create(screen({ layout: 'hero' }));
    repos.screens.setPlaylist(s.id, [
      { item_type: 'category', ref_id: cat.id, duration_s: 7 },
      { item_type: 'offers', ref_id: null, duration_s: null },
      { item_type: 'promo', ref_id: promo.id, duration_s: null },
      { item_type: 'promo', ref_id: expired.id, duration_s: null },
    ]);
    const payload = buildPlayerPayload(repos, s, rate);
    expect(payload.slides.map((x) => (x.type === 'promo' ? `promo:${x.title}` : `${x.layout}:${x.title}`))).toEqual([
      'hero:Charcutería',
      'offers:¡Ofertas!',
      'promo:Promo',
    ]);
    expect(payload.slides[0]!.duration_s).toBe(7);
    expect(payload.slides[1]!.duration_s).toBe(10);
  });

  it('changes version when a price changes', () => {
    const repos = memoryRepos();
    const p = repos.products.create(product());
    const s = repos.screens.create(screen());
    const v1 = buildPlayerPayload(repos, s, rate).version;
    expect(buildPlayerPayload(repos, s, rate).version).toBe(v1);
    repos.products.update(p.id, { price_usd_cents: 1100 });
    expect(buildPlayerPayload(repos, s, rate).version).not.toBe(v1);
  });
});
