import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Badge, Product } from '@chicolven/shared/types';
import { centsToInput, formatBs, parseDecimal, parseUsdToCents, usdCentsToBsCents } from '@chicolven/shared/money';
import { api, withToken } from '../api.ts';
import { useApp } from '../state.ts';
import { Empty, Field, ImagePicker, Modal, Toggle } from '../components/ui.tsx';

const UNITS = ['kg', '100 g', '250 g', '500 g', 'pieza', 'unidad', 'paquete', 'cartón', 'litro'];

function useBs() {
  const { rate, settings } = useApp();
  return (usdCents: number | null) => {
    if (usdCents === null || !rate || !settings) return '—';
    return formatBs(
      usdCentsToBsCents(usdCents, rate.effective_rate_e4, { stepCents: settings.rounding_step_cents, mode: settings.rounding_mode }),
    );
  };
}

/** Inline price editor: type, press Enter (or leave the field) and it is saved. */
function PriceCell(props: { product: Product; onSaved: (p: Product) => void }) {
  const { toast } = useApp();
  const [value, setValue] = useState(centsToInput(props.product.price_usd_cents));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  useEffect(() => setValue(centsToInput(props.product.price_usd_cents)), [props.product.price_usd_cents]);

  const save = async () => {
    const cents = parseUsdToCents(value);
    if (cents === null) {
      setState('error');
      toast('Precio inválido', 'error');
      return;
    }
    if (cents === props.product.price_usd_cents) {
      setValue(centsToInput(cents));
      return;
    }
    setState('saving');
    try {
      const updated = await api<Product>(`/api/admin/products/${props.product.id}`, { method: 'PUT', body: { price_usd_cents: cents } });
      props.onSaved(updated);
      setState('saved');
      setTimeout(() => setState('idle'), 1500);
    } catch (err) {
      setState('error');
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div class={`price-input ${state}`}>
      <span>$</span>
      <input
        inputMode="decimal"
        value={value}
        onInput={(e) => {
          setValue((e.target as HTMLInputElement).value);
          setState('idle');
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') setValue(centsToInput(props.product.price_usd_cents));
        }}
        onBlur={save}
        aria-label={`Precio de ${props.product.name}`}
      />
      {state === 'saved' && <i>✓</i>}
    </div>
  );
}

type Draft = Omit<Product, 'id' | 'updated_at' | 'price_usd_cents' | 'offer_price_usd_cents'> & {
  id?: number;
  price: string;
  offer_price: string;
};

const emptyDraft = (categoryId: number | null): Draft => ({
  sku: null,
  name: '',
  description: '',
  category_id: categoryId,
  price: '',
  unit: 'kg',
  image_path: null,
  badge: null,
  is_offer: false,
  offer_price: '',
  active: true,
  sold_out: false,
  sort_order: 0,
});

function ProductForm(props: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const { categories, toast } = useApp();
  const bs = useBs();
  const [d, setD] = useState<Draft>(props.initial);
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));
  const priceCents = parseUsdToCents(d.price);
  const offerCents = d.offer_price ? parseUsdToCents(d.offer_price) : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    if (priceCents === null) return toast('Escriba un precio válido', 'error');
    if (d.is_offer && (offerCents === null || offerCents >= priceCents)) {
      return toast('El precio de oferta debe ser menor que el precio normal', 'error');
    }
    setBusy(true);
    const body = {
      sku: d.sku?.trim() || null,
      name: d.name,
      description: d.description,
      category_id: d.category_id,
      price_usd_cents: priceCents,
      unit: d.unit,
      image_path: d.image_path,
      badge: d.badge,
      is_offer: d.is_offer,
      offer_price_usd_cents: d.is_offer ? offerCents : null,
      active: d.active,
      sold_out: d.sold_out,
      sort_order: d.sort_order,
    };
    try {
      if (d.id) await api(`/api/admin/products/${d.id}`, { method: 'PUT', body });
      else await api('/api/admin/products', { body });
      toast('Producto guardado');
      props.onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!d.id || !confirm(`¿Eliminar "${d.name}"? Esta acción no se puede deshacer.`)) return;
    await api(`/api/admin/products/${d.id}`, { method: 'DELETE' });
    toast('Producto eliminado');
    props.onSaved();
  };

  return (
    <Modal title={d.id ? 'Editar producto' : 'Nuevo producto'} onClose={props.onClose} wide>
      <form class="form" onSubmit={submit}>
        <ImagePicker value={d.image_path} onChange={(v) => set('image_path', v)} />
        <div class="row">
          <Field label="Nombre">
            <input required maxLength={80} value={d.name} autoFocus onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Código (opcional)">
            <input maxLength={40} value={d.sku ?? ''} onInput={(e) => set('sku', (e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <div class="row">
          <Field label="Categoría">
            <select
              value={d.category_id ?? ''}
              onChange={(e) => set('category_id', (e.target as HTMLSelectElement).value ? Number((e.target as HTMLSelectElement).value) : null)}
            >
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Unidad">
            <input list="units" value={d.unit} onInput={(e) => set('unit', (e.target as HTMLInputElement).value)} />
            <datalist id="units">
              {UNITS.map((u) => (
                <option key={u} value={u} />
              ))}
            </datalist>
          </Field>
        </div>
        <div class="row">
          <Field label="Precio (USD)" hint={`≈ ${bs(priceCents)}`}>
            <input required inputMode="decimal" placeholder="0,00" value={d.price} onInput={(e) => set('price', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Etiqueta">
            <select value={d.badge ?? ''} onChange={(e) => set('badge', ((e.target as HTMLSelectElement).value || null) as Badge)}>
              <option value="">Ninguna</option>
              <option value="oferta">Oferta</option>
              <option value="nuevo">Nuevo</option>
              <option value="destacado">Destacado</option>
            </select>
          </Field>
        </div>
        <Field label="Descripción (opcional)">
          <input maxLength={200} value={d.description} onInput={(e) => set('description', (e.target as HTMLInputElement).value)} />
        </Field>
        <div class="row toggles">
          <Toggle label="En oferta" checked={d.is_offer} onChange={(v) => set('is_offer', v)} />
          <Toggle label="Visible en TVs" checked={d.active} onChange={(v) => set('active', v)} />
          <Toggle label="Agotado" checked={d.sold_out} onChange={(v) => set('sold_out', v)} />
        </div>
        {d.is_offer && (
          <Field label="Precio de oferta (USD)" hint={`≈ ${bs(offerCents)} · el precio normal se mostrará tachado`}>
            <input inputMode="decimal" placeholder="0,00" value={d.offer_price} onInput={(e) => set('offer_price', (e.target as HTMLInputElement).value)} />
          </Field>
        )}
        <footer class="actions">
          {d.id && (
            <button type="button" class="btn danger" onClick={remove}>
              Eliminar
            </button>
          )}
          <span class="grow" />
          <button type="button" class="btn ghost" onClick={props.onClose}>
            Cancelar
          </button>
          <button class="btn primary" disabled={busy}>
            Guardar
          </button>
        </footer>
      </form>
    </Modal>
  );
}

function BulkAdjust(props: { onClose: () => void; onDone: () => void }) {
  const { categories, toast } = useApp();
  const [categoryId, setCategoryId] = useState<string>('');
  const [percent, setPercent] = useState('');
  const submit = async (e: Event) => {
    e.preventDefault();
    const negative = percent.trim().startsWith('-');
    const bp = parseDecimal(percent.replace(/^[+-]/, ''), 2);
    if (bp === null || bp === 0) return toast('Escriba un porcentaje válido, por ejemplo 5 o -3', 'error');
    const signed = negative ? -bp : bp;
    const target = categoryId ? categories.find((c) => String(c.id) === categoryId)?.name : 'TODOS los productos';
    if (!confirm(`¿Aplicar ${signed > 0 ? '+' : ''}${signed / 100} % a ${target}?`)) return;
    const res = await api<{ updated: number }>('/api/admin/products/bulk-adjust', {
      body: { category_id: categoryId ? Number(categoryId) : null, percent_bp: signed },
    });
    toast(`${res.updated} precios actualizados`);
    props.onDone();
  };
  return (
    <Modal title="Ajuste masivo de precios" onClose={props.onClose}>
      <form class="form" onSubmit={submit}>
        <Field label="Aplicar a">
          <select value={categoryId} onChange={(e) => setCategoryId((e.target as HTMLSelectElement).value)}>
            <option value="">Todos los productos</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Porcentaje" hint="Positivo para subir (5), negativo para bajar (-3). Afecta precio normal y de oferta en USD.">
          <input inputMode="decimal" placeholder="5" value={percent} onInput={(e) => setPercent((e.target as HTMLInputElement).value)} />
        </Field>
        <footer class="actions">
          <span class="grow" />
          <button type="button" class="btn ghost" onClick={props.onClose}>
            Cancelar
          </button>
          <button class="btn primary">Aplicar</button>
        </footer>
      </form>
    </Modal>
  );
}

export function Products() {
  const { categories, toast, revision } = useApp();
  const bs = useBs();
  const [products, setProducts] = useState<Product[]>([]);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [editing, setEditing] = useState<Draft | null>(null);
  const [bulk, setBulk] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);

  const load = () => api<Product[]>('/api/admin/products').then(setProducts);
  useEffect(() => {
    load();
  }, [revision]);
  useEffect(() => searchInput.current?.focus(), []);

  const catName = useMemo(() => new Map(categories.map((c) => [c.id, c.name])), [categories]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter(
      (p) =>
        (!cat || String(p.category_id ?? '') === cat) &&
        (!needle || p.name.toLowerCase().includes(needle) || (p.sku ?? '').toLowerCase().includes(needle)),
    );
  }, [products, q, cat]);

  const replace = (p: Product) => setProducts((list) => list.map((x) => (x.id === p.id ? p : x)));
  const patch = async (p: Product, body: Partial<Product>) => {
    try {
      replace(await api<Product>(`/api/admin/products/${p.id}`, { method: 'PUT', body }));
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const edit = (p: Product) =>
    setEditing({
      ...p,
      price: centsToInput(p.price_usd_cents),
      offer_price: p.offer_price_usd_cents === null ? '' : centsToInput(p.offer_price_usd_cents),
    });

  const importCsv = async (file: File | undefined) => {
    if (!file) return;
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>('/api/admin/products/import', {
        body: { csv: await file.text() },
      });
      toast(`Importado: ${res.created} nuevos, ${res.updated} actualizados${res.errors.length ? `, ${res.errors.length} con errores` : ''}`);
      if (res.errors.length) alert(res.errors.join('\n'));
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  return (
    <div>
      <div class="toolbar">
        <input
          ref={searchInput}
          class="search"
          type="search"
          placeholder="Buscar producto o código…"
          value={q}
          onInput={(e) => setQ((e.target as HTMLInputElement).value)}
        />
        <select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span class="grow" />
        <button class="btn primary" onClick={() => setEditing(emptyDraft(cat ? Number(cat) : null))}>
          + Nuevo producto
        </button>
        <details class="dropdown">
          <summary class="btn">Más ▾</summary>
          <div>
            <button class="btn ghost" onClick={() => setBulk(true)}>
              Ajuste masivo (%)
            </button>
            <a class="btn ghost" href={withToken('/api/admin/products/export.csv')}>
              Exportar CSV / Excel
            </a>
            <button class="btn ghost" onClick={() => fileInput.current?.click()}>
              Importar CSV
            </button>
          </div>
        </details>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv((e.target as HTMLInputElement).files?.[0])} />
      </div>
      <p class="hint">Para cambiar un precio: escríbalo y presione Enter. Los televisores se actualizan solos.</p>

      {filtered.length === 0 ? (
        <Empty>{products.length ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos. Cree el primero.'}</Empty>
      ) : (
        <div class="table-wrap">
          <table class="table products">
            <thead>
              <tr>
                <th />
                <th>Producto</th>
                <th>Precio USD</th>
                <th>En Bs</th>
                <th>Oferta</th>
                <th>Visible</th>
                <th>Agotado</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((p) => (
                <tr key={p.id} class={p.active ? '' : 'inactive'}>
                  <td class="thumb-cell">{p.image_path ? <img src={`/media/${p.image_path}`} alt="" /> : <span class="no-img" />}</td>
                  <td>
                    <b>{p.name}</b>
                    <small>
                      {p.category_id ? catName.get(p.category_id) : 'Sin categoría'} · {p.unit}
                      {p.sku ? ` · ${p.sku}` : ''}
                    </small>
                  </td>
                  <td>
                    <PriceCell product={p} onSaved={replace} />
                  </td>
                  <td class="num">
                    {p.is_offer && p.offer_price_usd_cents !== null ? (
                      <>
                        <b>{bs(p.offer_price_usd_cents)}</b>
                        <small class="strike">{bs(p.price_usd_cents)}</small>
                      </>
                    ) : (
                      bs(p.price_usd_cents)
                    )}
                  </td>
                  <td>
                    {p.is_offer ? (
                      <button class="chip offer" onClick={() => edit(p)} title="Editar oferta">
                        $ {p.offer_price_usd_cents === null ? '—' : centsToInput(p.offer_price_usd_cents)}
                      </button>
                    ) : (
                      <button class="chip" onClick={() => edit({ ...p, is_offer: true })}>
                        Agregar
                      </button>
                    )}
                  </td>
                  <td>
                    <Toggle label="" checked={p.active} onChange={(v) => patch(p, { active: v })} />
                  </td>
                  <td>
                    <Toggle label="" checked={p.sold_out} onChange={(v) => patch(p, { sold_out: v })} />
                  </td>
                  <td>
                    <button class="btn small" onClick={() => edit(p)}>
                      Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {bulk && (
        <BulkAdjust
          onClose={() => setBulk(false)}
          onDone={() => {
            setBulk(false);
            load();
          }}
        />
      )}
    </div>
  );
}
