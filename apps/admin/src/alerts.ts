/** SweetAlert2 dialogs with the brand look. Every confirmation / warning in the panel goes through here. */
import Swal from 'sweetalert2';
import 'sweetalert2/dist/sweetalert2.min.css';

const base = Swal.mixin({
  buttonsStyling: false,
  reverseButtons: true,
  customClass: {
    popup: 'swal-popup',
    title: 'swal-title',
    htmlContainer: 'swal-text',
    confirmButton: 'btn primary big',
    cancelButton: 'btn ghost big',
    denyButton: 'btn danger big',
    actions: 'swal-actions',
  },
});

const toastMixin = Swal.mixin({
  toast: true,
  position: 'top-end',
  showConfirmButton: false,
  timer: 2600,
  timerProgressBar: true,
  customClass: { popup: 'swal-toast' },
  didOpen: (el) => {
    el.addEventListener('mouseenter', Swal.stopTimer);
    el.addEventListener('mouseleave', Swal.resumeTimer);
  },
});

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Small corner notification. */
export function notify(message: string, kind: 'ok' | 'error' | 'warning' | 'info' = 'ok'): void {
  void toastMixin.fire({ icon: kind === 'ok' ? 'success' : kind, title: message, timer: kind === 'error' ? 5000 : 2600 });
}

/** Required fields missing: lists them so the person knows exactly what to fill. */
export async function missingFields(fields: string[], title = 'Faltan campos por llenar', intro = 'Complete lo siguiente antes de guardar:'): Promise<void> {
  await base.fire({
    icon: 'warning',
    title,
    html: `<p>${escapeHtml(intro)}</p><ul class="swal-list">${fields.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`,
    confirmButtonText: 'Entendido',
  });
}

export async function errorAlert(message: string, title = 'No se pudo completar', html?: string): Promise<void> {
  await base.fire({ icon: 'error', title, text: html ? undefined : message, html, confirmButtonText: 'Cerrar' });
}

export async function infoAlert(title: string, html: string, confirmText = 'Entendido'): Promise<void> {
  await base.fire({ icon: 'info', title, html, confirmButtonText: confirmText });
}

export async function successAlert(title: string, html = ''): Promise<void> {
  await base.fire({ icon: 'success', title, html, confirmButtonText: 'Listo', timer: 4000, timerProgressBar: true });
}

/** Yes/no question. `danger` paints the confirm button red and uses a warning icon. */
export async function confirmAction(opts: {
  title: string;
  text?: string;
  html?: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  icon?: 'warning' | 'question' | 'info';
  /** Focus "Cancel" so a stray Enter (e.g. the one that triggered this dialog) does not confirm. */
  focusCancel?: boolean;
}): Promise<boolean> {
  const result = await base.fire({
    icon: opts.icon ?? (opts.danger ? 'warning' : 'question'),
    title: opts.title,
    text: opts.text,
    html: opts.html,
    showCancelButton: true,
    confirmButtonText: opts.confirmText ?? 'Sí, continuar',
    cancelButtonText: opts.cancelText ?? 'Cancelar',
    focusCancel: Boolean(opts.danger || opts.focusCancel),
    customClass: {
      popup: 'swal-popup',
      title: 'swal-title',
      htmlContainer: 'swal-text',
      confirmButton: opts.danger ? 'btn danger-solid big' : 'btn primary big',
      cancelButton: 'btn ghost big',
      actions: 'swal-actions',
    },
  });
  return result.isConfirmed;
}

/** Leaving a form with unsaved changes. */
export function confirmDiscard(): Promise<boolean> {
  return confirmAction({
    title: '¿Descartar los cambios?',
    text: 'Hay cambios sin guardar en este formulario.',
    confirmText: 'Descartar',
    cancelText: 'Seguir editando',
    danger: true,
  });
}

export { escapeHtml };
