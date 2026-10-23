import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';
import { openDatabase } from '../src/db/index.ts';

let app: FastifyInstance;
let dataDir: string;
let token: string;

async function call(method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, payload?: unknown, auth = true) {
  const res = await app.inject({
    method,
    url,
    payload: payload as never,
    headers: auth ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.statusCode, body: res.headers['content-type']?.includes('json') ? res.json() : res.body };
}

beforeEach(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'chicolven-test-'));
  const config = loadConfig({ CHICOLVEN_DATA: dataDir });
  app = await buildApp({
    config,
    db: openDatabase(config.dbFile),
    rateOptions: { providers: { bcv: { id: 'bcv', label: 'bcv', fetch: async () => ({ source: 'bcv', rate_e4: 365012, effective_date: null }) } } },
  });
  await app.ready();
  const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { pin: '1234' } });
  token = login.json().token;
});

afterEach(async () => {
  await app.close();
  app.ctx.db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('auth', () => {
  it('protects admin routes and rejects wrong PINs', async () => {
    expect((await call('GET', '/api/admin/products', undefined, false)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { pin: '0000' }, false)).status).toBe(401);
  });

  it('changes the PIN and invalidates old sessions', async () => {
    const res = await call('POST', '/api/auth/pin', { current: '1234', next: '908172' });
    expect(res.status).toBe(200);
    expect((await call('GET', '/api/admin/products')).status).toBe(401);
    token = res.body.token;
    expect((await call('GET', '/api/admin/products')).status).toBe(200);
    expect((await call('POST', '/api/auth/login', { pin: '1234' }, false)).status).toBe(401);
    expect((await call('POST', '/api/auth/login', { pin: '908172' }, false)).status).toBe(200);
  });

  it('rate-limits brute force attempts', async () => {
    for (let i = 0; i < 5; i++) await call('POST', '/api/auth/login', { pin: '0000' }, false);
    expect((await call('POST', '/api/auth/login', { pin: '1234' }, false)).status).toBe(429);
  });
});

describe('catalog and player', () => {
  it('creates products and serves formatted prices to the TV', async () => {
    await call('POST', '/api/admin/rates/refresh');
    const cat = (await call('POST', '/api/admin/categories', { name: 'Quesos' })).body;
    await call('POST', '/api/admin/products', { name: 'Queso blanco', price_usd_cents: 500, category_id: cat.id });
    const screen = (await call('POST', '/api/admin/screens', { name: 'TV 1' })).body;

    const tv = await call('GET', `/api/player/${screen.id}`, undefined, false);
    expect(tv.status).toBe(200);
    expect(tv.body.rate.display).toBe('36,50');
    expect(tv.body.slides[0].items[0]).toMatchObject({ name: 'Queso blanco', usd: '$ 5,00', bs: 'Bs 182,51' });

    // Appearance settings reach the TV
    await call('PUT', '/api/admin/settings', { card_bg_color: '#0A0A0A', card_text_color: '#FFFFFF', footer_rate_style: 'black', header_logo_scale: 140 });
    const themed = await call('GET', `/api/player/${screen.id}`, undefined, false);
    expect(themed.body.theme).toEqual({
      header_logo_scale: 140,
      transition_logo_scale: 100,
      card_bg_color: '#0A0A0A',
      card_text_color: '#FFFFFF',
      card_image_scale: 100,
      footer_rate_style: 'black',
    });
  });

  it('validates input', async () => {
    expect((await call('POST', '/api/admin/products', { name: '', price_usd_cents: 100 })).status).toBe(400);
    expect((await call('POST', '/api/admin/products', { name: 'X', price_usd_cents: 1.5 })).status).toBe(400);
    expect((await call('POST', '/api/admin/products', { name: 'X', price_usd_cents: 100, image_path: '../../etc/passwd' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/settings', { rounding_step_cents: 7 })).status).toBe(400);
    expect((await call('PUT', '/api/admin/settings', { rate_daily_time: '25:00' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/settings', { card_bg_color: 'black' })).status).toBe(400);
    expect((await call('PUT', '/api/admin/settings', { header_logo_scale: 500 })).status).toBe(400);
    expect((await call('PUT', '/api/admin/settings', { card_image_scale: 10 })).status).toBe(400);
  });

  it('records price history', async () => {
    const p = (await call('POST', '/api/admin/products', { name: 'Jamón', price_usd_cents: 1000 })).body;
    await call('PUT', `/api/admin/products/${p.id}`, { price_usd_cents: 1100 });
    await call('PUT', `/api/admin/products/${p.id}`, { name: 'Jamón de pierna' }); // no price change
    const history = (await call('GET', `/api/admin/price-history?product_id=${p.id}`)).body;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ old_usd_cents: 1000, new_usd_cents: 1100 });
  });

  it('bulk-adjusts a category', async () => {
    const cat = (await call('POST', '/api/admin/categories', { name: 'Charcutería' })).body;
    await call('POST', '/api/admin/products', { name: 'A', price_usd_cents: 1000, category_id: cat.id });
    await call('POST', '/api/admin/products', { name: 'B', price_usd_cents: 999 });
    const res = await call('POST', '/api/admin/products/bulk-adjust', { category_id: cat.id, percent_bp: 1000 });
    expect(res.body.updated).toBe(1);
    const list = (await call('GET', '/api/admin/products')).body as { name: string; price_usd_cents: number }[];
    expect(list.find((p) => p.name === 'A')?.price_usd_cents).toBe(1100);
    expect(list.find((p) => p.name === 'B')?.price_usd_cents).toBe(999);
  });

  it('round-trips CSV export and import', async () => {
    await call('POST', '/api/admin/products', { name: 'Mortadela', sku: 'M1', price_usd_cents: 690 });
    const csv = (await call('GET', '/api/admin/products/export.csv')).body as string;
    expect(csv).toContain('M1;Mortadela;;6,90;kg;;si;');
    const edited = csv.replace('6,90', '7,25') + 'P2;Pechuga de pavo;Charcutería;15,90;kg;;si;\r\n;;;;\r\nX;Sin precio;;abc;;;;\r\n';
    const res = await call('POST', '/api/admin/products/import', { csv: edited });
    expect(res.body).toMatchObject({ created: 1, updated: 1 });
    expect(res.body.errors).toHaveLength(1);
    const list = (await call('GET', '/api/admin/products')).body as { sku: string; price_usd_cents: number; category_id: number | null }[];
    expect(list.find((p) => p.sku === 'M1')?.price_usd_cents).toBe(725);
    expect(list.find((p) => p.sku === 'P2')?.category_id).not.toBeNull();
  });

  it('holds a suspicious automatic jump until the admin confirms it', async () => {
    const rates = app.ctx.rates;
    rates.accept({ source: 'bcv', rate_e4: 365000, effective_date: null });
    const { rate, pending } = rates.accept({ source: 'bcv', rate_e4: 500000, effective_date: null });
    expect(pending).toBe(true);
    expect((await call('GET', '/api/admin/rates')).body.pending).toHaveLength(1);
    await call('POST', `/api/admin/rates/${rate.id}/confirm`);
    expect((await call('GET', '/api/admin/rates')).body.current.rate_e4).toBe(500000);
  });

  it('creates and lists backups', async () => {
    const created = (await call('POST', '/api/admin/backups')).body;
    expect(created.name).toMatch(/^chicolven-.*\.db$/);
    expect((await call('GET', '/api/admin/backups')).body).toHaveLength(1);
    const download = await app.inject({ method: 'GET', url: `/api/admin/backups/${created.name}?token=${token}` });
    expect(download.statusCode).toBe(200);
    expect(download.rawPayload.subarray(0, 15).toString()).toBe('SQLite format 3');
    expect((await call('GET', '/api/admin/backups/..%2Fchicolven.db')).status).toBe(404);
  });
});

describe('live updates', () => {
  it('notifies connected TVs when a price changes', async () => {
    const p = (await call('POST', '/api/admin/products', { name: 'Jamón', price_usd_cents: 1000 })).body;
    const messages: string[] = [];
    const ws = await app.injectWS('/ws?role=player&screen=1', {}, {
      onInit: (socket) => socket.on('message', (data) => messages.push(JSON.parse(String(data)).type)),
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(messages).toContain('hello');
    expect(app.ctx.hub.status()).toEqual([expect.objectContaining({ screen_id: 1, connections: 1 })]);

    await call('PUT', `/api/admin/products/${p.id}`, { price_usd_cents: 1200 });
    await new Promise((r) => setTimeout(r, 400));
    expect(messages).toContain('content-changed');
    ws.terminate();
  });

  it('refuses admin sockets without a valid token', async () => {
    const closed = new Promise<number>((resolve) => {
      void app.injectWS('/ws?role=admin&token=nope', {}, { onInit: (socket) => socket.on('close', (code) => resolve(code)) });
    });
    expect(await closed).toBe(1008);
  });
});
