import { useEffect, useState } from 'preact/hooks';
import type { ExchangeRate, RateInfo } from '@chicolven/shared/types';
import { formatRate, parseRateToE4 } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Field, fmtDate, fmtDateTime, timeAgo } from '../components/ui.tsx';

interface ProviderStatus {
  id: string;
  label: string;
  last_attempt: string | null;
  last_success: string | null;
  last_error: string | null;
}

interface RatesResponse {
  current: RateInfo | null;
  pending: ExchangeRate[];
  history: ExchangeRate[];
  providers: ProviderStatus[];
}

const sourceName = (s: string) => (s === 'bcv' ? 'BCV' : s === 'dolarapi' ? 'DolarApi' : s === 'manual' ? 'Manual' : s.replace(/^custom:/, ''));

export function Rates() {
  const { toast, reloadShared, settings, revision } = useApp();
  const [data, setData] = useState<RatesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [manualDate, setManualDate] = useState('');

  const load = () => api<RatesResponse>('/api/admin/rates').then(setData);
  useEffect(() => {
    load();
  }, [revision]);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; pending?: boolean; errors: { provider: string; error: string }[] }>('/api/admin/rates/refresh', {
        method: 'POST',
      });
      if (res.ok && res.pending) toast('Se obtuvo una tasa con una variación grande: confírmela abajo', 'error');
      else if (res.ok) toast('Tasa actualizada');
      else toast(`No se pudo consultar: ${res.errors.map((e) => `${sourceName(e.provider)}: ${e.error}`).join(' · ')}`, 'error');
      await Promise.all([load(), reloadShared()]);
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async (e: Event) => {
    e.preventDefault();
    const e4 = parseRateToE4(manual);
    if (e4 === null || e4 <= 0) return toast('Escriba una tasa válida, por ejemplo 36,5012', 'error');
    if (data?.current) {
      const diff = Math.abs(e4 - data.current.rate_e4) / data.current.rate_e4;
      if (diff > 0.15 && !confirm(`La tasa ${formatRate(e4, 4)} difiere ${(diff * 100).toFixed(1)} % de la actual. ¿Continuar?`)) return;
    }
    try {
      await api('/api/admin/rates/manual', { body: { rate: manual, effective_date: manualDate || null } });
      toast('Tasa manual guardada; los TVs ya la usan');
      setManual('');
      await Promise.all([load(), reloadShared()]);
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const decide = async (id: number, action: 'confirm' | 'reject') => {
    await api(`/api/admin/rates/${id}/${action}`, { method: 'POST' });
    toast(action === 'confirm' ? 'Tasa confirmada' : 'Tasa rechazada');
    await Promise.all([load(), reloadShared()]);
  };

  if (!data) return <p class="muted">Cargando…</p>;
  const cur = data.current;

  return (
    <div class="rates">
      {data.pending.length > 0 && (
        <section class="card warn-card">
          <h2>Tasa pendiente de confirmación</h2>
          <p>Estas tasas cambian más del {settings?.rate_max_jump_pct ?? 15} % respecto a la anterior. Verifique en bcv.org.ve antes de aceptarlas.</p>
          {data.pending.map((r) => (
            <div key={r.id} class="pending-row">
              <b>Bs {formatRate(r.rate_e4, 4)}</b>
              <span>
                {sourceName(r.source)} · vigente {fmtDate(r.effective_date)} · {r.note}
              </span>
              <span class="grow" />
              <button class="btn primary small" onClick={() => decide(r.id, 'confirm')}>
                Confirmar
              </button>
              <button class="btn danger small" onClick={() => decide(r.id, 'reject')}>
                Rechazar
              </button>
            </div>
          ))}
        </section>
      )}

      <div class="dash">
        <section class="card rate-card">
          <h2>Tasa en uso</h2>
          {cur ? (
            <>
              <div class="big">Bs {formatRate(cur.rate_e4, 4)}</div>
              {cur.effective_rate_e4 !== cur.rate_e4 && (
                <p>
                  Con ajuste de {(settings?.rate_adjust_bp ?? 0) / 100} %: <b>Bs {formatRate(cur.effective_rate_e4, 4)}</b>
                </p>
              )}
              <p>
                Fuente <b>{sourceName(cur.source)}</b> · vigente desde {fmtDate(cur.effective_date)}
              </p>
              <p class={cur.stale ? 'danger' : 'muted'}>
                {cur.stale ? '⚠ ' : ''}Actualizada {timeAgo(cur.fetched_at)} · {fmtDateTime(cur.fetched_at)}
              </p>
            </>
          ) : (
            <p class="danger">Sin tasa. Consulte en línea o escriba una tasa manual.</p>
          )}
          <button class="btn primary" disabled={busy || settings?.rate_source_mode === 'manual'} onClick={refresh}>
            {busy ? 'Consultando…' : 'Consultar ahora'}
          </button>
          {settings?.rate_source_mode === 'manual' && <p class="hint">Modo solo manual activo (cámbielo en Apariencia y precios).</p>}
        </section>

        <section class="card">
          <h2>Tasa manual</h2>
          <p class="hint">Úsela si no hay internet o si la consulta automática falla. Para la fecha indicada tiene prioridad sobre la automática.</p>
          <form class="form" onSubmit={saveManual}>
            <div class="row">
              <Field label="Bs por USD">
                <input inputMode="decimal" placeholder="36,5012" value={manual} onInput={(e) => setManual((e.target as HTMLInputElement).value)} />
              </Field>
              <Field label="Vigente desde" hint="Vacío = hoy">
                <input type="date" value={manualDate} onInput={(e) => setManualDate((e.target as HTMLInputElement).value)} />
              </Field>
            </div>
            <button class="btn">Guardar tasa manual</button>
          </form>
        </section>
      </div>

      <section class="card">
        <h2>Fuentes automáticas</h2>
        <table class="table">
          <thead>
            <tr>
              <th>Fuente</th>
              <th>Último intento</th>
              <th>Último éxito</th>
              <th>Error</th>
            </tr>
          </thead>
          <tbody>
            {data.providers.map((p) => (
              <tr key={p.id}>
                <td>{p.label}</td>
                <td>{timeAgo(p.last_attempt)}</td>
                <td>{timeAgo(p.last_success)}</td>
                <td class={p.last_error ? 'danger' : 'muted'}>{p.last_error ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p class="hint">
          El BCV no tiene una API oficial: se lee su página web y, si falla, una API comunitaria. Se consulta cada {settings?.rate_fetch_minutes ?? 30} min en horario de
          tienda. El BCV publica la tasa del día siguiente hacia las 4:00 p. m.
        </p>
      </section>

      <section class="card">
        <h2>Historial</h2>
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Tasa</th>
                <th>Vigente</th>
                <th>Fuente</th>
                <th>Registrada</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.history.map((r) => (
                <tr key={r.id}>
                  <td class="num">
                    <b>{formatRate(r.rate_e4, 4)}</b>
                  </td>
                  <td>{fmtDate(r.effective_date)}</td>
                  <td>{sourceName(r.source)}</td>
                  <td>{fmtDateTime(r.fetched_at)}</td>
                  <td>
                    <span class={`chip ${r.status}`}>{r.status === 'ok' ? 'aceptada' : r.status === 'pending' ? 'pendiente' : 'rechazada'}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
