import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { centsToInput, parseUsdToCents } from '@chicolven/shared/money';
import { requireAdmin } from './auth.ts';
import { categoryPatchSchema, categorySchema, idParam, productPatchSchema, productSchema, promoPatchSchema, promoSchema } from './schemas.ts';
import { parseCsv, toCsv } from '../services/csv.ts';

const CSV_HEADER = ['sku', 'nombre', 'categoria', 'precio_usd', 'unidad', 'oferta_usd', 'activo', 'descripcion'];

export async function catalogRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('preHandler', requireAdmin);
  const { repos, hub, log } = app.ctx;
  const changed = () => hub.contentChanged();
  const notFound = { error: 'No encontrado' };

  /* Categories */
  app.get('/api/admin/categories', async () => repos.categories.list());
  app.post('/api/admin/categories', async (req) => {
    const cat = repos.categories.create(categorySchema.parse(req.body));
    changed();
    return cat;
  });
  app.put('/api/admin/categories/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const cat = repos.categories.update(id, categoryPatchSchema.parse(req.body));
    if (!cat) return reply.code(404).send(notFound);
    changed();
    return cat;
  });
  app.delete('/api/admin/categories/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.categories.delete(id)) return reply.code(404).send(notFound);
    changed();
    return { ok: true };
  });

  /* Products */
  app.get('/api/admin/products', async (req) => {
    const q = z
      .object({
        q: z.string().optional(),
        category_id: z.coerce.number().int().optional(),
      })
      .parse(req.query);
    return repos.products.list(q);
  });
  app.post('/api/admin/products', async (req, reply) => {
    const input = productSchema.parse(req.body);
    if (input.sku && repos.products.getBySku(input.sku)) return reply.code(409).send({ error: 'Ya existe un producto con ese código' });
    const product = repos.products.create(input);
    changed();
    return product;
  });
  app.put('/api/admin/products/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const input = productPatchSchema.parse(req.body);
    if (input.sku) {
      const other = repos.products.getBySku(input.sku);
      if (other && other.id !== id) return reply.code(409).send({ error: 'Ya existe un producto con ese código' });
    }
    const product = repos.products.update(id, input);
    if (!product) return reply.code(404).send(notFound);
    changed();
    return product;
  });
  app.delete('/api/admin/products/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.products.delete(id)) return reply.code(404).send(notFound);
    changed();
    return { ok: true };
  });
  app.post('/api/admin/products/bulk-adjust', async (req) => {
    const body = z
      .object({ category_id: z.number().int().positive().nullable(), percent_bp: z.number().int().min(-9000).max(10000) })
      .parse(req.body);
    const count = repos.products.bulkAdjust(body.category_id, body.percent_bp);
    log.add('info', `Ajuste masivo de ${(body.percent_bp / 100).toFixed(2)} % a ${count} productos`);
    changed();
    return { updated: count };
  });
  app.get('/api/admin/price-history', async (req) => {
    const q = z.object({ product_id: z.coerce.number().int().optional() }).parse(req.query);
    return repos.products.history(q.product_id, 100);
  });

  /* CSV export / import */
  app.get('/api/admin/products/export.csv', async (_req, reply) => {
    const cats = new Map(repos.categories.list().map((c) => [c.id, c.name]));
    const rows = repos.products.list().map((p) => [
      p.sku,
      p.name,
      p.category_id ? (cats.get(p.category_id) ?? '') : '',
      centsToInput(p.price_usd_cents),
      p.unit,
      p.offer_price_usd_cents === null ? '' : centsToInput(p.offer_price_usd_cents),
      p.active ? 'si' : 'no',
      p.description,
    ]);
    reply.header('Content-Type', 'text/csv; charset=utf-8');
    reply.header('Content-Disposition', 'attachment; filename="productos-chicolven.csv"');
    return toCsv([CSV_HEADER, ...rows]);
  });

  app.post('/api/admin/products/import', async (req, reply) => {
    const { csv } = z.object({ csv: z.string().max(1_000_000) }).parse(req.body);
    const rows = parseCsv(csv);
    const header = (rows.shift() ?? []).map((h) => h.trim().toLowerCase());
    const col = (name: string) => header.indexOf(name);
    if (col('nombre') < 0 || col('precio_usd') < 0) {
      return reply.code(400).send({ error: 'El CSV debe tener al menos las columnas "nombre" y "precio_usd"' });
    }
    const cell = (row: string[], name: string) => (col(name) >= 0 ? (row[col(name)] ?? '').trim() : '');
    const categories = new Map(repos.categories.list().map((c) => [c.name.toLowerCase(), c.id]));
    const errors: string[] = [];
    let created = 0;
    let updated = 0;
    app.ctx.db.transaction(() => {
      rows.forEach((row, i) => {
        const line = i + 2;
        const name = cell(row, 'nombre');
        const price = parseUsdToCents(cell(row, 'precio_usd'));
        if (!name || price === null) {
          errors.push(`Línea ${line}: nombre o precio inválido`);
          return;
        }
        const catName = cell(row, 'categoria');
        let categoryId: number | null = null;
        if (catName) {
          categoryId = categories.get(catName.toLowerCase()) ?? null;
          if (categoryId === null) {
            categoryId = repos.categories.create({ name: catName, color: '#D7191C', icon: null, sort_order: categories.size, active: true }).id;
            categories.set(catName.toLowerCase(), categoryId);
          }
        }
        const offerText = cell(row, 'oferta_usd');
        const offer = offerText ? parseUsdToCents(offerText) : null;
        const activeText = cell(row, 'activo').toLowerCase();
        const sku = cell(row, 'sku') || null;
        const data = {
          name: name.slice(0, 80),
          price_usd_cents: price,
          category_id: categoryId,
          unit: cell(row, 'unidad') || 'kg',
          offer_price_usd_cents: offer,
          is_offer: offer !== null,
          active: activeText ? !['no', 'n', '0', 'false'].includes(activeText) : true,
          description: cell(row, 'descripcion').slice(0, 200),
        };
        const existing = sku
          ? repos.products.getBySku(sku)
          : (repos.products.list({ q: name }).find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null);
        if (existing) {
          repos.products.update(existing.id, data);
          updated++;
        } else {
          repos.products.create(productSchema.parse({ ...data, sku }));
          created++;
        }
      });
    })();
    log.add('info', `Importación CSV: ${created} creados, ${updated} actualizados, ${errors.length} errores`);
    changed();
    return { created, updated, errors };
  });

  /* Promos */
  app.get('/api/admin/promos', async () => repos.promos.list());
  app.post('/api/admin/promos', async (req) => {
    const promo = repos.promos.create(promoSchema.parse(req.body));
    changed();
    return promo;
  });
  app.put('/api/admin/promos/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    const promo = repos.promos.update(id, promoPatchSchema.parse(req.body));
    if (!promo) return reply.code(404).send(notFound);
    changed();
    return promo;
  });
  app.delete('/api/admin/promos/:id', async (req, reply) => {
    const { id } = idParam.parse(req.params);
    if (!repos.promos.delete(id)) return reply.code(404).send(notFound);
    changed();
    return { ok: true };
  });
}
