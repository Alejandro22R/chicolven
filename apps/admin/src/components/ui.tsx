import { createContext, type ComponentChildren } from 'preact';
import { useContext, useEffect, useRef, useState } from 'preact/hooks';
import { uploadImage } from '../api.ts';
import { confirmDiscard, errorAlert, missingFields } from '../alerts.ts';
import { Icon, type IconName } from './icons.tsx';

/**
 * Modal dialog. When `dirty` is true, closing it (✕, Esc, click outside, Cancel) asks before
 * throwing the changes away.
 */
export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean; dirty?: boolean; icon?: IconName }) {
  const dirtyRef = useRef(props.dirty);
  dirtyRef.current = props.dirty;
  const tryClose = async () => {
    if (dirtyRef.current && !(await confirmDiscard())) return;
    props.onClose();
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // SweetAlert handles its own Esc while open.
      if (e.key === 'Escape' && !document.querySelector('.swal2-container')) void tryClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && void tryClose()}>
      <div class={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-label={props.title}>
        <header>
          {props.icon && (
            <span class="modal-icon">
              <Icon name={props.icon} size={20} />
            </span>
          )}
          <h2>{props.title}</h2>
          <button class="icon" onClick={() => void tryClose()} aria-label="Cerrar">
            <Icon name="close" />
          </button>
        </header>
        <CloseContext.Provider value={tryClose}>{props.children}</CloseContext.Provider>
      </div>
    </div>
  );
}

const CloseContext = createContext<() => Promise<void>>(async () => {});
/** For "Cancelar" buttons inside a modal: closes with the same unsaved-changes check as ✕. */
export const useModalClose = () => useContext(CloseContext);

export function Field(props: { label: string; hint?: string; required?: boolean; invalid?: boolean; children: ComponentChildren }) {
  return (
    <label class={`field${props.invalid ? ' invalid' : ''}`}>
      <span>
        {props.label}
        {props.required && <em class="req"> *</em>}
      </span>
      {props.children}
      {props.hint && <small>{props.hint}</small>}
    </label>
  );
}

export function Toggle(props: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label class="toggle">
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange((e.target as HTMLInputElement).checked)} />
      <span class="track" />
      {props.label && <span>{props.label}</span>}
    </label>
  );
}

export function PageHeader(props: { icon: IconName; title: string; description?: string; children?: ComponentChildren }) {
  return (
    <div class="page-header">
      <span class="page-icon">
        <Icon name={props.icon} size={22} />
      </span>
      <div class="grow">
        <h2>{props.title}</h2>
        {props.description && <p>{props.description}</p>}
      </div>
      {props.children && <div class="page-actions">{props.children}</div>}
    </div>
  );
}

export function Card(props: { title?: string; icon?: IconName; description?: string; children: ComponentChildren; class?: string; actions?: ComponentChildren }) {
  return (
    <section class={`card ${props.class ?? ''}`}>
      {props.title && (
        <header class="card-head">
          {props.icon && (
            <span class="card-icon">
              <Icon name={props.icon} size={18} />
            </span>
          )}
          <div class="grow">
            <h3>{props.title}</h3>
            {props.description && <p>{props.description}</p>}
          </div>
          {props.actions}
        </header>
      )}
      {props.children}
    </section>
  );
}

export function ImagePicker(props: { value: string | null; onChange: (path: string | null) => void }) {
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
      await errorAlert('Use una imagen JPG, PNG, WEBP o GIF.', 'Formato no permitido');
    } else if (file.size > 10 * 1024 * 1024) {
      await errorAlert('La imagen pesa más de 10 MB. Use una más liviana.', 'Imagen muy pesada');
    } else {
      setBusy(true);
      try {
        const res = await uploadImage(file);
        props.onChange(res.path);
      } catch (err) {
        await errorAlert((err as Error).message, 'No se pudo subir la imagen');
      } finally {
        setBusy(false);
      }
    }
    if (input.current) input.current.value = '';
  };
  return (
    <div class="image-picker">
      <div class="thumb" onClick={() => input.current?.click()}>
        {props.value ? (
          <img src={`/media/${props.value}`} alt="" />
        ) : (
          <span>
            <Icon name="image" size={26} />
            {busy ? 'Subiendo…' : 'Sin foto'}
          </span>
        )}
      </div>
      <div class="col">
        <button type="button" class="btn" disabled={busy} onClick={() => input.current?.click()}>
          <Icon name="upload" size={16} /> {props.value ? 'Cambiar foto' : 'Subir foto'}
        </button>
        {props.value && (
          <button type="button" class="btn ghost" onClick={() => props.onChange(null)}>
            <Icon name="trash" size={16} /> Quitar
          </button>
        )}
        <small>JPG, PNG o WEBP (máx. 10 MB). Se reduce a 800 px automáticamente. Las fotos sin fondo (PNG) lucen mejor.</small>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick((e.target as HTMLInputElement).files?.[0])} />
    </div>
  );
}

export function Empty(props: { children: ComponentChildren; icon?: IconName }) {
  return (
    <div class="empty">
      <span class="empty-icon">
        <Icon name={props.icon ?? 'box'} size={30} />
      </span>
      <div>{props.children}</div>
    </div>
  );
}

/**
 * Form validation: each rule is [invalid?, field key, label]. Marks the invalid fields and shows
 * one SweetAlert listing everything that is missing. Returns true when the form is valid.
 */
export function useValidation() {
  const [errors, setErrors] = useState<Set<string>>(new Set());
  const validate = async (rules: [boolean, string, string][], title?: string): Promise<boolean> => {
    const failed = rules.filter(([bad]) => bad);
    setErrors(new Set(failed.map(([, key]) => key)));
    if (failed.length === 0) return true;
    await missingFields(failed.map(([, , label]) => label), title);
    return false;
  };
  const has = (key: string) => errors.has(key);
  const clear = (key: string) =>
    setErrors((e) => {
      if (!e.has(key)) return e;
      const next = new Set(e);
      next.delete(key);
      return next;
    });
  return { validate, has, clear };
}

/** True when two plain objects differ (used to detect unsaved changes). */
export function changed(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) !== JSON.stringify(b);
}

export function timeAgo(iso: string | null): string {
  if (!iso) return 'nunca';
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.round(diff / 60_000);
  if (min < 1) return 'hace un momento';
  if (min < 60) return `hace ${min} min`;
  const h = Math.round(min / 60);
  if (h < 48) return `hace ${h} h`;
  return `hace ${Math.round(h / 24)} días`;
}

export function fmtDateTime(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'short', timeStyle: 'short' });
}

export function fmtDate(ymd: string): string {
  const [y, m, d] = ymd.split('-');
  return `${d}/${m}/${y}`;
}
