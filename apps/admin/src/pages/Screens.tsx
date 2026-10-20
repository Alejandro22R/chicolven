import { useEffect, useRef, useState } from 'preact/hooks';
import type { Layout, PlaylistItem, PlaylistItemType, Product, Promo, Screen } from '@chicolven/shared/types';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Empty, Field, Modal, Toggle, timeAgo } from '../components/ui.tsx';

const LAYOUT_INFO: Record<Layout, { label: string; desc: string; cols: number; rows: number }> = {
  grid: { label: 'Cuadrícula', desc: 'Varias tarjetas con foto y precio', cols: 3, rows: 2 },
  hero: { label: 'Carrusel', desc: 'Un producto grande a la vez', cols: 1, rows: 1 },
  menu: { label: 'Lista / menú', desc: 'Columnas de producto y precio', cols: 2, rows: 7 },
  offers: { label: 'Ofertas relámpago', desc: 'Rojo y amarillo, una oferta a la vez', cols: 1, rows: 1 },
  promo: { label: 'Banners', desc: 'Solo promociones a pantalla completa', cols: 1, rows: 1 },
};

type Draft = Omit<Screen, 'id'> & { id?: number };

/** Live thumbnail of a TV: the real player page scaled down to the card width. */
function Preview(props: { screen: Screen }) {
  const box = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.18);
  const [left, setLeft] = useState(0);
  const portrait = props.screen.orientation === 'portrait';
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const update = () => {
      const s = portrait ? el.clientHeight / 1920 : el.clientWidth / 1920;
      setScale(s);
      setLeft(portrait ? (el.clientWidth - 1080 * s) / 2 : 0);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [portrait]);
  return (
    <div ref={box} class={`preview ${props.screen.orientation}`}>
      <iframe
        src={`/tv/${props.screen.id}?preview=1`}
        title={props.screen.name}
        loading="lazy"
        tabIndex={-1}
        style={{ transform: `scale(${scale})`, left: `${left}px` }}
      />
    </div>
  );
}
type Item = Pick<PlaylistItem, 'item_type' | 'ref_id' | 'duration_s'>;

function PlaylistEditor(props: { items: Item[]; onChange: (items: Item[]) => void; products: Product[]; promos: Promo[] }) {
  const { categories } = useApp();
  const [kind, setKind] = useState<PlaylistItemType>('category');
  const [ref, setRef] = useState('');

  const label = (item: Item) => {
    if (item.item_type === 'offers') return '⭐ Todas las ofertas';
    if (item.item_type === 'category') return `🗂️ ${categories.find((c) => c.id === item.ref_id)?.name ?? '(categoría eliminada)'}`;
    if (item.item_type === 'product') return `🧀 ${props.products.find((p) => p.id === item.ref_id)?.name ?? '(producto eliminado)'}`;
    return `📣 ${props.promos.find((p) => p.id === item.ref_id)?.title ?? '(promoción eliminada)'}`;
  };

  const add = () => {
    if (kind !== 'offers' && !ref) return;
    props.onChange([...props.items, { item_type: kind, ref_id: kind === 'offers' ? null : Number(ref), duration_s: null }]);
    setRef('');
  };
  const move = (i: number, d: number) => {
    const list = [...props.items];
    const j = i + d;
    if (j < 0 || j >= list.length) return;
    [list[i], list[j]] = [list[j]!, list[i]!];
    props.onChange(list);
  };

  const options =
    kind === 'category'
      ? categories.map((c) => ({ id: c.id, name: c.name }))
      : kind === 'product'
        ? props.products.map((p) => ({ id: p.id, name: p.name }))
        : kind === 'promo'
          ? props.promos.map((p) => ({ id: p.id, name: p.title }))
          : [];

  return (
    <div class="playlist">
      {props.items.length === 0 && <p class="hint">Lista vacía: se mostrarán todas las categorías activas y las promociones vigentes.</p>}
      <ol>
        {props.items.map((item, i) => (
          <li key={i}>
            <span class="grow">{label(item)}</span>
            <input
              class="dur"
              type="number"
              min={3}
              max={600}
              placeholder="seg"
              title="Segundos en pantalla (vacío = valor de la pantalla)"
              value={item.duration_s ?? ''}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                const list = [...props.items];
                list[i] = { ...item, duration_s: v ? Math.max(3, Number(v)) : null };
                props.onChange(list);
              }}
            />
            <button type="button" class="icon" onClick={() => move(i, -1)} aria-label="Subir">
              ▲
            </button>
            <button type="button" class="icon" onClick={() => move(i, 1)} aria-label="Bajar">
              ▼
            </button>
            <button type="button" class="icon" onClick={() => props.onChange(props.items.filter((_, j) => j !== i))} aria-label="Quitar">
              ✕
            </button>
          </li>
        ))}
      </ol>
      <div class="add-row">
        <select
          value={kind}
          onChange={(e) => {
            setKind((e.target as HTMLSelectElement).value as PlaylistItemType);
            setRef('');
          }}
        >
          <option value="category">Categoría</option>
          <option value="product">Producto</option>
          <option value="offers">Todas las ofertas</option>
          <option value="promo">Promoción</option>
        </select>
        {kind !== 'offers' && (
          <select value={ref} onChange={(e) => setRef((e.target as HTMLSelectElement).value)}>
            <option value="">Elegir…</option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        )}
        <button type="button" class="btn" onClick={add}>
          Agregar
        </button>
      </div>
    </div>
  );
}

