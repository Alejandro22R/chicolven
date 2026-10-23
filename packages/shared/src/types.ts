/** Types shared by the server, the admin panel and (as documentation) the player. */

export type Layout = 'hero' | 'grid' | 'menu' | 'offers' | 'promo';
export const LAYOUTS: Layout[] = ['hero', 'grid', 'menu', 'offers', 'promo'];

export type Orientation = 'landscape' | 'portrait';
export type PlaylistItemType = 'product' | 'category' | 'promo' | 'offers';
export type Badge = 'oferta' | 'nuevo' | 'destacado' | null;
export type RateStatus = 'ok' | 'pending' | 'rejected';

export interface Category {
  id: number;
  name: string;
  color: string;
  icon: string | null;
  sort_order: number;
  active: boolean;
}

export interface Product {
  id: number;
  sku: string | null;
  name: string;
  description: string;
  category_id: number | null;
  price_usd_cents: number;
  unit: string;
  image_path: string | null;
  badge: Badge;
  is_offer: boolean;
  offer_price_usd_cents: number | null;
  active: boolean;
  sold_out: boolean;
  sort_order: number;
  updated_at: string;
}

export interface Screen {
  id: number;
  name: string;
  title: string;
  layout: Layout;
  grid_cols: number;
  grid_rows: number;
  rotation_seconds: number;
  orientation: Orientation;
  low_power: boolean;
  active: boolean;
}

export interface PlaylistItem {
  id: number;
  screen_id: number;
  item_type: PlaylistItemType;
  ref_id: number | null;
  position: number;
  duration_s: number | null;
}

export interface Promo {
  id: number;
  title: string;
  subtitle: string;
  image_path: string | null;
  starts_at: string | null;
  ends_at: string | null;
  active: boolean;
}

export interface ExchangeRate {
  id: number;
  source: string;
  rate_e4: number;
  effective_date: string;
  fetched_at: string;
  is_manual: boolean;
  status: RateStatus;
  note: string | null;
}

export interface Settings {
  store_name: string;
  store_rif: string;
  logo_path: string | null;
  rounding_step_cents: number;
  rounding_mode: 'nearest' | 'up' | 'down';
  show_usd: boolean;
  show_bs: boolean;
  primary_currency: 'usd' | 'bs';
  ticker_message: string;
  low_power: boolean;
  /** 'today': rate whose effective date is today or earlier. 'latest': most recent published rate. */
  rate_mode: 'today' | 'latest';
  /** 'auto': providers + manual; 'manual': only manual rates. */
  rate_source_mode: 'auto' | 'manual';
  rate_providers: string[];
  rate_custom_sources: CustomRateSource[];
  rate_max_jump_pct: number;
  rate_adjust_bp: number;
  rate_stale_hours: number;
  rate_fetch_minutes: number;
  store_open_hour: number;
  store_close_hour: number;
  bcv_insecure_tls: boolean;
  /** Daily scheduled query (e.g. 20:00, after the BCV publishes the next day's rate). */
  rate_daily_enabled: boolean;
  /** "HH:MM", Caracas time. */
  rate_daily_time: string;
  /** Extra checks every `rate_fetch_minutes` during store hours. */
  rate_poll_enabled: boolean;
  /* --- TV appearance --- */
  /** Header logo size, % of the default. */
  header_logo_scale: number;
  /** Logo size in the transition between slides, % of the default. */
  transition_logo_scale: number;
  /** Product card text area. */
  card_bg_color: string;
  card_text_color: string;
  /** Product photo size inside the cards, % of the default. */
  card_image_scale: number;
  /** Color scheme of the rate box in the footer. */
  footer_rate_style: FooterRateStyle;
}

export type FooterRateStyle = 'red' | 'black' | 'white';

export interface PlayerTheme {
  header_logo_scale: number;
  transition_logo_scale: number;
  card_bg_color: string;
  card_text_color: string;
  card_image_scale: number;
  footer_rate_style: FooterRateStyle;
}

export interface CustomRateSource {
  name: string;
  url: string;
  /** Dot path to the numeric rate inside the JSON, e.g. "data.usd" or "promedio". */
  rate_path: string;
  /** Optional dot path to a date (YYYY-MM-DD or ISO). */
  date_path?: string;
}

export interface RateInfo {
  rate_e4: number;
  /** Rate after the configured adjustment, used for prices. */
  effective_rate_e4: number;
  display: string;
  source: string;
  effective_date: string;
  fetched_at: string;
  is_manual: boolean;
  stale: boolean;
}

export interface PlayerProduct {
  id: number;
  name: string;
  description: string;
  unit: string;
  image: string | null;
  badge: Badge;
  is_offer: boolean;
  sold_out: boolean;
  usd: string;
  bs: string | null;
  old_usd: string | null;
  old_bs: string | null;
}

export interface ProductSlide {
  type: 'products';
  layout: Exclude<Layout, 'promo'>;
  title: string;
  color: string;
  duration_s: number;
  cols: number;
  rows: number;
  items: PlayerProduct[];
}

export interface PromoSlide {
  type: 'promo';
  title: string;
  subtitle: string;
  image: string | null;
  duration_s: number;
}

export type Slide = ProductSlide | PromoSlide;

export interface PlayerPayload {
  version: string;
  generated_at: string;
  screen: Pick<Screen, 'id' | 'name' | 'title' | 'layout' | 'orientation'> & { low_power: boolean };
  store: { name: string; rif: string; logo: string | null };
  display: { show_usd: boolean; show_bs: boolean; primary: 'usd' | 'bs' };
  theme: PlayerTheme;
  rate: RateInfo | null;
  ticker: string;
  slides: Slide[];
}

export type WsServerMessage =
  | { type: 'content-changed' }
  | { type: 'reload' }
  | { type: 'screens-status'; screens: ScreenStatus[] }
  | { type: 'hello'; server_time: string };

export interface ScreenStatus {
  screen_id: number;
  connections: number;
  last_seen: string | null;
}
