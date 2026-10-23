import { useEffect, useState } from 'preact/hooks';
import type { ExchangeRate, RateInfo } from '@chicolven/shared/types';
import { formatRate, parseRateToE4 } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { confirmAction, errorAlert, escapeHtml, infoAlert, notify, successAlert } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Card, Field, fmtDate, fmtDateTime, PageHeader, timeAgo, useValidation } from '../components/ui.tsx';

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
  daily: { enabled: boolean; time: string; last_done: string | null; next: string };
}

const sourceName = (s: string) => (s === 'bcv' ? 'BCV' : s === 'dolarapi' ? 'DolarApi' : s === 'manual' ? 'Manual' : s.replace(/^custom:/, ''));

const to12h = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'a. m.' : 'p. m.'}`;
};

export function Rates() {
  const { reloadShared, settings, revision } = useApp();
  const [data, setData] = useState<RatesResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState('');
  const [manualDate, setManualDate] = useState('');
  const v = useValidation();

  const load = () => api<RatesResponse>('/api/admin/rates').then(setData);
  useEffect(() => {
    load();
  }, [revision]);

  const refresh = async () => {
    setBusy(true);
    try {
      const res = await api<{ ok: boolean; pending?: boolean; rate?: ExchangeRate; errors: { provider: string; error: string }[] }>(
        '/api/admin/rates/refresh',
        { method: 'POST' },
      );
      if (res.ok && res.pending) {
        await infoAlert('Tasa pendiente de confirmación', 'La tasa obtenida varía mucho respecto a la anterior. Verifíquela en bcv.org.ve y confírmela o recházela arriba.');
      } else if (res.ok && res.rate) {
        notify(`Tasa actualizada: Bs ${formatRate(res.rate.rate_e4, 4)}`);
      } else {
        await errorAlert(
          '',
          'No se pudo consultar la tasa',
          `<ul class="swal-list">${res.errors.map((e) => `<li><b>${escapeHtml(sourceName(e.provider))}:</b> ${escapeHtml(e.error)}</li>`).join('')}</ul>
           <p>Los televisores siguen usando la última tasa guardada. Si no hay internet, escriba la tasa manual.</p>`,
        );
      }
      await Promise.all([load(), reloadShared()]);
    } finally {
      setBusy(false);
    }
  };

  const saveManual = async (e: Event) => {
    e.preventDefault();
    const e4 = parseRateToE4(manual);
    const ok = await v.validate([
      [!manual.trim(), 'manual', 'Tasa en Bs por USD'],
      [Boolean(manual.trim()) && (e4 === null || e4 <= 0), 'manual', 'Tasa válida (ej. 36,5012)'],
    ]);
    if (!ok || e4 === null) return;
    const cur = data?.current;
    let html = `Los precios en Bs se recalcularán con <b>Bs ${formatRate(e4, 4)}</b> por dólar${manualDate ? ` desde el <b>${fmtDate(manualDate)}</b>` : ' desde hoy'}.`;
    let danger = false;
    if (cur) {
      const diff = Math.abs(e4 - cur.rate_e4) / cur.rate_e4;
      if (diff > 0.15) {
        danger = true;
        html += `<br><br><b>Atención:</b> difiere un <b>${(diff * 100).toFixed(1)} %</b> de la tasa actual (Bs ${formatRate(cur.rate_e4, 4)}). Revise que no haya un error de tipeo.`;
      }
    }
    if (!(await confirmAction({ title: '¿Guardar tasa manual?', html, confirmText: 'Guardar tasa', danger, icon: danger ? 'warning' : 'question' }))) return;
    try {
      await api('/api/admin/rates/manual', { body: { rate: manual, effective_date: manualDate || null } });
      await successAlert('Tasa guardada', 'Los televisores ya muestran los precios con la nueva tasa.');
      setManual('');
      setManualDate('');
      await Promise.all([load(), reloadShared()]);
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    }
  };

  const decide = async (r: ExchangeRate, action: 'confirm' | 'reject') => {
    const sure = await confirmAction(
      action === 'confirm'
        ? {
            title: '¿Confirmar la tasa?',
            html: `Se usará <b>Bs ${formatRate(r.rate_e4, 4)}</b> (${escapeHtml(sourceName(r.source))}) para todos los precios. Verifíquela en bcv.org.ve antes.`,
            confirmText: 'Confirmar',
          }
        : { title: '¿Rechazar la tasa?', html: `Se descartará <b>Bs ${formatRate(r.rate_e4, 4)}</b>.`, confirmText: 'Rechazar', danger: true },
    );
    if (!sure) return;
    await api(`/api/admin/rates/${r.id}/${action}`, { method: 'POST' });
    notify(action === 'confirm' ? 'Tasa confirmada' : 'Tasa rechazada');
    await Promise.all([load(), reloadShared()]);
  };

  if (!data) return <p class="muted">Cargando…</p>;
  const cur = data.current;
  const manualOnly = settings?.rate_source_mode === 'manual';

  return (
    <div class="rates">
      <PageHeader icon="dollar" title="Tasa BCV" description="La tasa del día convierte los precios en USD a bolívares en todos los televisores.">
        <button class="btn primary" disabled={busy || manualOnly} onClick={refresh}>
          <Icon name="refresh" size={16} /> {busy ? 'Consultando…' : 'Consultar ahora'}
        </button>
      </PageHeader>

      {data.pending.length > 0 && (
        <Card class="warn-card" title="Tasa pendiente de confirmación" icon="alert" description={`Varía más del ${settings?.rate_max_jump_pct ?? 15} % respecto a la anterior. Verifique en bcv.org.ve.`}>
          {data.pending.map((r) => (
            <div key={r.id} class="pending-row">
              <b>Bs {formatRate(r.rate_e4, 4)}</b>
              <span class="grow">
                {sourceName(r.source)} · vigente {fmtDate(r.effective_date)} · {r.note}
              </span>
              <button class="btn primary small" onClick={() => decide(r, 'confirm')}>
                <Icon name="check" size={14} /> Confirmar
              </button>
              <button class="btn danger small" onClick={() => decide(r, 'reject')}>
                <Icon name="close" size={14} /> Rechazar
              </button>
            </div>
          ))}
        </Card>
      )}

      <div class="dash">
        <Card title="Tasa en uso" icon="dollar" class="rate-card">
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
                {cur.stale && <Icon name="alert" size={14} />} Actualizada {timeAgo(cur.fetched_at)} · {fmtDateTime(cur.fetched_at)}
              </p>
            </>
          ) : (
            <p class="danger">Sin tasa. Consulte en línea o escriba una tasa manual.</p>
          )}
          {manualOnly && <p class="hint">Modo “solo manual” activo (cámbielo en Apariencia y precios).</p>}
        </Card>

        <Card title="Consulta automática" icon="clock" description="El BCV publica hacia las 4 p. m. la tasa del día hábil siguiente.">
          <ul class="kv">
            <li>
              <span>Consulta diaria</span>
              <b>{data.daily.enabled && !manualOnly ? `todos los días a las ${to12h(data.daily.time)}` : 'desactivada'}</b>
            </li>
            <li>
              <span>Próxima</span>
              <b>{data.daily.enabled && !manualOnly ? `${data.daily.next} a las ${to12h(data.daily.time)}` : '—'}</b>
            </li>
            <li>
              <span>Última consulta diaria</span>
              <b>{data.daily.last_done ? fmtDate(data.daily.last_done) : 'aún no'}</b>
            </li>
            <li>
              <span>Revisiones extra</span>
              <b>{settings?.rate_poll_enabled ? `cada ${settings.rate_fetch_minutes} min en horario de tienda` : 'desactivadas'}</b>
            </li>
          </ul>
          <a class="btn small" href="#/apariencia">
            <Icon name="settings" size={14} /> Cambiar horario
          </a>
        </Card>
      </div>

      <Card title="Tasa manual" icon="edit" description="Úsela si no hay internet o si la consulta falla. Para la fecha indicada tiene prioridad sobre la automática.">
        <form class="form" onSubmit={saveManual} noValidate>
          <div class="row">
            <Field label="Bs por USD" required invalid={v.has('manual')}>
              <input
                inputMode="decimal"
                placeholder="36,5012"
                value={manual}
                onInput={(e) => {
                  v.clear('manual');
                  setManual((e.target as HTMLInputElement).value);
                }}
              />
            </Field>
            <Field label="Vigente desde" hint="Vacío = hoy">
              <input type="date" value={manualDate} onInput={(e) => setManualDate((e.target as HTMLInputElement).value)} />
            </Field>
            <div class="field fit-btn">
              <button class="btn primary">
                <Icon name="check" size={16} /> Guardar tasa manual
              </button>
            </div>
          </div>
        </form>
      </Card>

      <Card title="Fuentes automáticas" icon="wifi">
        <div class="table-wrap flat">
          <table class="table">
            <thead>
              <tr>
                <th>Fuente</th>
                <th>Último intento</th>
                <th>Último éxito</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {data.providers.map((p) => (
                <tr key={p.id}>
                  <td>{p.label}</td>
                  <td>{timeAgo(p.last_attempt)}</td>
                  <td>{timeAgo(p.last_success)}</td>
                  <td class={p.last_error ? 'danger' : 'muted'}>{p.last_error ?? (p.last_success ? 'OK' : '—')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card title="Historial" icon="clock">
        <div class="table-wrap flat">
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
      </Card>
    </div>
  );
}
