import { createHash } from 'node:crypto';
import type {
  Layout,
  PlayerPayload,
  PlayerProduct,
  Product,
  ProductSlide,
  Promo,
  RateInfo,
  Screen,
  Settings,
  Slide,
} from '@chicolven/shared/types';
import { formatBs, formatUsd, usdCentsToBsCents, type RoundingOptions } from '@chicolven/shared/money';
import { BRAND } from '@chicolven/shared/brand';
import type { Repos } from '../db/repositories/index.ts';

export interface PriceContext {
  rateE4: number | null;
  rounding: RoundingOptions;
}

export function priceContext(settings: Settings, rate: RateInfo | null): PriceContext {
  return {
    rateE4: rate ? rate.effective_rate_e4 : null,
    rounding: { stepCents: settings.rounding_step_cents, mode: settings.rounding_mode },
  };
}

/** USD price in cents → Bs in céntimos, or null when there is no rate. */
export function bsCents(usdCents: number, ctx: PriceContext): number | null {
  return ctx.rateE4 === null ? null : usdCentsToBsCents(usdCents, ctx.rateE4, ctx.rounding);
}

/** Display prices for a product; offers show the offer price and the regular one crossed out. */
export function toPlayerProduct(p: Product, ctx: PriceContext): PlayerProduct {
  const onOffer = p.is_offer && p.offer_price_usd_cents !== null && p.offer_price_usd_cents < p.price_usd_cents;
  const priceCents = onOffer ? p.offer_price_usd_cents! : p.price_usd_cents;
  const bs = bsCents(priceCents, ctx);
  const oldBs = onOffer ? bsCents(p.price_usd_cents, ctx) : null;
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    unit: p.unit,
    image: p.image_path ? `/media/${p.image_path}` : null,
    badge: p.badge ?? (p.is_offer ? 'oferta' : null),
    is_offer: p.is_offer,
    sold_out: p.sold_out,
    usd: formatUsd(priceCents),
    bs: bs === null ? null : formatBs(bs),
    old_usd: onOffer ? formatUsd(p.price_usd_cents) : null,
    old_bs: oldBs === null ? null : formatBs(oldBs),
  };
}

function promoIsLive(promo: Promo, now: Date): boolean {
  if (!promo.active) return false;
  const t = now.getTime();
  if (promo.starts_at && new Date(promo.starts_at).getTime() > t) return false;
  if (promo.ends_at && new Date(promo.ends_at).getTime() < t) return false;
  return true;
}

