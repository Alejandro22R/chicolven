/**
 * Schema migrations, applied in order and tracked with PRAGMA user_version.
 * Kept as TS strings so the server bundles into a single file.
 * Money: USD in integer cents; rates as integer × 10_000 (4 decimals).
 */
export const MIGRATIONS: string[] = [
  /* 1: initial schema */ `
  CREATE TABLE categories (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    color TEXT NOT NULL DEFAULT '#D7191C',
    icon TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    sku TEXT UNIQUE,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    category_id INTEGER REFERENCES categories(id) ON DELETE SET NULL,
    price_usd_cents INTEGER NOT NULL CHECK (price_usd_cents >= 0),
    unit TEXT NOT NULL DEFAULT 'kg',
    image_path TEXT,
    badge TEXT,
    is_offer INTEGER NOT NULL DEFAULT 0,
    offer_price_usd_cents INTEGER CHECK (offer_price_usd_cents IS NULL OR offer_price_usd_cents >= 0),
    active INTEGER NOT NULL DEFAULT 1,
    sold_out INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_products_category ON products(category_id, sort_order);

  CREATE TABLE screens (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    layout TEXT NOT NULL DEFAULT 'grid',
    grid_cols INTEGER NOT NULL DEFAULT 3,
    grid_rows INTEGER NOT NULL DEFAULT 2,
    rotation_seconds INTEGER NOT NULL DEFAULT 10,
    orientation TEXT NOT NULL DEFAULT 'landscape',
    low_power INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE promos (
    id INTEGER PRIMARY KEY,
    title TEXT NOT NULL,
    subtitle TEXT NOT NULL DEFAULT '',
    image_path TEXT,
    starts_at TEXT,
    ends_at TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE playlist_items (
    id INTEGER PRIMARY KEY,
    screen_id INTEGER NOT NULL REFERENCES screens(id) ON DELETE CASCADE,
    item_type TEXT NOT NULL CHECK (item_type IN ('product','category','promo','offers')),
    ref_id INTEGER,
    position INTEGER NOT NULL DEFAULT 0,
    duration_s INTEGER
  );
  CREATE INDEX idx_playlist_screen ON playlist_items(screen_id, position);

  CREATE TABLE exchange_rates (
    id INTEGER PRIMARY KEY,
    source TEXT NOT NULL,
    rate_e4 INTEGER NOT NULL CHECK (rate_e4 > 0),
    effective_date TEXT NOT NULL,
    fetched_at TEXT NOT NULL,
    is_manual INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','pending','rejected')),
    note TEXT
  );
  CREATE INDEX idx_rates_effective ON exchange_rates(status, effective_date, fetched_at);

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE price_history (
    id INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    old_usd_cents INTEGER NOT NULL,
    new_usd_cents INTEGER NOT NULL,
    changed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX idx_price_history_product ON price_history(product_id, changed_at);

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL
  );
  `,
];
