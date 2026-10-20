import { useState } from 'preact/hooks';
import type { Category } from '@chicolven/shared/types';
import { BRAND } from '@chicolven/shared/brand';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Empty, Field, Modal, Toggle } from '../components/ui.tsx';

const SWATCHES = [BRAND.red, BRAND.wine, BRAND.yellow, BRAND.lime, BRAND.blue, '#E67E22', '#8E44AD', '#16A085'];

type Draft = Omit<Category, 'id'> & { id?: number };

export function Categories() {
  const { categories, reloadShared, toast } = useApp();
  const [editing, setEditing] = useState<Draft | null>(null);

  const save = async (e: Event) => {
    e.preventDefault();
    if (!editing) return;
    const { id, ...body } = editing;
    try {
      if (id) await api(`/api/admin/categories/${id}`, { method: 'PUT', body });
      else await api('/api/admin/categories', { body });
      setEditing(null);
      await reloadShared();
      toast('Categoría guardada');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (!editing?.id || !confirm(`¿Eliminar la categoría "${editing.name}"? Sus productos quedarán sin categoría.`)) return;
    await api(`/api/admin/categories/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    await reloadShared();
  };

  const move = async (index: number, delta: number) => {
    const list = [...categories];
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    await Promise.all(list.map((c, i) => (c.sort_order === i ? null : api(`/api/admin/categories/${c.id}`, { method: 'PUT', body: { sort_order: i } }))));
    await reloadShared();
  };

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div>
      <div class="toolbar">
        <p class="hint">El orden de las categorías es el orden en que salen en los TVs.</p>
        <span class="grow" />
        <button
          class="btn primary"
          onClick={() => setEditing({ name: '', color: BRAND.red, icon: null, sort_order: categories.length, active: true })}
        >
          + Nueva categoría
        </button>
      </div>
      {categories.length === 0 ? (
        <Empty>Aún no hay categorías.</Empty>
      ) : (
        <ul class="sortable">
          {categories.map((c, i) => (
            <li key={c.id} class={c.active ? '' : 'inactive'}>
              <span class="swatch" style={{ background: c.color }} />
              <b>
                {c.icon} {c.name}
              </b>
              {!c.active && <span class="muted">oculta</span>}
              <span class="grow" />
              <button class="icon" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Subir">
                ▲
              </button>
              <button class="icon" disabled={i === categories.length - 1} onClick={() => move(i, 1)} aria-label="Bajar">
                ▼
              </button>
              <button class="btn small" onClick={() => setEditing({ ...c })}>
                Editar
              </button>
            </li>
          ))}
        </ul>
      )}

      {editing && (
        <Modal title={editing.id ? 'Editar categoría' : 'Nueva categoría'} onClose={() => setEditing(null)}>
          <form class="form" onSubmit={save}>
            <div class="row">
              <Field label="Nombre">
                <input required maxLength={60} autoFocus value={editing.name} onInput={(e) => set('name', (e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="Ícono (emoji, opcional)">
                <input maxLength={4} value={editing.icon ?? ''} onInput={(e) => set('icon', (e.target as HTMLInputElement).value || null)} />
              </Field>
            </div>
            <Field label="Color">
              <div class="swatches">
                {SWATCHES.map((s) => (
                  <button
                    type="button"
                    key={s}
                    class={`swatch big${editing.color.toUpperCase() === s.toUpperCase() ? ' selected' : ''}`}
                    style={{ background: s }}
                    onClick={() => set('color', s)}
                    aria-label={s}
                  />
                ))}
                <input type="color" value={editing.color} onInput={(e) => set('color', (e.target as HTMLInputElement).value.toUpperCase())} />
              </div>
            </Field>
            <Toggle label="Visible en los TVs" checked={editing.active} onChange={(v) => set('active', v)} />
            <footer class="actions">
              {editing.id && (
                <button type="button" class="btn danger" onClick={remove}>
                  Eliminar
                </button>
              )}
              <span class="grow" />
              <button type="button" class="btn ghost" onClick={() => setEditing(null)}>
                Cancelar
              </button>
              <button class="btn primary">Guardar</button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