/** How many products fit on one slide of a layout. */
export function pageSize(screen: Screen, layout: Layout): number {
  if (layout === 'hero' || layout === 'offers') return 1;
  return Math.max(1, screen.grid_cols * screen.grid_rows);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

interface Group {
  title: string;
  color: string;
  products: Product[];
  duration_s: number | null;
  offers: boolean;
}

/**
 * Builds everything a TV needs to render: slides with already-formatted prices, rate, ticker.
 * The player does no money math.
 */
export function buildPlayerPayload(repos: Repos, screen: Screen, rate: RateInfo | null, now = new Date()): PlayerPayload {
  const settings = repos.settings.getAll();
  const ctx = priceContext(settings, rate);
  const categories = new Map(repos.categories.list().map((c) => [c.id, c]));
  const products = repos.products
    .list({ active: true })
    .filter((p) => p.category_id === null || categories.get(p.category_id)?.active !== false);
  const productById = new Map(products.map((p) => [p.id, p]));
  const promos = repos.promos.list().filter((p) => promoIsLive(p, now));
  const promoById = new Map(promos.map((p) => [p.id, p]));
  const offers = () => products.filter((p) => p.is_offer);

  const entries: (Group | { promo: Promo; duration_s: number | null })[] = [];
  const playlist = repos.screens.playlist(screen.id);

  if (screen.layout === 'promo') {
    const items = playlist.filter((i) => i.item_type === 'promo');
    const list = items.length
      ? items.map((i) => ({ promo: promoById.get(i.ref_id ?? -1), duration_s: i.duration_s }))
      : promos.map((promo) => ({ promo, duration_s: null }));
    for (const e of list) if (e.promo) entries.push({ promo: e.promo, duration_s: e.duration_s });
  } else if (playlist.length === 0) {
    // Default: every active category with products, then offers are just badges, then live promos.
    for (const cat of categories.values()) {
      if (!cat.active) continue;
      const list = products.filter((p) => p.category_id === cat.id);
      if (list.length) entries.push({ title: cat.name, color: cat.color, products: list, duration_s: null, offers: false });
    }
    const loose = products.filter((p) => p.category_id === null);
    if (loose.length) entries.push({ title: screen.title || 'Productos', color: BRAND.red, products: loose, duration_s: null, offers: false });
    for (const promo of promos) entries.push({ promo, duration_s: null });
  } else {
    let pendingProducts: Group | null = null;
    const flush = () => {
      if (pendingProducts && pendingProducts.products.length) entries.push(pendingProducts);
      pendingProducts = null;
    };
    for (const item of playlist) {
      if (item.item_type === 'product') {
        const p = productById.get(item.ref_id ?? -1);
        if (!p) continue;
        pendingProducts ??= { title: screen.title || 'Productos', color: BRAND.red, products: [], duration_s: item.duration_s, offers: false };
        pendingProducts.products.push(p);
        continue;
      }
      flush();
      if (item.item_type === 'category') {
        const cat = categories.get(item.ref_id ?? -1);
        if (!cat || !cat.active) continue;
        const list = products.filter((p) => p.category_id === cat.id);
        if (list.length) entries.push({ title: cat.name, color: cat.color, products: list, duration_s: item.duration_s, offers: false });
      } else if (item.item_type === 'offers') {
        const list = offers();
        if (list.length) entries.push({ title: '¡Ofertas!', color: BRAND.red, products: list, duration_s: item.duration_s, offers: true });
      } else if (item.item_type === 'promo') {
        const promo = promoById.get(item.ref_id ?? -1);
        if (promo) entries.push({ promo, duration_s: item.duration_s });
      }
    }
    flush();
  }

  const slides: Slide[] = [];
  for (const entry of entries) {
    const duration = entry.duration_s ?? screen.rotation_seconds;
    if ('promo' in entry) {
      slides.push({
        type: 'promo',
        title: entry.promo.title,
        subtitle: entry.promo.subtitle,
        image: entry.promo.image_path ? `/media/${entry.promo.image_path}` : null,
        duration_s: duration,
      });
      continue;
    }
    let layout = screen.layout as ProductSlide['layout'];
    if (entry.offers && (layout === 'hero' || layout === 'offers')) layout = 'offers';
    for (const page of chunk(entry.products, pageSize(screen, layout))) {
      slides.push({
        type: 'products',
        layout,
        title: entry.title,
        color: entry.color,
        duration_s: duration,
        cols: screen.grid_cols,
        rows: screen.grid_rows,
        items: page.map((p) => toPlayerProduct(p, ctx)),
      });
    }
  }

  const body = {
    screen: {
      id: screen.id,
      name: screen.name,
      title: screen.title,
      layout: screen.layout,
      orientation: screen.orientation,
      low_power: screen.low_power || settings.low_power,
    },
    store: {
      name: settings.store_name,
      rif: settings.store_rif,
      logo: settings.logo_path ? `/media/${settings.logo_path}` : null,
    },
    display: { show_usd: settings.show_usd, show_bs: settings.show_bs, primary: settings.primary_currency },
    theme: {
      header_logo_scale: settings.header_logo_scale,
      transition_logo_scale: settings.transition_logo_scale,
      card_bg_color: settings.card_bg_color,
      card_text_color: settings.card_text_color,
      card_image_scale: settings.card_image_scale,
      footer_rate_style: settings.footer_rate_style,
    },
    rate,
    ticker: settings.ticker_message,
    slides,
  };
  const version = createHash('sha1').update(JSON.stringify(body)).digest('hex').slice(0, 12);
  return { version, generated_at: now.toISOString(), ...body };
}
