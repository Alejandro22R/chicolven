import { useEffect, useState } from 'preact/hooks';
import type { Promo } from '@chicolven/shared/types';
import { api } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, notify } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Empty, Field, fmtDateTime, ImagePicker, Modal, PageHeader, Toggle, useModalClose, useValidation } from '../components/ui.tsx';

type Draft = Omit<Promo, 'id'> & { id?: number };

/** datetime-local value <-> ISO */
const toLocal = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
const fromLocal = (v: string) => (v ? new Date(v).toISOString() : null);

function liveState(p: Promo): { label: string; cls: string } {
  const now = Date.now();
  if (!p.active) return { label: 'Inactiva', cls: '' };
  if (p.starts_at && new Date(p.starts_at).getTime() > now) return { label: 'Programada', cls: 'pending' };
  if (p.ends_at && new Date(p.ends_at).getTime() < now) return { label: 'Vencida', cls: 'rejected' };
  return { label: 'En pantalla', cls: 'ok' };
}

function PromoForm(props: { initial: Draft; onSaved: () => void }) {
  const close = useModalClose();
  const [d, setD] = useState(props.initial);
  const v = useValidation();
  const set = <K extends keyof Draft>(k: K, val: Draft[K]) => {
    v.clear(k as string);
    setD((x) => ({ ...x, [k]: val }));
  };

  const save = async (e: Event) => {
    e.preventDefault();
    const start = d.starts_at ? new Date(d.starts_at).getTime() : null;
    const end = d.ends_at ? new Date(d.ends_at).getTime() : null;
    const ok = await v.validate([
      [!d.title.trim(), 'title', 'Título de la promoción'],
      [start !== null && end !== null && end <= start, 'ends_at', 'Fecha “Hasta” posterior a “Desde”'],
    ]);
    if (!ok) return;
    if (end !== null && end < Date.now()) {
      const sure = await confirmAction({
        title: 'La promoción ya venció',
        text: 'La fecha “Hasta” ya pasó, así que no se mostrará en los televisores. ¿Guardar igual?',
        confirmText: 'Guardar igual',
        icon: 'warning',
      });
      if (!sure) return;
    }
    const { id, ...body } = { ...d, title: d.title.trim(), subtitle: d.subtitle.trim() };
    try {
      if (id) await api(`/api/admin/promos/${id}`, { method: 'PUT', body });
      else await api('/api/admin/promos', { body });
      notify(id ? 'Promoción actualizada' : 'Promoción creada');
      props.onSaved();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    }
  };

  const remove = async () => {
    if (
      !d.id ||
      !(await confirmAction({
        title: '¿Eliminar la promoción?',
        html: `Se eliminará <b>${escapeHtml(d.title)}</b> de todos los televisores.`,
        confirmText: 'Sí, eliminar',
        danger: true,
      }))
    )
      return;
    await api(`/api/admin/promos/${d.id}`, { method: 'DELETE' });
    notify('Promoción eliminada');
    props.onSaved();
  };

  return (
    <form class="form" onSubmit={save} noValidate>
      <ImagePicker value={d.image_path} onChange={(val) => set('image_path', val)} />
      <p class="hint">Sin imagen, se muestra la pantalla de bienvenida animada con el logo.</p>
      <Field label="Título" required invalid={v.has('title')}>
        <input maxLength={80} value={d.title} placeholder="Ej. ¡Bienvenidos a Chicolven!" onInput={(e) => set('title', (e.target as HTMLInputElement).value)} />
      </Field>
      <Field label="Subtítulo">
        <input maxLength={160} value={d.subtitle} onInput={(e) => set('subtitle', (e.target as HTMLInputElement).value)} />
      </Field>
      <div class="row">
        <Field label="Desde (opcional)">
          <input type="datetime-local" value={toLocal(d.starts_at)} onInput={(e) => set('starts_at', fromLocal((e.target as HTMLInputElement).value))} />
        </Field>
        <Field label="Hasta (opcional)" invalid={v.has('ends_at')}>
          <input type="datetime-local" value={toLocal(d.ends_at)} onInput={(e) => set('ends_at', fromLocal((e.target as HTMLInputElement).value))} />
        </Field>
      </div>
      <Toggle label="Activa" checked={d.active} onChange={(val) => set('active', val)} />
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

export function Promos() {
  const { revision } = useApp();
  const [promos, setPromos] = useState<Promo[]>([]);
  const [editing, setEditing] = useState<Draft | null>(null);
  const [dirty, setDirty] = useState(false);
  const load = () => api<Promo[]>('/api/admin/promos').then(setPromos);
  useEffect(() => {
    load();
  }, [revision]);

  const open = (d: Draft) => {
    setDirty(false);
    setEditing(d);
  };

  return (
    <div>
      <PageHeader icon="megaphone" title="Promociones" description="Banners a pantalla completa: imagen de un proveedor, anuncio del día o bienvenida. Pueden tener fecha de inicio y fin.">
        <button class="btn primary" onClick={() => open({ title: '', subtitle: '', image_path: null, starts_at: null, ends_at: null, active: true })}>
          <Icon name="plus" size={16} /> Nueva promoción
        </button>
      </PageHeader>
      {promos.length === 0 ? (
        <Empty icon="megaphone">No hay promociones.</Empty>
      ) : (
        <div class="promo-grid">
          {promos.map((p) => {
            const st = liveState(p);
            return (
              <button key={p.id} class="promo-card" onClick={() => open({ ...p })}>
                <div class="img">{p.image_path ? <img src={`/media/${p.image_path}`} alt="" /> : <span>{p.title}</span>}</div>
                <div class="promo-info">
                  <b>{p.title}</b>
                  <span class={`chip ${st.cls}`}>{st.label}</span>
                  {p.ends_at && <small>hasta {fmtDateTime(p.ends_at)}</small>}
                </div>
              </button>
            );
          })}
        </div>
      )}
      {editing && (
        <Modal title={editing.id ? 'Editar promoción' : 'Nueva promoción'} icon="megaphone" onClose={() => setEditing(null)} wide dirty={dirty}>
          <div onInput={() => setDirty(true)} onChange={() => setDirty(true)}>
            <PromoForm
              initial={editing}
              onSaved={() => {
                setEditing(null);
                load();
              }}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