function ScreenForm(props: { initial: Draft; onClose: () => void; onSaved: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState<Draft>(props.initial);
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    api<Product[]>('/api/admin/products').then(setProducts);
    api<Promo[]>('/api/admin/promos').then(setPromos);
    if (props.initial.id) api<PlaylistItem[]>(`/api/admin/screens/${props.initial.id}/playlist`).then(setItems);
  }, []);

  const pickLayout = (layout: Layout) => {
    const info = LAYOUT_INFO[layout];
    setD((x) => ({ ...x, layout, grid_cols: info.cols, grid_rows: info.rows }));
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const { id, ...body } = d;
    try {
      const screen = id
        ? await api<Screen>(`/api/admin/screens/${id}`, { method: 'PUT', body })
        : await api<Screen>('/api/admin/screens', { body });
      await api(`/api/admin/screens/${screen.id}/playlist`, { method: 'PUT', body: items });
      toast('Pantalla guardada');
      props.onSaved();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (!d.id || !confirm(`¿Eliminar la pantalla "${d.name}"?`)) return;
    await api(`/api/admin/screens/${d.id}`, { method: 'DELETE' });
    props.onSaved();
  };

  const showGrid = d.layout === 'grid' || d.layout === 'menu';

  return (
    <Modal title={d.id ? `Editar ${d.name}` : 'Nueva pantalla'} onClose={props.onClose} wide>
      <form class="form" onSubmit={save}>
        <div class="row">
          <Field label="Nombre interno">
            <input required maxLength={60} value={d.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="Título en pantalla" hint="Se usa cuando no hay categoría (productos sueltos, banners).">
            <input maxLength={60} value={d.title} onInput={(e) => set('title', (e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Field label="Diseño">
          <div class="layouts">
            {(Object.keys(LAYOUT_INFO) as Layout[]).map((l) => (
              <button type="button" key={l} class={`layout-opt ${l}${d.layout === l ? ' selected' : ''}`} onClick={() => pickLayout(l)}>
                <span class="mini" />
                <b>{LAYOUT_INFO[l].label}</b>
                <small>{LAYOUT_INFO[l].desc}</small>
              </button>
            ))}
          </div>
        </Field>
        <div class="row">
          {showGrid && (
            <Field label="Columnas">
              <input type="number" min={1} max={6} value={d.grid_cols} onInput={(e) => set('grid_cols', Number((e.target as HTMLInputElement).value))} />
            </Field>
          )}
          {showGrid && (
            <Field label="Filas">
              <input type="number" min={1} max={12} value={d.grid_rows} onInput={(e) => set('grid_rows', Number((e.target as HTMLInputElement).value))} />
            </Field>
          )}
          <Field label="Segundos por diapositiva">
            <input type="number" min={3} max={600} value={d.rotation_seconds} onInput={(e) => set('rotation_seconds', Number((e.target as HTMLInputElement).value))} />
          </Field>
          <Field label="Orientación">
            <select value={d.orientation} onChange={(e) => set('orientation', (e.target as HTMLSelectElement).value as Draft['orientation'])}>
              <option value="landscape">Horizontal</option>
              <option value="portrait">Vertical</option>
            </select>
          </Field>
        </div>
        <div class="row toggles">
          <Toggle label="Activa" checked={d.active} onChange={(v) => set('active', v)} />
          <Toggle label="Bajo consumo (TV o PC lento)" checked={d.low_power} onChange={(v) => set('low_power', v)} />
        </div>
        <Field label="¿Qué muestra este TV? (en orden)">
          <PlaylistEditor items={items} onChange={setItems} products={products} promos={promos} />
        </Field>
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
          <button class="btn primary">Guardar</button>
        </footer>
      </form>
    </Modal>
  );
}

export function Screens() {
  const { screenStatus, toast, revision } = useApp();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const load = () => api<{ screens: Screen[] }>('/api/admin/screens').then((r) => setScreens(r.screens));
  useEffect(() => {
    load();
  }, [revision]);

  const reload = async (id: number) => {
    await api(`/api/admin/screens/${id}/reload`, { method: 'POST' });
    toast('Orden de recarga enviada');
  };

  return (
    <div>
      <div class="toolbar">
        <p class="hint">
          Cada televisor abre su dirección en el navegador (pantalla completa). Lista de pantallas: <a href="/tv/" target="_blank" rel="noreferrer">{location.host}/tv/</a>
        </p>
        <span class="grow" />
        <button
          class="btn primary"
          onClick={() =>
            setEditing({
              name: `TV ${screens.length + 1}`,
              title: '',
              layout: 'grid',
              grid_cols: 3,
              grid_rows: 2,
              rotation_seconds: 10,
              orientation: 'landscape',
              low_power: false,
              active: true,
            })
          }
        >
          + Nueva pantalla
        </button>
      </div>
      {screens.length === 0 ? (
        <Empty>No hay pantallas configuradas.</Empty>
      ) : (
        <div class="screens">
          {screens.map((s) => {
            const st = screenStatus.find((x) => x.screen_id === s.id);
            const on = (st?.connections ?? 0) > 0;
            return (
              <div key={s.id} class={`screen-card${s.active ? '' : ' inactive'}`}>
                <Preview screen={s} />
                <div class="info">
                  <b>{s.name}</b>
                  <small>
                    {LAYOUT_INFO[s.layout].label} · <span class={`dot ${on ? 'on' : 'off'}`} /> {on ? 'conectado' : `desconectado (${timeAgo(st?.last_seen ?? null)})`}
                  </small>
                  <code>
                    {location.host}/tv/{s.id}
                  </code>
                  <div class="btns">
                    <button class="btn small primary" onClick={() => setEditing({ ...s })}>
                      Configurar
                    </button>
                    <a class="btn small" href={`/tv/${s.id}`} target="_blank" rel="noreferrer">
                      Abrir
                    </a>
                    <button class="btn small ghost" onClick={() => reload(s.id)} disabled={!on}>
                      Recargar TV
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <ScreenForm
          initial={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </div>
  );
}
