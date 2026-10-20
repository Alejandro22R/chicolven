import { useEffect, useState } from 'preact/hooks';
import type { ScreenStatus } from '@chicolven/shared/types';
import { api, setToken, withToken } from '../api.ts';
import { useApp } from '../state.ts';
import { Field, fmtDateTime } from '../components/ui.tsx';

interface SystemInfo {
  version: string;
  node: string;
  started_at: string;
  uptime_s: number;
  memory_mb: number;
  data_dir: string;
  default_pin: boolean;
  screens: ScreenStatus[];
  logs: { at: string; level: string; message: string }[];
}

interface Backup {
  name: string;
  size: number;
  created_at: string;
}

export function System() {
  const { toast, reloadShared } = useApp();
  const [info, setInfo] = useState<SystemInfo | null>(null);
  const [backups, setBackups] = useState<Backup[]>([]);
  const [pin, setPin] = useState({ current: '', next: '', repeat: '' });

  const load = () => {
    api<SystemInfo>('/api/admin/system').then(setInfo);
    api<Backup[]>('/api/admin/backups').then(setBackups);
  };
  useEffect(load, []);

  const backup = async () => {
    await api('/api/admin/backups', { method: 'POST' });
    toast('Respaldo creado');
    load();
  };

  const restore = async (name: string) => {
    if (!confirm(`¿Restaurar ${name}? Se aplicará al reiniciar el programa y reemplazará los datos actuales.`)) return;
    const res = await api<{ message: string }>(`/api/admin/backups/${name}/restore`, { method: 'POST' });
    alert(res.message);
    load();
  };

  const changePin = async (e: Event) => {
    e.preventDefault();
    if (pin.next !== pin.repeat) return toast('Los PIN nuevos no coinciden', 'error');
    try {
      const res = await api<{ token: string }>('/api/auth/pin', { body: { current: pin.current, next: pin.next } });
      setToken(res.token);
      setPin({ current: '', next: '', repeat: '' });
      toast('PIN actualizado');
      await reloadShared();
      load();
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  return (
    <div class="system">
      <div class="dash">
        <section class="card">
          <h2>Cambiar PIN</h2>
          <form class="form" onSubmit={changePin}>
            <Field label="PIN actual">
              <input type="password" inputMode="numeric" value={pin.current} onInput={(e) => setPin({ ...pin, current: (e.target as HTMLInputElement).value })} />
            </Field>
            <div class="row">
              <Field label="PIN nuevo (4 a 8 dígitos)">
                <input type="password" inputMode="numeric" value={pin.next} onInput={(e) => setPin({ ...pin, next: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Repetir">
                <input type="password" inputMode="numeric" value={pin.repeat} onInput={(e) => setPin({ ...pin, repeat: (e.target as HTMLInputElement).value })} />
              </Field>
            </div>
            <button class="btn primary">Cambiar PIN</button>
          </form>
        </section>

        <section class="card">
          <h2>Equipo</h2>
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
                <span>Carpeta de datos</span>
                <code>{info.data_dir}</code>
              </li>
            </ul>
          )}
        </section>
      </div>

      <section class="card">
        <div class="toolbar">
          <h2>Respaldos</h2>
          <span class="grow" />
          <button class="btn primary" onClick={backup}>
            Crear respaldo ahora
          </button>
        </div>
        <p class="hint">Se crea un respaldo automático cada noche y se guardan los últimos 14. Descargue uno a un pendrive de vez en cuando.</p>
        <table class="table">
          <tbody>
            {backups.map((b) => (
              <tr key={b.name}>
                <td>{b.name}</td>
                <td class="muted">{(b.size / 1024).toFixed(0)} KB</td>
                <td>
                  <a class="btn small" href={withToken(`/api/admin/backups/${b.name}`)}>
                    Descargar
                  </a>{' '}
                  <button class="btn small ghost" onClick={() => restore(b.name)}>
                    Restaurar
                  </button>
                </td>
              </tr>
            ))}
            {backups.length === 0 && (
              <tr>
                <td class="muted">Aún no hay respaldos.</td>
              </tr>
            )}
          </tbody>
        </table>
      </section>

      <section class="card">
        <h2>Registro de eventos</h2>
        <ul class="log">
          {info?.logs.map((l, i) => (
            <li key={i} class={l.level}>
              <time>{fmtDateTime(l.at)}</time> {l.message}
            </li>
          ))}
          {info && info.logs.length === 0 && <li class="muted">Sin eventos.</li>}
        </ul>
      </section>
    </div>
  );
}
