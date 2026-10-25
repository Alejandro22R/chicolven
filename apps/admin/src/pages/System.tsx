import { useEffect, useState } from 'preact/hooks';
import type { ScreenStatus } from '@chicolven/shared/types';
import { api, setToken, withToken } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, notify, successAlert } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Card, Field, fmtDateTime, PageHeader, useValidation } from '../components/ui.tsx';

interface SystemInfo {
  version: string;
  node: string;
  started_at: string;
  uptime_s: number;
  memory_mb: number;
  data_dir: string;
  network: { port: number; local_name: string; ips: string[] };
  default_pin: boolean;
  screens: ScreenStatus[];
  logs: { at: string; level: string; message: string }[];
}

interface Backup {
  name: string;
  size: number;
  created_at: string;
}

const WEAK_PINS = ['1234', '0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '12345', '123456', '4321', '1212'];

export function System() {
  const { reloadShared } = useApp();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [pin, setPin] = useState({ current: '', next: '', repeat: '' });
  const [busy, setBusy] = useState(false);
  const v = useValidation();

  const load = () => {
    api<SystemInfo>('/api/admin/system').then(setInfo);
    api<Backup[]>('/api/admin/backups').then(setBackups);
  };
  useEffect(load, []);

  const backup = async () => {
    setBusy(true);
    try {
      const b = await api<Backup>('/api/admin/backups', { method: 'POST' });
      await successAlert('Respaldo creado', `Se guardó <b>${escapeHtml(b.name)}</b>. Descárguelo y guárdelo en un pendrive de vez en cuando.`);
      load();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo crear el respaldo');
    } finally {
      setBusy(false);
    }
  };

  const restore = async (b: Backup) => {
    const sure = await confirmAction({
      title: '¿Restaurar este respaldo?',
      html: `Se reemplazarán <b>todos</b> los productos, precios, pantallas y ajustes actuales por los de <b>${escapeHtml(b.name)}</b> (${fmtDateTime(
        b.created_at,
      )}).<br><br>Se aplicará la próxima vez que se inicie el programa. Los datos actuales se guardan como copia de seguridad.`,
      confirmText: 'Sí, restaurar',
      danger: true,
    });
    if (!sure) return;
    const res = await api<{ message: string }>(`/api/admin/backups/${b.name}/restore`, { method: 'POST' });
    await successAlert('Restauración programada', `${escapeHtml(res.message)}<br>Cierre el programa y vuelva a abrirlo (o reinicie el PC).`);
    load();
  };

  const changePin = async (e: Event) => {
    e.preventDefault();
    const ok = await v.validate([
      [!pin.current, 'current', 'PIN actual'],
      [!pin.next, 'next', 'PIN nuevo'],
      [Boolean(pin.next) && !/^\d{4,8}$/.test(pin.next), 'next', 'PIN nuevo de 4 a 8 números'],
      [!pin.repeat, 'repeat', 'Repetir el PIN nuevo'],
      [Boolean(pin.repeat) && pin.next !== pin.repeat, 'repeat', 'Los dos PIN nuevos deben coincidir'],
      [Boolean(pin.next) && pin.next === pin.current, 'next', 'Un PIN nuevo distinto del actual'],
    ]);
    if (!ok) return;
    if (WEAK_PINS.includes(pin.next)) {
      const sure = await confirmAction({
        title: 'PIN muy fácil de adivinar',
        text: 'Ese PIN es de los más usados. ¿Usarlo de todas formas?',
        confirmText: 'Usarlo igual',
        cancelText: 'Elegir otro',
        icon: 'warning',
      });
      if (!sure) return;
    }
    try {
      const res = await api<{ token: string }>('/api/auth/pin', { body: { current: pin.current, next: pin.next } });
      setToken(res.token);
      setPin({ current: '', next: '', repeat: '' });
      await successAlert('PIN actualizado', 'Las otras sesiones abiertas (otros celulares o PCs) tendrán que entrar con el PIN nuevo.');
      await reloadShared();
      load();
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo cambiar el PIN');
    }
  };

  const pinInput = (key: keyof typeof pin, label: string) => (
    <Field label={label} required invalid={v.has(key)}>
      <input
        type="password"
        inputMode="numeric"
        maxLength={8}
        value={pin[key]}
        onInput={(e) => {
          v.clear(key);
          setPin({ ...pin, [key]: (e.target as HTMLInputElement).value.replace(/\D/g, '') });
        }}
      />
    </Field>
  );

  return (
    <div class="system">
      <PageHeader icon="settings" title="Sistema" description="Seguridad, respaldos y estado del equipo." />
      <div class="dash">
        <Card title="Cambiar PIN" icon="shield" description="El PIN protege el panel: quien lo tenga puede cambiar precios.">
          <form class="form" onSubmit={changePin} noValidate>
            {pinInput('current', 'PIN actual')}
            <div class="row">
              {pinInput('next', 'PIN nuevo (4 a 8 números)')}
              {pinInput('repeat', 'Repetir PIN nuevo')}
            </div>
            <div>
              <button class="btn primary">
                <Icon name="shield" size={16} /> Cambiar PIN
              </button>
            </div>
          </form>
        </Card>

        <Card title="Equipo" icon="database">
          {info && (
            <ul class="kv">
              <li>
                <span>Versión</span>
                <b>{info.version}</b>
              </li>
              <li>
                <span>Encendido desde</span>
                <b>{fmtDateTime(info.started_at)}</b>
              </li>
              <li>
                <span>Memoria</span>
                <b>{info.memory_mb} MB</b>
              </li>
              <li>
                <span>Node.js</span>
                <b>{info.node}</b>
              </li>
              <li>
                <span>Nombre en la red</span>
                <code>
                  http://{info.network.local_name}
                  {info.network.port === 80 ? '' : `:${info.network.port}`}
                </code>
              </li>
              <li>
                <span>IP de este PC</span>
                <code>{info.network.ips.join(', ') || '—'}</code>
              </li>
              <li>
                <span>Carpeta de datos</span>
                <code>{info.data_dir}</code>
              </li>
            </ul>
          )}
        </Card>
      </div>

      <Card
        title="Respaldos"
        icon="database"
        description="Cada noche se crea un respaldo automático y se guardan los últimos 14."
        actions={
          <button class="btn primary" disabled={busy} onClick={backup}>
            <Icon name="plus" size={16} /> {busy ? 'Creando…' : 'Crear respaldo'}
          </button>
        }
      >
        <div class="table-wrap flat">
          <table class="table">
            <tbody>
              {backups.map((b) => (
                <tr key={b.name}>
                  <td>
                    <b>{fmtDateTime(b.created_at)}</b>
                    <small>{b.name}</small>
                  </td>
                  <td class="muted nowrap">{(b.size / 1024).toFixed(0)} KB</td>
                  <td class="nowrap right">
                    <a class="btn small" href={withToken(`/api/admin/backups/${b.name}`)} onClick={() => notify('Descargando respaldo…', 'info')}>
                      <Icon name="download" size={14} /> Descargar
                    </a>{' '}
                    <button class="btn small ghost" onClick={() => restore(b)}>
                      <Icon name="refresh" size={14} /> Restaurar
                    </button>
                  </td>
                </tr>
              ))}
              {backups.length === 0 && (
                <tr>
                  <td class="muted">Aún no hay respaldos. Cree el primero.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Registro de eventos" icon="clock">
        <ul class="log">
          {info?.logs.map((l, i) => (
            <li key={i} class={l.level}>
              <time>{fmtDateTime(l.at)}</time> {l.message}
            </li>
          ))}
          {info && info.logs.length === 0 && <li class="muted">Sin eventos.</li>}
        </ul>
      </Card>
    </div>
  );
}
