import type { Category, Product, Promo } from '@chicolven/shared/types';
import { adjustCentsByBp } from '@chicolven/shared/money';
import { nowIso, withBooleans, type DB } from '../index.ts';

export type CategoryInput = Omit<Category, 'id'>;
export type ProductInput = Omit<Product, 'id' | 'updated_at'>;
export type PromoInput = Omit<Promo, 'id'>;

const CATEGORY_BOOLS = ['active'] as const;
const PRODUCT_BOOLS = ['is_offer', 'active', 'sold_out'] as const;
const PROMO_BOOLS = ['active'] as const;

const b = (v: boolean | undefined) => (v ? 1 : 0);

export class CategoryRepo {
  constructor(private db: DB) {}

  list(): Category[] {
    return this.db
      .prepare('SELECT * FROM categories ORDER BY sort_order, name')
      .all()
      .map((r) => withBooleans<Category>(r, CATEGORY_BOOLS));
  }

  get(id: number): Category | null {
    const row = this.db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    return row ? withBooleans<Category>(row, CATEGORY_BOOLS) : null;
  }

  create(input: CategoryInput): Category {
    const info = this.db
      .prepare('INSERT INTO categories (name, color, icon, sort_order, active) VALUES (?, ?, ?, ?, ?)')
      .run(input.name, input.color, input.icon, input.sort_order, b(input.active));
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<CategoryInput>): Category | null {
    const current = this.get(id);
    if (!current) return null;
    const next = { ...current, ...input };
    this.db
      .prepare('UPDATE categories SET name = ?, color = ?, icon = ?, sort_order = ?, active = ? WHERE id = ?')
      .run(next.name, next.color, next.icon, next.sort_order, b(next.active), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM playlist_items WHERE item_type = 'category' AND ref_id = ?").run(id);
      return this.db.prepare('DELETE FROM categories WHERE id = ?').run(id).changes > 0;
    })();
  }
}

export interface ProductFilter {
  q?: string;
  category_id?: number;
  active?: boolean;
}

export class ProductRepo {
  constructor(private db: DB) {}

