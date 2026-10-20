import { useEffect, useState } from 'preact/hooks';
import type { Promo } from '@chicolven/shared/types';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Empty, Field, ImagePicker, Modal, Toggle, fmtDateTime } from '../components/ui.tsx';

type Draft = Omit<Promo, 'id'> & { id?: number };

/** datetime-local value <-> ISO */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function liveState(p: Promo): string {
  const now = Date.now();
  if (!p.active) return 'Inactiva';
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return 'Programada';
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return 'Vencida';
  return 'En pantalla';
}

export function Promos() {
  const { toast, revision } = useApp();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const load = () => api<Promo[]>('/api/admin/promos').then(setPromos);
  useEffect(() => {
    load();
  }, [revision]);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setEditing((d) => (d ? { ...d, [k]: v } : d));

  const save = async (e: Event) => {
    e.preventDefault();
    if (!editing) return;
    const { id, ...body } = editing;
    try {
      if (id) await api(`/api/admin/promos/${id}`, { method: 'PUT', body });
      else await api('/api/admin/promos', { body });
      setEditing(null);
      load();
      toast('Promoción guardada');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const remove = async () => {
    if (!editing?.id || !confirm('¿Eliminar esta promoción?')) return;
    await api(`/api/admin/promos/${editing.id}`, { method: 'DELETE' });
    setEditing(null);
    load();
  };

  return (
    <div>
      <div class="toolbar">
        <p class="hint">Banners a pantalla completa (imagen de un proveedor, anuncio del día). Pueden tener fecha de inicio y fin.</p>
        <span class="grow" />
        <button
          class="btn primary"
          onClick={() => setEditing({ title: '', subtitle: '', image_path: null, starts_at: null, ends_at: null, active: true })}
        >
          + Nueva promoción
        </button>
      </div>
      {promos.length === 0 ? (
        <Empty>No hay promociones.</Empty>
      ) : (
        <div class="promo-grid">
          {promos.map((p) => (
            <button key={p.id} class="promo-card" onClick={() => setEditing({ ...p })}>
              <div class="img">{p.image_path ? <img src={`/media/${p.image_path}`} alt="" /> : <span>{p.title}</span>}</div>
              <b>{p.title}</b>
              <small>
                {liveState(p)}
                {p.ends_at ? ` · hasta ${fmtDateTime(p.ends_at)}` : ''}
              </small>
            </button>
          ))}
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? 'Editar promoción' : 'Nueva promoción'} onClose={() => setEditing(null)} wide>
          <form class="form" onSubmit={save}>
            <ImagePicker value={editing.image_path} onChange={(v) => set('image_path', v)} />
            <Field label="Título">
              <input required maxLength={80} value={editing.title} onInput={(e) => set('title', (e.target as HTMLInputElement).value)} />
            </Field>
            <Field label="Subtítulo">
              <input maxLength={160} value={editing.subtitle} onInput={(e) => set('subtitle', (e.target as HTMLInputElement).value)} />
            </Field>
            <div class="row">
              <Field label="Desde (opcional)">
                <input type="datetime-local" value={toLocal(editing.starts_at)} onInput={(e) => set('starts_at', fromLocal((e.target as HTMLInputElement).value))} />
              </Field>
              <Field label="Hasta (opcional)">
                <input type="datetime-local" value={toLocal(editing.ends_at)} onInput={(e) => set('ends_at', fromLocal((e.target as HTMLInputElement).value))} />
              </Field>
            </div>
            <Toggle label="Activa" checked={editing.active} onChange={(v) => set('active', v)} />
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
