import { BRAND } from '@chicolven/shared/brand';
import type { Repos } from '../db/repositories/index.ts';

const CATALOG: { category: string; color: string; items: [string, number, string, number?][] }[] = [
  {
    category: 'Charcutería',
    color: BRAND.red,
    items: [
      ['Jamón de pierna', 1290, 'kg'],
      ['Jamón ahumado', 1150, 'kg', 990],
      ['Mortadela especial', 690, 'kg'],
      ['Salchichón', 1450, 'kg'],
      ['Pechuga de pavo', 1590, 'kg'],
      ['Chorizo ahumado', 990, 'kg'],
    ],
  },
  {
    category: 'Quesos',
    color: BRAND.yellow,
    items: [
      ['Queso amarillo', 1190, 'kg'],
      ['Queso blanco duro', 790, 'kg', 690],
      ['Queso de mano', 890, 'kg'],
      ['Queso mozzarella', 1090, 'kg'],
      ['Queso paisa', 850, 'kg'],
    ],
  },
  {
    category: 'Víveres',
    color: BRAND.blue,
    items: [
      ['Harina de maíz 1 kg', 135, 'pieza'],
      ['Mantequilla 500 g', 450, 'pieza'],
      ['Huevos (cartón 30)', 650, 'cartón'],
      ['Pan de sándwich', 320, 'pieza'],
    ],
  },
];

/** Inserts demo categories, products and two screens. Returns null if there are products already. */
export function seedDemo(repos: Repos): { products: number; screens: number } | null {
  if (repos.products.list().length > 0) return null;
  let products = 0;
  CATALOG.forEach((group, ci) => {
    const cat = repos.categories.create({ name: group.category, color: group.color, icon: null, sort_order: ci, active: true });
    group.items.forEach(([name, cents, unit, offer], pi) => {
      repos.products.create({
        sku: null,
        name,
        description: '',
        category_id: cat.id,
        price_usd_cents: cents,
        unit,
        image_path: null,
        badge: offer ? 'oferta' : null,
        is_offer: Boolean(offer),
        offer_price_usd_cents: offer ?? null,
        active: true,
        sold_out: false,
        sort_order: pi,
      });
      products++;
    });
  });
  repos.screens.create({
    name: 'TV 1 - Mostrador',
    title: 'Nuestros precios',
    layout: 'grid',
    grid_cols: 3,
    grid_rows: 2,
    rotation_seconds: 12,
    orientation: 'landscape',
    low_power: false,
    active: true,
  });
  const tv2 = repos.screens.create({
    name: 'TV 2 - Ofertas',
    title: 'Destacados',
    layout: 'hero',
    grid_cols: 1,
    grid_rows: 1,
    rotation_seconds: 8,
    orientation: 'landscape',
    low_power: false,
    active: true,
  });
  repos.screens.setPlaylist(tv2.id, [{ item_type: 'offers', ref_id: null, duration_s: null }]);
  repos.promos.create({
    title: '¡Bienvenidos a Chicolven!',
    subtitle: 'Charcutería fresca todos los días',
    image_path: null,
    starts_at: null,
    ends_at: null,
    active: true,
  });
  return { products, screens: 2 };
}
