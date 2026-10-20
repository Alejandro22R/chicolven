import { openDatabase } from '../src/db/index.ts';
import { createRepos, type Repos } from '../src/db/repositories/index.ts';
import type { ProductInput } from '../src/db/repositories/catalog.ts';
import type { ScreenInput } from '../src/db/repositories/screens.ts';

export function memoryRepos(): Repos {
  return createRepos(openDatabase(':memory:'));
}

export function product(overrides: Partial<ProductInput> = {}): ProductInput {
  return {
    sku: null,
    name: 'Jamón',
    description: '',
    category_id: null,
    price_usd_cents: 1000,
    unit: 'kg',
    image_path: null,
    badge: null,
    is_offer: false,
    offer_price_usd_cents: null,
    active: true,
    sold_out: false,
    sort_order: 0,
    ...overrides,
  };
}

export function screen(overrides: Partial<ScreenInput> = {}): ScreenInput {
  return {
    name: 'TV',
    title: 'Precios',
    layout: 'grid',
    grid_cols: 3,
    grid_rows: 2,
    rotation_seconds: 10,
    orientation: 'landscape',
    low_power: false,
    active: true,
    ...overrides,
  };
}
