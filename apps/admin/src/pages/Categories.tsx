import { useState } from 'preact/hooks';
import type { Category } from '@chicolven/shared/types';
import { BRAND } from '@chicolven/shared/brand';
import { api } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, notify } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Empty, Field, Modal, PageHeader, Toggle, useModalClose, useValidation } from '../components/ui.tsx';

const SWATCHES = [BRAND.red, BRAND.wine, BRAND.yellow, BRAND.lime, BRAND.blue, '#E67E22', '#8E44AD', '#16A085'];

type Draft = Omit<Category, 'id'> & { id?: number };

function CategoryForm(props: { initial: Draft; onSaved: () => void }) {
  const { categories } = useApp();
  const close = useModalClose();
  const [d, setD] = useState(props.initial);
  const v = useValidation();
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => {
    v.clear(k as string);
    setD((x) => ({ ...x, [k]: val }));
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const dup = categories.find((c) => c.id !== d.id && c.name.trim().toLowerCase() === d.name.trim().toLowerCase());
    const ok = await v.validate([
      [!d.name.trim(), 'name', 'Nombre de la categoría'],
      [Boolean(dup), 'name', 'Un nombre distinto (ya existe una categoría con ese nombre)'],
    ]);
    if (!ok) return;
    if (d.id && d.active === false && props.initial.active) {
      const sure = await confirmAction({
        title: '¿Ocultar la categoría?',
        text: 'Todos sus productos dejarán de mostrarse en los televisores.',
        confirmText: 'Ocultar',
        icon: 'warning',
      });
      if (!sure) return;
    }
    const { id, ...body } = { ...d, name: d.name.trim() };
    try {
      if (id) await api(`/api/admin/categories/${id}`, { method: 'PUT', body });
      else await api('/api/admin/categories', { body });
      notify(id ? 'Categoría actualizada' : 'Categoría creada');
      props.onSaved();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    }
  };

  const remove = async () => {
    if (!d.id) return;
    const products = await api<unknown[]>(`/api/admin/products?category_id=${d.id}`);
    const sure = await confirmAction({
      title: '¿Eliminar la categoría?',
      html: `Se eliminará <b>${escapeHtml(d.name)}</b>.${
        products.length ? `<br>Sus <b>${products.length}</b> productos no se borran: quedarán “sin categoría”.` : ''
      }`,
      confirmText: 'Sí, eliminar',
      danger: true,
    });
    if (!sure) return;
    await api(`/api/admin/categories/${d.id}`, { method: 'DELETE' });
    notify('Categoría eliminada');
    props.onSaved();
  };

  return (
    <form class="form" onSubmit={save} noValidate>
      <div class="row">
        <Field label="Nombre" required invalid={v.has('name')}>
          <input maxLength={60} autoFocus value={d.name} placeholder="Ej. Quesos" onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
        </Field>
        <Field label="Ícono (emoji, opcional)">
          <input maxLength={4} value={d.icon ?? ''} placeholder="🧀" onInput={(e) => set('icon', (e.target as HTMLInputElement).value || null)} />
        </Field>
      </div>
      <Field label="Color" hint="Se usa en el título y el fondo de las fotos en los televisores.">
        <div class="swatches">
          {SWATCHES.map((s) => (
            <button
              type="button"
              key={s}
              class={`swatch big${d.color.toUpperCase() === s.toUpperCase() ? ' selected' : ''}`}
              style={{ background: s }}
              onClick={() => set('color', s)}
              aria-label={s}
            />
          ))}
          <input type="color" value={d.color} onInput={(e) => set('color', (e.target as HTMLInputElement).value.toUpperCase())} />
        </div>
      </Field>
      <Toggle label="Visible en los televisores" checked={d.active} onChange={(val) => set('active', val)} />
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

export function Categories() {
  const { categories, reloadShared } = useApp();
  const [editing, setEditing] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);

  const move = async (index: number, delta: number) => {
    const list = [...categories];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    await Promise.all(list.map((c, i) => (c.sort_order === i ? null : api(`/api/admin/categories/${c.id}`, { method: 'PUT', body: { sort_order: i } }))));
    await reloadShared();
    notify('Orden actualizado');
  };

  return (
    <div>
      <PageHeader icon="tag" title="Categorías" description="El orden de la lista es el orden en que salen en los televisores.">
        <button
          class="btn primary"
          onClick={() => {
            const d = { name: '', color: BRAND.red, icon: null, sort_order: categories.length, active: true };
            setDirty(false);
            setEditing(d);
          }}
        >
          <Icon name="plus" size={16} /> Nueva categoría
        </button>
      </PageHeader>
      {categories.length === 0 ? (
        <Empty icon="tag">Aún no hay categorías. Cree la primera (por ejemplo “Charcutería”).</Empty>
      ) : (
        <ul class="sortable">
          {categories.map((c, i) => (
            <li key={c.id} class={c.active ? '' : 'inactive'}>
              <span class="swatch" style={{ background: c.color }} />
              <b>
                {c.icon} {c.name}
              </b>
              {!c.active && <span class="chip">oculta</span>}
              <span class="grow" />
              <button class="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                <Icon name="arrowUp" size={16} />
              </button>
              <button class="icon" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                <Icon name="arrowDown" size={16} />
              </button>
              <button
                class="btn small"
                onClick={() => {
                  setDirty(false);
                  setEditing({ ...c });
                }}
              >
                <Icon name="edit" size={14} /> Editar
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal
          title={editing.id ? 'Editar categoría' : 'Nueva categoría'}
          icon="tag"
          onClose={() => setEditing(null)}
          dirty={dirty}
        >
          <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
            <CategoryForm
              initial={editing}
              onSaved={async () => {
                setEditing(null);
                await reloadShared();
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