  list(filter: ProductFilter = {}): Product[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.q) {
      where.push('(p.name LIKE ? OR p.sku LIKE ?)');
      params.push(`%${filter.q}%`, `%${filter.q}%`);
    }
    if (filter.category_id !== undefined) {
      where.push('p.category_id = ?');
      params.push(filter.category_id);
    }
    if (filter.active !== undefined) {
      where.push('p.active = ?');
      params.push(b(filter.active));
    }
    const sql =
      'SELECT p.* FROM products p LEFT JOIN categories c ON c.id = p.category_id' +
      (where.length ? ` WHERE ${where.join(' AND ')}` : '') +
      ' ORDER BY c.sort_order IS NULL, c.sort_order, p.sort_order, p.name';
    return this.db
      .prepare(sql)
      .all(...params)
      .map((r) => withBooleans<Product>(r, PRODUCT_BOOLS));
  }

  get(id: number): Product | null {
    const row = this.db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    return row ? withBooleans<Product>(row, PRODUCT_BOOLS) : null;
  }

  getBySku(sku: string): Product | null {
    const row = this.db.prepare('SELECT * FROM products WHERE sku = ?').get(sku);
    return row ? withBooleans<Product>(row, PRODUCT_BOOLS) : null;
  }

  create(input: ProductInput): Product {
    const info = this.db
      .prepare(
        `INSERT INTO products (sku, name, description, category_id, price_usd_cents, unit, image_path, badge,
          is_offer, offer_price_usd_cents, active, sold_out, sort_order, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.sku || null,
        input.name,
        input.description,
        input.category_id,
        input.price_usd_cents,
        input.unit,
        input.image_path,
        input.badge,
        b(input.is_offer),
        input.offer_price_usd_cents,
        b(input.active),
        b(input.sold_out),
        input.sort_order,
        nowIso(),
      );
    return this.get(Number(info.lastInsertRowid))!;
  }

  /** Updates a product and records price changes in price_history, atomically. */
  update(id: number, input: Partial<ProductInput>): Product | null {
    return this.db.transaction(() => {
      const current = this.get(id);
      if (!current) return null;
      const next = { ...current, ...input };
      this.db
        .prepare(
          `UPDATE products SET sku = ?, name = ?, description = ?, category_id = ?, price_usd_cents = ?, unit = ?,
            image_path = ?, badge = ?, is_offer = ?, offer_price_usd_cents = ?, active = ?, sold_out = ?,
            sort_order = ?, updated_at = ? WHERE id = ?`,
        )
        .run(
          next.sku || null,
          next.name,
          next.description,
          next.category_id,
          next.price_usd_cents,
          next.unit,
          next.image_path,
          next.badge,
          b(next.is_offer),
          next.offer_price_usd_cents,
          b(next.active),
          b(next.sold_out),
          next.sort_order,
          nowIso(),
          id,
        );
      if (next.price_usd_cents !== current.price_usd_cents) {
        this.db
          .prepare('INSERT INTO price_history (product_id, old_usd_cents, new_usd_cents, changed_at) VALUES (?, ?, ?, ?)')
          .run(id, current.price_usd_cents, next.price_usd_cents, nowIso());
      }
      return this.get(id);
    })();
  }

  delete(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM playlist_items WHERE item_type = 'product' AND ref_id = ?").run(id);
      return this.db.prepare('DELETE FROM products WHERE id = ?').run(id).changes > 0;
    })();
  }

  /** Applies +/- X % (basis points) to every product of a category (or all products when null). */
  bulkAdjust(categoryId: number | null, bp: number): number {
    return this.db.transaction(() => {
      const products = categoryId === null ? this.list() : this.list({ category_id: categoryId });
      for (const p of products) {
        this.update(p.id, {
          price_usd_cents: adjustCentsByBp(p.price_usd_cents, bp),
          offer_price_usd_cents:
            p.offer_price_usd_cents === null ? null : adjustCentsByBp(p.offer_price_usd_cents, bp),
        });
      }
      return products.length;
    })();
  }

  history(productId?: number, limit = 50): { id: number; product_id: number; product_name: string; old_usd_cents: number; new_usd_cents: number; changed_at: string }[] {
    const sql = `SELECT h.*, p.name AS product_name FROM price_history h JOIN products p ON p.id = h.product_id
      ${productId ? 'WHERE h.product_id = ?' : ''} ORDER BY h.changed_at DESC, h.id DESC LIMIT ?`;
    const params = productId ? [productId, limit] : [limit];
    return this.db.prepare(sql).all(...params) as never;
  }
}

export class PromoRepo {
  constructor(private db: DB) {}

  list(): Promo[] {
    return this.db
      .prepare('SELECT * FROM promos ORDER BY id DESC')
      .all()
      .map((r) => withBooleans<Promo>(r, PROMO_BOOLS));
  }

  get(id: number): Promo | null {
    const row = this.db.prepare('SELECT * FROM promos WHERE id = ?').get(id);
    return row ? withBooleans<Promo>(row, PROMO_BOOLS) : null;
  }

  create(input: PromoInput): Promo {
    const info = this.db
      .prepare('INSERT INTO promos (title, subtitle, image_path, starts_at, ends_at, active) VALUES (?, ?, ?, ?, ?, ?)')
      .run(input.title, input.subtitle, input.image_path, input.starts_at, input.ends_at, b(input.active));
    return this.get(Number(info.lastInsertRowid))!;
  }

  update(id: number, input: Partial<PromoInput>): Promo | null {
    const current = this.get(id);
    if (!current) return null;
    const n = { ...current, ...input };
    this.db
      .prepare('UPDATE promos SET title = ?, subtitle = ?, image_path = ?, starts_at = ?, ends_at = ?, active = ? WHERE id = ?')
      .run(n.title, n.subtitle, n.image_path, n.starts_at, n.ends_at, b(n.active), id);
    return this.get(id);
  }

  delete(id: number): boolean {
    return this.db.transaction(() => {
      this.db.prepare("DELETE FROM playlist_items WHERE item_type = 'promo' AND ref_id = ?").run(id);
      return this.db.prepare('DELETE FROM promos WHERE id = ?').run(id).changes > 0;
    })();
  }
}

