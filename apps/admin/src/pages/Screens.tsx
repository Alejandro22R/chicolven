import { useEffect, useRef, useState } from 'preact/hooks';
import type { Layout, PlaylistItem, PlaylistItemType, Product, Promo, Screen } from '@chicolven/shared/types';
import { api } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, notify } from '../alerts.ts';
import { useApp } from '../state.ts';
import { useTvAddress } from '../network.ts';
import { Icon } from '../components/icons.tsx';
import { Empty, Field, Modal, PageHeader, Toggle, timeAgo, useModalClose, useValidation } from '../components/ui.tsx';

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
    if (kind !== 'offers' && !ref) {
      notify('Elija qué agregar en la segunda lista', 'warning');
      return;
    }
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
              <Icon name="arrowUp" size={15} />
            </button>
            <button type="button" class="icon" onClick={() => move(i, 1)} aria-label="Bajar">
              <Icon name="arrowDown" size={15} />
            </button>
            <button type="button" class="icon" onClick={() => props.onChange(props.items.filter((_, j) => j !== i))} aria-label="Quitar">
              <Icon name="close" size={15} />
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
          <Icon name="plus" size={15} /> Agregar
        </button>
      </div>
    </div>
  );
}

function ScreenForm(props: { initial: Draft; screens: Screen[]; onSaved: () => void; onDirty: () => void }) {
  const close = useModalClose();
  const [d, setD] = useState<Draft>(props.initial);
  const [items, setItems] = useState<Item[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [promos, setPromos] = useState<Promo[]>([]);
  const v = useValidation();
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => {
    v.clear(k as string);
    props.onDirty();
    setD((x) => ({ ...x, [k]: val }));
  };

  useEffect(() => {
    api<Product[]>('/api/admin/products').then(setProducts);
    api<Promo[]>('/api/admin/promos').then(setPromos);
    if (props.initial.id) api<PlaylistItem[]>(`/api/admin/screens/${props.initial.id}/playlist`).then(setItems);
  }, []);

  const pickLayout = (layout: Layout) => {
    const info = LAYOUT_INFO[layout];
    props.onDirty();
    setD((x) => ({ ...x, layout, grid_cols: info.cols, grid_rows: info.rows }));
  };

  const int = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;

  const save = async (e: Event) => {
    e.preventDefault();
    const showGrid = d.layout === 'grid' || d.layout === 'menu';
    const ok = await v.validate([
      [!d.name.trim(), 'name', 'Nombre de la pantalla'],
      [props.screens.some((x) => x.id !== d.id && x.name.trim().toLowerCase() === d.name.trim().toLowerCase()), 'name', 'Un nombre distinto (ya existe otra pantalla con ese nombre)'],
      [showGrid && !int(d.grid_cols, 1, 6), 'grid_cols', 'Columnas: número entre 1 y 6'],
      [showGrid && !int(d.grid_rows, 1, 12), 'grid_rows', 'Filas: número entre 1 y 12'],
      [!int(d.rotation_seconds, 3, 600), 'rotation_seconds', 'Segundos por diapositiva: entre 3 y 600'],
    ]);
    if (!ok) return;
    if (d.layout === 'promo' && !promos.some((p) => p.active)) {
      const sure = await confirmAction({
        title: 'No hay promociones activas',
        text: 'Este diseño solo muestra promociones y no hay ninguna activa: el televisor se verá con el logo en espera. ¿Guardar igual?',
        confirmText: 'Guardar igual',
        icon: 'warning',
      });
      if (!sure) return;
    }
    if (d.id && !d.active && props.initial.active) {
      const sure = await confirmAction({ title: '¿Desactivar la pantalla?', text: 'El televisor dejará de mostrar productos.', confirmText: 'Desactivar', icon: 'warning' });
      if (!sure) return;
    }
    const { id, ...body } = { ...d, name: d.name.trim(), title: d.title.trim() };
    try {
      const screen = id
        ? await api<Screen>(`/api/admin/screens/${id}`, { method: 'PUT', body })
        : await api<Screen>('/api/admin/screens', { body });
      await api(`/api/admin/screens/${screen.id}/playlist`, { method: 'PUT', body: items });
      notify(id ? 'Pantalla guardada' : `Pantalla creada: en el televisor abra la dirección ${screen.id}`);
      props.onSaved();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    }
  };

  const remove = async () => {
    if (
      !d.id ||
      !(await confirmAction({
        title: '¿Eliminar la pantalla?',
        html: `Se eliminará <b>${escapeHtml(d.name)}</b> y su lista de contenido. El televisor que la usa mostrará “Pantalla no encontrada”.`,
        confirmText: 'Sí, eliminar',
        danger: true,
      }))
    )
      return;
    await api(`/api/admin/screens/${d.id}`, { method: 'DELETE' });
    notify('Pantalla eliminada');
    props.onSaved();
  };

  const showGrid = d.layout === 'grid' || d.layout === 'menu';

  return (
    <form class="form" onSubmit={save} noValidate>
      <div class="row">
        <Field label="Nombre interno" required invalid={v.has('name')}>
          <input maxLength={60} value={d.name} placeholder="Ej. TV 1 - Mostrador" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
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
          <Field label="Columnas" invalid={v.has('grid_cols')}>
            <input type="number" min={1} max={6} value={d.grid_cols} onInput={(e) => set('grid_cols', Number((e.target as HTMLInputElement).value))} />
          </Field>
        )}
        {showGrid && (
          <Field label="Filas" invalid={v.has('grid_rows')}>
            <input type="number" min={1} max={12} value={d.grid_rows} onInput={(e) => set('grid_rows', Number((e.target as HTMLInputElement).value))} />
          </Field>
        )}
        <Field label="Segundos por diapositiva" invalid={v.has('rotation_seconds')}>
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
        <Toggle label="Activa" checked={d.active} onChange={(val) => set('active', val)} />
        <Toggle label="Bajo consumo (TV o PC lento)" checked={d.low_power} onChange={(val) => set('low_power', val)} />
      </div>
      <Field label="¿Qué muestra este TV? (en orden)">
        <PlaylistEditor
          items={items}
          onChange={(list) => {
            props.onDirty();
            setItems(list);
          }}
          products={products}
          promos={promos}
        />
      </Field>
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
        <button class="btn primary">
          <Icon name="check" size={16} /> Guardar
        </button>
      </footer>
    </form>
  );
}

