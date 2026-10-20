import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import { uploadImage } from '../api.ts';
import { useApp } from '../state.ts';

export function Modal(props: { title: string; onClose: () => void; children: ComponentChildren; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div class="modal-back" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class={`modal${props.wide ? ' wide' : ''}`} role="dialog" aria-label={props.title}>
        <header>
          <h2>{props.title}</h2>
          <button class="icon" onClick={props.onClose} aria-label="Cerrar">
            ✕
          </button>
        </header>
        {props.children}
      </div>
    </div>
  );
}

export function Field(props: { label: string; hint?: string; children: ComponentChildren }) {
  return (
    <label class="field">
      <span>{props.label}</span>
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
      <span>{props.label}</span>
    </label>
  );
}

export function ImagePicker(props: { value: string | null; onChange: (path: string | null) => void }) {
  const { toast } = useApp();
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const pick = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const res = await uploadImage(file);
      props.onChange(res.path);
    } catch (err) {
      toast((err as Error).message, 'error');
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };
  return (
    <div class="image-picker">
      <div class="thumb" onClick={() => input.current?.click()}>
        {props.value ? <img src={`/media/${props.value}`} alt="" /> : <span>{busy ? 'Subiendo…' : 'Sin foto'}</span>}
      </div>
      <div class="col">
        <button type="button" class="btn" disabled={busy} onClick={() => input.current?.click()}>
          {props.value ? 'Cambiar foto' : 'Subir foto'}
        </button>
        {props.value && (
          <button type="button" class="btn ghost" onClick={() => props.onChange(null)}>
            Quitar
          </button>
        )}
        <small>JPG, PNG o WEBP. Se reduce a 800 px automáticamente.</small>
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(e) => pick((e.target as HTMLInputElement).files?.[0])} />
    </div>
  );
}

export function Empty(props: { children: ComponentChildren }) {
  return <div class="empty">{props.children}</div>;
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
