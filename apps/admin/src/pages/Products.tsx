import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { Badge, Product } from '@chicolven/shared/types';
import { centsToInput, formatBs, formatUsd, parseDecimal, parseUsdToCents, usdCentsToBsCents } from '@chicolven/shared/money';
import { api, withToken } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, infoAlert, notify, successAlert } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Empty, Field, ImagePicker, Modal, PageHeader, Toggle, useModalClose, useValidation } from '../components/ui.tsx';

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

/** Asks before saving a price that changes a lot (usually a typo: 1290 instead of 12,90). */
async function confirmBigChange(name: string, oldCents: number, newCents: number): Promise<boolean> {
  if (newCents === 0) {
    return confirmAction({
      title: '¿Precio en $ 0,00?',
      html: `<b>${escapeHtml(name)}</b> se mostrará gratis en los televisores.`,
      confirmText: 'Sí, dejar en 0',
      danger: true,
      focusCancel: true,
    });
  }
  if (oldCents > 0) {
    const ratio = newCents / oldCents;
    if (ratio > 1.5 || ratio < 0.5) {
      const pct = Math.round((ratio - 1) * 100);
      return confirmAction({
        title: 'Cambio de precio muy grande',
        html: `<b>${escapeHtml(name)}</b> pasa de <b>${formatUsd(oldCents)}</b> a <b>${formatUsd(newCents)}</b> (${pct > 0 ? '+' : ''}${pct} %).<br>¿Es correcto?`,
        confirmText: 'Sí, es correcto',
        cancelText: 'Revisar',
        icon: 'warning',
        focusCancel: true,
      });
    }
  }
  return true;
}

