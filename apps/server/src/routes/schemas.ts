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

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  color: hex.default('#D7191C'),
  icon: z.string().max(16).nullable().default(null),
  sort_order: z.number().int().default(0),
  active: z.boolean().default(true),
});

export const productSchema = z.object({
  sku: z.string().trim().max(40).nullable().default(null),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(200).default(''),
  category_id: z.number().int().positive().nullable().default(null),
  price_usd_cents: cents,
  unit: z.string().trim().min(1).max(20).default('kg'),
  image_path: mediaPath.default(null),
  badge: z.enum(['oferta', 'nuevo', 'destacado']).nullable().default(null),
  is_offer: z.boolean().default(false),
  offer_price_usd_cents: cents.nullable().default(null),
  active: z.boolean().default(true),
  sold_out: z.boolean().default(false),
  sort_order: z.number().int().default(0),
});

export const promoSchema = z.object({
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(160).default(''),
  image_path: mediaPath.default(null),
  starts_at: isoOrNull.default(null),
  ends_at: isoOrNull.default(null),
  active: z.boolean().default(true),
});

export const screenSchema = z.object({
  name: z.string().trim().min(1).max(60),
  title: z.string().trim().max(60).default(''),
  layout: z.enum(['hero', 'grid', 'menu', 'offers', 'promo']).default('grid'),
  grid_cols: z.number().int().min(1).max(6).default(3),
  grid_rows: z.number().int().min(1).max(12).default(2),
  rotation_seconds: z.number().int().min(3).max(600).default(10),
  orientation: z.enum(['landscape', 'portrait']).default('landscape'),
  low_power: z.boolean().default(false),
  active: z.boolean().default(true),
});

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
  })
  .partial();
