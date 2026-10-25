import { z } from 'zod';

const cents = z.number().int().min(0).max(100_000_000);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const mediaPath = z
  .string()
  .regex(/^[a-z0-9]+\.(webp|jpg|jpeg|png|gif)$/i)
  .nullable();
const isoOrNull = z
  .string()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Fecha inválida')
  .nullable();

export const idParam = z.object({ id: z.coerce.number().int().positive() });

/**
 * Each entity has a create schema (fills defaults) and an update schema (partial, no defaults).
 * They must stay separate: zod 4 applies .default() even inside .partial(), so a shared schema
 * would reset every untouched field on a partial update (e.g. editing only a price would wipe
 * the photo, category and offer).
 */
function entity<T extends z.ZodRawShape>(fields: T, defaults: Partial<z.output<z.ZodObject<T>>>) {
  const base = z.object(fields);
  return {
    create: z.preprocess((v) => (v && typeof v === 'object' && !Array.isArray(v) ? { ...defaults, ...v } : v), base),
    update: base.partial(),
  };
}

const category = entity(
  {
    name: z.string().trim().min(1).max(60),
    color: hex,
    icon: z.string().max(16).nullable(),
    sort_order: z.number().int(),
    active: z.boolean(),
  },
  { color: '#D7191C', icon: null, sort_order: 0, active: true },
);
export const categorySchema = category.create;
export const categoryPatchSchema = category.update;

const product = entity(
  {
    sku: z.string().trim().max(40).nullable(),
    name: z.string().trim().min(1).max(80),
    description: z.string().trim().max(200),
    category_id: z.number().int().positive().nullable(),
    price_usd_cents: cents,
    unit: z.string().trim().min(1).max(20),
    image_path: mediaPath,
    badge: z.enum(['oferta', 'nuevo', 'destacado']).nullable(),
    is_offer: z.boolean(),
    offer_price_usd_cents: cents.nullable(),
    active: z.boolean(),
    sold_out: z.boolean(),
    sort_order: z.number().int(),
  },
  {
    sku: null,
    description: '',
    category_id: null,
    unit: 'kg',
    image_path: null,
    badge: null,
    is_offer: false,
    offer_price_usd_cents: null,
    active: true,
    sold_out: false,
    sort_order: 0,
  },
);
export const productSchema = product.create;
export const productPatchSchema = product.update;

const promo = entity(
  {
    title: z.string().trim().min(1).max(80),
    subtitle: z.string().trim().max(160),
    image_path: mediaPath,
    starts_at: isoOrNull,
    ends_at: isoOrNull,
    active: z.boolean(),
  },
  { subtitle: '', image_path: null, starts_at: null, ends_at: null, active: true },
);
export const promoSchema = promo.create;
export const promoPatchSchema = promo.update;

const screen = entity(
  {
    name: z.string().trim().min(1).max(60),
    title: z.string().trim().max(60),
    layout: z.enum(['hero', 'grid', 'menu', 'offers', 'promo']),
    grid_cols: z.number().int().min(1).max(6),
    grid_rows: z.number().int().min(1).max(12),
    rotation_seconds: z.number().int().min(3).max(600),
    orientation: z.enum(['landscape', 'portrait']),
    low_power: z.boolean(),
    active: z.boolean(),
  },
  { title: '', layout: 'grid', grid_cols: 3, grid_rows: 2, rotation_seconds: 10, orientation: 'landscape', low_power: false, active: true },
);
export const screenSchema = screen.create;
export const screenPatchSchema = screen.update;

export const playlistSchema = z.array(
  z.object({
    item_type: z.enum(['product', 'category', 'promo', 'offers']),
    ref_id: z.number().int().positive().nullable().default(null),
    duration_s: z.number().int().min(3).max(600).nullable().default(null),
  }),
).max(500);

export const settingsSchema = z
  .object({
    store_name: z.string().trim().min(1).max(60),
    store_rif: z.string().trim().max(20),
    logo_path: mediaPath,
    rounding_step_cents: z.number().int().refine((v) => [1, 10, 50, 100, 500, 1000].includes(v)),
    rounding_mode: z.enum(['nearest', 'up', 'down']),
    show_usd: z.boolean(),
    show_bs: z.boolean(),
    primary_currency: z.enum(['usd', 'bs']),
    ticker_message: z.string().max(500),
    low_power: z.boolean(),
    rate_mode: z.enum(['today', 'latest']),
    rate_source_mode: z.enum(['auto', 'manual']),
    rate_providers: z.array(z.enum(['bcv', 'dolarapi'])).max(2),
    rate_custom_sources: z
      .array(
        z.object({
          name: z.string().trim().min(1).max(30),
          url: z.string().url().refine((u) => /^https?:\/\//.test(u)),
          rate_path: z.string().trim().min(1).max(100),
          date_path: z.string().trim().max(100).optional(),
        }),
      )
      .max(5),
    rate_max_jump_pct: z.number().min(1).max(100),
    rate_adjust_bp: z.number().int().min(-5000).max(5000),
    rate_stale_hours: z.number().int().min(1).max(240),
    rate_fetch_minutes: z.number().int().min(5).max(720),
    store_open_hour: z.number().int().min(0).max(23),
    store_close_hour: z.number().int().min(1).max(24),
    bcv_insecure_tls: z.boolean(),
    rate_daily_enabled: z.boolean(),
    rate_daily_time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Hora inválida (use HH:MM)'),
    rate_poll_enabled: z.boolean(),
    header_logo_scale: z.number().int().min(50).max(200),
    transition_logo_scale: z.number().int().min(50).max(200),
    card_bg_color: hex,
    card_text_color: hex,
    card_image_scale: z.number().int().min(50).max(150),
    footer_rate_style: z.enum(['red', 'black', 'white']),
  })
  .partial();