/** Inline price editor: type, press Enter (or leave the field) and it is saved. */
function PriceCell(props: { product: Product; onSaved: (p: Product) => void }) {
  const [value, setValue] = useState(centsToInput(props.product.price_usd_cents));
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const saving = useRef(false);
  useEffect(() => setValue(centsToInput(props.product.price_usd_cents)), [props.product.price_usd_cents]);

  const revert = () => setValue(centsToInput(props.product.price_usd_cents));

  const save = async () => {
    if (saving.current) return;
    const cents = parseUsdToCents(value);
    if (cents === null) {
      setState('error');
      await errorAlert(`"${value || '(vacío)'}" no es un precio válido. Escriba por ejemplo 12,90`, 'Precio inválido');
      revert();
      setState('idle');
      return;
    }
    if (cents === props.product.price_usd_cents) return revert();
    saving.current = true;
    if (!(await confirmBigChange(props.product.name, props.product.price_usd_cents, cents))) {
      saving.current = false;
      return revert();
    }
    setState('saving');
    try {
      const updated = await api<Product>(`/api/admin/products/${props.product.id}`, { method: 'PUT', body: { price_usd_cents: cents } });
      props.onSaved(updated);
      setState('saved');
      notify(`${props.product.name}: ${formatUsd(cents)}`);
      setTimeout(() => setState('idle'), 1500);
    } catch (err) {
      setState('error');
      await errorAlert((err as Error).message);
      revert();
    } finally {
      saving.current = false;
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
          if (e.key === 'Enter') {
            // Stop the Enter here: otherwise its keypress "clicks" the button of the dialog that saving may open.
            e.preventDefault();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === 'Escape') revert();
        }}
        onBlur={save}
        aria-label={`Precio de ${props.product.name}`}
      />
      {state === 'saved' && (
        <i>
          <Icon name="check" size={16} />
        </i>
      )}
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

function ProductForm(props: { initial: Draft; products: Product[]; onSaved: () => void }) {
  const { categories } = useApp();
  const close = useModalClose();
  const bs = useBs();
  const [d, setD] = useState<Draft>(props.initial);
  const [busy, setBusy] = useState(false);
  const v = useValidation();
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => {
    v.clear(k as string);
    setD((x) => ({ ...x, [k]: val }));
  };
  const priceCents = parseUsdToCents(d.price);
  const offerCents = d.offer_price ? parseUsdToCents(d.offer_price) : null;

  const submit = async (e: Event) => {
    e.preventDefault();
    const ok = await v.validate([
      [!d.name.trim(), 'name', 'Nombre del producto'],
      [!d.price.trim(), 'price', 'Precio en USD'],
      [Boolean(d.price.trim()) && priceCents === null, 'price', 'Precio en USD válido (ej. 12,90)'],
      [!d.unit.trim(), 'unit', 'Unidad de venta (kg, pieza…)'],
      [d.is_offer && !d.offer_price.trim(), 'offer_price', 'Precio de oferta'],
      [d.is_offer && Boolean(d.offer_price.trim()) && offerCents === null, 'offer_price', 'Precio de oferta válido'],
      [d.is_offer && offerCents !== null && priceCents !== null && offerCents >= priceCents, 'offer_price', 'Precio de oferta menor que el precio normal'],
    ]);
    if (!ok || priceCents === null) return;

    const duplicate = props.products.find((p) => p.id !== d.id && p.name.trim().toLowerCase() === d.name.trim().toLowerCase());
    if (
      duplicate &&
      !(await confirmAction({
        title: 'Nombre repetido',
        html: `Ya existe <b>${escapeHtml(duplicate.name)}</b>. ¿Guardar de todas formas?`,
        confirmText: 'Guardar igual',
        icon: 'warning',
      }))
    )
      return;
    if (d.id && !(await confirmBigChange(d.name, props.products.find((p) => p.id === d.id)?.price_usd_cents ?? 0, priceCents))) return;
    if (!d.id && priceCents === 0 && !(await confirmBigChange(d.name, 0, 0))) return;
    if (!d.image_path) {
      const go = await confirmAction({
        title: 'Producto sin foto',
        text: 'En los televisores se mostrarán sus iniciales en lugar de una foto. ¿Guardar así?',
        confirmText: 'Guardar sin foto',
        cancelText: 'Agregar foto',
        icon: 'question',
      });
      if (!go) return;
    }

    setBusy(true);
    const body = {
      sku: d.sku?.trim() || null,
      name: d.name.trim(),
      description: d.description.trim(),
      category_id: d.category_id,
      price_usd_cents: priceCents,
      unit: d.unit.trim(),
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
      notify(d.id ? 'Producto actualizado' : 'Producto creado');
      props.onSaved();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (
      !d.id ||
      !(await confirmAction({
        title: '¿Eliminar producto?',
        html: `Se eliminará <b>${escapeHtml(d.name)}</b> y desaparecerá de todos los televisores. Esta acción no se puede deshacer.<br><small>Si solo no lo tiene hoy, use “Agotado” u ocúltelo.</small>`,
        confirmText: 'Sí, eliminar',
        danger: true,
      }))
    )
      return;
    await api(`/api/admin/products/${d.id}`, { method: 'DELETE' });
    notify('Producto eliminado');
    props.onSaved();
  };

  return (
    <form class="form" onSubmit={submit} noValidate>
      <ImagePicker value={d.image_path} onChange={(val) => set('image_path', val)} />
      <div class="row">
        <Field label="Nombre" required invalid={v.has('name')}>
          <input maxLength={80} value={d.name} autoFocus placeholder="Ej. Jamón de pierna" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Código (opcional)">
          <input maxLength={40} value={d.sku ?? ''} placeholder="Ej. JAM-001" onInput={(e) => set('sku', (e.target as HTMLInputElement).value)} />
        </Field>
      </div>
      <div class="row">
        <Field label="Categoría" hint={categories.length ? undefined : 'Cree categorías para agrupar productos en los TVs.'}>
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
        <Field label="Unidad" required invalid={v.has('unit')}>
          <input list="units" value={d.unit} onInput={(e) => set('unit', (e.target as HTMLInputElement).value)} />
          <datalist id="units">
            {UNITS.map((u) => (
              <option key={u} value={u} />
            ))}
          </datalist>
        </Field>
      </div>
      <div class="row">
        <Field label="Precio (USD)" required invalid={v.has('price')} hint={`≈ ${bs(priceCents)}`}>
          <input inputMode="decimal" placeholder="0,00" value={d.price} onInput={(e) => set('price', (e.target as HTMLInputElement).value)} />
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
        <Toggle label="En oferta" checked={d.is_offer} onChange={(val) => set('is_offer', val)} />
        <Toggle label="Visible en TVs" checked={d.active} onChange={(val) => set('active', val)} />
        <Toggle label="Agotado" checked={d.sold_out} onChange={(val) => set('sold_out', val)} />
      </div>
      {d.is_offer && (
        <Field label="Precio de oferta (USD)" required invalid={v.has('offer_price')} hint={`≈ ${bs(offerCents)} · el precio normal se mostrará tachado`}>
          <input inputMode="decimal" placeholder="0,00" value={d.offer_price} onInput={(e) => set('offer_price', (e.target as HTMLInputElement).value)} />
        </Field>
      )}
      <footer class="actions">
        {d.id && (
          <button type="button" class="btn danger" onClick={remove}>
            <Icon name="trash" size={16} /> Eliminar
          </button>
        )}
        <span class="grow" />
        <button type="button" class="btn ghost" onClick={() => void close()}>
          Cancelar
        </button>
        <button class="btn primary" disabled={busy}>
          <Icon name="check" size={16} /> {busy ? 'Guardando…' : 'Guardar'}
        </button>
      </footer>
    </form>
  );
}

function ProductModal(props: { initial: Draft; products: Product[]; onClose: () => void; onSaved: () => void }) {
  // The form reports its draft up so the modal knows whether closing loses changes.
  const [dirty, setDirty] = useState(false);
  return (
    <Modal title={props.initial.id ? 'Editar producto' : 'Nuevo producto'} icon="box" onClose={props.onClose} wide dirty={dirty}>
      <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
        <ProductForm initial={props.initial} products={props.products} onSaved={props.onSaved} />
      </div>
    </Modal>
  );
}

function BulkAdjust(props: { products: Product[]; onClose: () => void; onDone: () => void }) {
  const { categories } = useApp();
  const close = useModalClose();
  const [categoryId, setCategoryId] = useState<string>('');
  const [percent, setPercent] = useState('');
  const v = useValidation();
  const submit = async (e: Event) => {
    e.preventDefault();
    const negative = percent.trim().startsWith('-');
    const bp = parseDecimal(percent.replace(/^[+-]/, ''), 2);
    const ok = await v.validate([
      [!percent.trim(), 'percent', 'Porcentaje a aplicar'],
      [Boolean(percent.trim()) && (bp === null || bp === 0), 'percent', 'Porcentaje válido distinto de 0 (ej. 5 o -3)'],
      [bp !== null && (negative ? bp > 9000 : bp > 10000), 'percent', 'Porcentaje entre -90 y 100'],
    ]);
    if (!ok || bp === null) return;
    const signed = negative ? -bp : bp;
    const affected = categoryId ? props.products.filter((p) => String(p.category_id) === categoryId).length : props.products.length;
    if (affected === 0) return errorAlert('No hay productos en esa categoría.', 'Nada que ajustar');
    const target = categoryId ? `la categoría <b>${escapeHtml(categories.find((c) => String(c.id) === categoryId)?.name ?? '')}</b>` : '<b>TODOS</b> los productos';
    const sure = await confirmAction({
      title: `¿Aplicar ${signed > 0 ? '+' : ''}${(signed / 100).toLocaleString('es-VE')} %?`,
      html: `Se cambiará el precio de <b>${affected}</b> producto${affected === 1 ? '' : 's'} de ${target} (precio normal y de oferta).${
        Math.abs(signed) >= 3000 ? '<br><br><b>Atención:</b> es un cambio muy grande.' : ''
      }`,
      confirmText: 'Aplicar ajuste',
      danger: Math.abs(signed) >= 3000,
      icon: 'warning',
    });
    if (!sure) return;
    const res = await api<{ updated: number }>('/api/admin/products/bulk-adjust', {
      body: { category_id: categoryId ? Number(categoryId) : null, percent_bp: signed },
    });
    await successAlert('Precios actualizados', `${res.updated} productos ajustados. Los televisores ya muestran los nuevos precios.`);
    props.onDone();
  };
  return (
    <form class="form" onSubmit={submit} noValidate>
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
      <Field label="Porcentaje" required invalid={v.has('percent')} hint="Positivo para subir (5), negativo para bajar (-3). Afecta el precio en USD.">
        <input
          inputMode="decimal"
          placeholder="5"
          value={percent}
          onInput={(e) => {
            v.clear('percent');
            setPercent((e.target as HTMLInputElement).value);
          }}
        />
      </Field>
      <footer class="actions">
        <span class="grow" />
        <button type="button" class="btn ghost" onClick={() => void close()}>
          Cancelar
        </button>
        <button class="btn primary">
          <Icon name="percent" size={16} /> Aplicar
        </button>
      </footer>
    </form>
  );
}

export function Products() {
  const { categories, revision } = useApp();
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
  const patch = async (p: Product, body: Partial<Product>, message: string) => {
    try {
      replace(await api<Product>(`/api/admin/products/${p.id}`, { method: 'PUT', body }));
      notify(message);
    } catch (err) {
      await errorAlert((err as Error).message);
    }
  };

  const toggleVisible = async (p: Product, visible: boolean) => {
    if (
      !visible &&
      p.is_offer &&
      !(await confirmAction({ title: 'Ocultar una oferta', html: `<b>${escapeHtml(p.name)}</b> está en oferta. ¿Ocultarlo de los televisores?`, confirmText: 'Ocultar' }))
    )
      return;
    await patch(p, { active: visible }, visible ? `${p.name} visible en los TVs` : `${p.name} oculto de los TVs`);
  };

  const edit = (p: Product, overrides: Partial<Draft> = {}) =>
    setEditing({
      ...p,
      price: centsToInput(p.price_usd_cents),
      offer_price: p.offer_price_usd_cents === null ? '' : centsToInput(p.offer_price_usd_cents),
      ...overrides,
    });

  const create = () => {
    if (categories.length === 0) {
      void infoAlert('Consejo', 'Aún no hay categorías. Puede crear el producto igual, pero conviene crear categorías (Charcutería, Quesos…) para agruparlos en los TVs.');
    }
    setEditing(emptyDraft(cat ? Number(cat) : null));
  };

  const importCsv = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = '';
    if (!file) return;
    if (!/\.csv$/i.test(file.name)) return errorAlert('Seleccione un archivo .csv (en Excel: Guardar como → CSV).', 'Archivo no válido');
    const sure = await confirmAction({
      title: '¿Importar productos?',
      html: `Se leerá <b>${escapeHtml(file.name)}</b>. Los productos con el mismo código (o nombre) se <b>actualizarán</b> y los nuevos se crearán.<br><small>Sugerencia: cree un respaldo antes en Sistema.</small>`,
      confirmText: 'Importar',
    });
    if (!sure) return;
    try {
      const res = await api<{ created: number; updated: number; errors: string[] }>('/api/admin/products/import', {
        body: { csv: await file.text() },
      });
      const errors = res.errors.length
        ? `<p><b>${res.errors.length} línea(s) con errores</b> (no se importaron):</p><ul class="swal-list">${res.errors
            .slice(0, 12)
            .map((x) => `<li>${escapeHtml(x)}</li>`)
            .join('')}</ul>`
        : '';
      await (res.errors.length ? infoAlert : successAlert)(
        'Importación terminada',
        `<p><b>${res.created}</b> nuevos · <b>${res.updated}</b> actualizados</p>${errors}`,
      );
      load();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo importar');
    }
  };

  return (
    <div>
      <PageHeader icon="box" title="Productos" description="Escriba el precio y presione Enter: los televisores se actualizan solos.">
        <button class="btn primary" onClick={create}>
          <Icon name="plus" size={16} /> Nuevo producto
        </button>
      </PageHeader>

      <div class="toolbar">
        <div class="search">
          <Icon name="search" size={16} />
          <input
            ref={searchInput}
            type="search"
            placeholder="Buscar producto o código…"
            value={q}
            onInput={(e) => setQ((e.target as HTMLInputElement).value)}
          />
        </div>
        <select value={cat} onChange={(e) => setCat((e.target as HTMLSelectElement).value)}>
          <option value="">Todas las categorías</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <span class="grow" />
        <button class="btn" onClick={() => setBulk(true)}>
          <Icon name="percent" size={16} /> Ajuste masivo
        </button>
        <a class="btn" href={withToken('/api/admin/products/export.csv')}>
          <Icon name="download" size={16} /> Exportar
        </a>
        <button class="btn" onClick={() => fileInput.current?.click()}>
          <Icon name="upload" size={16} /> Importar
        </button>
        <input ref={fileInput} type="file" accept=".csv,text/csv" hidden onChange={(e) => importCsv((e.target as HTMLInputElement).files?.[0])} />
      </div>

      {filtered.length === 0 ? (
        <Empty>{products.length ? 'Ningún producto coincide con la búsqueda.' : 'Aún no hay productos. Cree el primero con “Nuevo producto”.'}</Empty>
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
                  <td class="thumb-cell">
                    {p.image_path ? (
                      <img src={`/media/${p.image_path}`} alt="" />
                    ) : (
                      <span class="no-img">
                        <Icon name="image" size={16} />
                      </span>
                    )}
                  </td>
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
                      <button class="chip" onClick={() => edit(p, { is_offer: true })}>
                        <Icon name="plus" size={12} /> Agregar
                      </button>
                    )}
                  </td>
                  <td>
                    <Toggle label="" checked={p.active} onChange={(val) => toggleVisible(p, val)} />
                  </td>
                  <td>
                    <Toggle
                      label=""
                      checked={p.sold_out}
                      onChange={(val) => patch(p, { sold_out: val }, val ? `${p.name} marcado como agotado` : `${p.name} disponible de nuevo`)}
                    />
                  </td>
                  <td>
                    <button class="btn small" onClick={() => edit(p)}>
                      <Icon name="edit" size={14} /> Editar
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ProductModal
          initial={editing}
          products={products}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
      {bulk && (
        <Modal title="Ajuste masivo de precios" icon="percent" onClose={() => setBulk(false)}>
          <BulkAdjust
            products={products}
            onClose={() => setBulk(false)}
            onDone={() => {
              setBulk(false);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