export function Screens() {
  const { screenStatus, revision } = useApp();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const addr = useTvAddress();
  const load = () => api<{ screens: Screen[] }>('/api/admin/screens').then((r) => setScreens(r.screens));
  useEffect(() => {
    load();
  }, [revision]);

  const open = (d: Draft) => {
    setDirty(false);
    setEditing(d);
  };

  const reload = async (s: Screen) => {
    const sure = await confirmAction({
      title: `¿Recargar ${s.name}?`,
      text: 'El televisor volverá a cargar la página (tarda unos segundos). Útil después de una actualización.',
      confirmText: 'Recargar',
    });
    if (!sure) return;
    await api(`/api/admin/screens/${s.id}/reload`, { method: 'POST' });
    notify('Orden de recarga enviada');
  };

  const copyUrl = async (id: number) => {
    const url = `http://${addr.name}/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      notify('Dirección copiada');
    } catch {
      notify(url, 'info');
    }
  };

  return (
    <div>
      <div class="tv-address">
        <Icon name="wifi" size={20} />
        <div>
          <b>
            Dirección para los televisores: <code>http://{addr.name}</code>
          </b>
          <small>
            Agregue el número de la pantalla al final (por ejemplo <code>http://{addr.name}/1</code>). Si un televisor no abre el nombre, use la IP:{' '}
            <code>http://{addr.ip}/1</code>
          </small>
        </div>
      </div>
      <PageHeader icon="tv" title="Pantallas" description="Cada televisor abre su dirección en el navegador a pantalla completa.">
        <a class="btn" href="/tv/" target="_blank" rel="noreferrer">
          <Icon name="external" size={16} /> Lista para TVs
        </a>
        <button
          class="btn primary"
          onClick={() =>
            open({
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
          <Icon name="plus" size={16} /> Nueva pantalla
        </button>
      </PageHeader>
      {screens.length === 0 ? (
        <Empty icon="tv">No hay pantallas configuradas.</Empty>
      ) : (
        <div class="screens">
          {screens.map((s) => {
            const st = screenStatus.find((x) => x.screen_id === s.id);
            const on = (st?.connections ?? 0) > 0;
            return (
              <div key={s.id} class={`screen-card${s.active ? '' : ' inactive'}`}>
                <Preview screen={s} />
                <div class="info">
                  <div class="title-row">
                    <b>{s.name}</b>
                    <span class={`chip ${on ? 'ok' : ''}`}>
                      <span class={`dot ${on ? 'on' : 'off'}`} /> {on ? 'conectado' : 'desconectado'}
                    </span>
                  </div>
                  <small>
                    {LAYOUT_INFO[s.layout].label}
                    {!on && st?.last_seen ? ` · visto ${timeAgo(st.last_seen)}` : ''}
                    {!s.active ? ' · inactiva' : ''}
                  </small>
                  <button class="url" onClick={() => copyUrl(s.id)} title="Copiar dirección">
                    {addr.name}/{s.id}
                  </button>
                  <div class="btns">
                    <button class="btn small primary" onClick={() => open({ ...s })}>
                      <Icon name="settings" size={14} /> Configurar
                    </button>
                    <a class="btn small" href={`/tv/${s.id}`} target="_blank" rel="noreferrer">
                      <Icon name="external" size={14} /> Abrir
                    </a>
                    <button class="btn small ghost" onClick={() => reload(s)} disabled={!on}>
                      <Icon name="refresh" size={14} /> Recargar
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? `Configurar ${editing.name}` : 'Nueva pantalla'} icon="tv" onClose={() => setEditing(null)} wide dirty={dirty}>
          <ScreenForm
            initial={editing}
            screens={screens}
            onDirty={() => setDirty(true)}
            onSaved={() => {
              setEditing(null);
              load();
            }}
          />
        </Modal>
      )}
    </div>
  );
}
