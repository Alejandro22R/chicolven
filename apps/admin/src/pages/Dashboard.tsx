import { useEffect, useState } from 'preact/hooks';
import type { Screen } from '@chicolven/shared/types';
import { centsToInput } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Card, fmtDate, fmtDateTime, timeAgo } from '../components/ui.tsx';

interface HistoryRow {
  id: number;
  product_name: string;
  old_usd_cents: number;
  new_usd_cents: number;
  changed_at: string;
}

export function Dashboard() {
  const { rate, screenStatus, revision, settings } = useApp();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [counts, setCounts] = useState({ products: 0, active: 0, offers: 0, soldOut: 0 });

  useEffect(() => {
    api<{ screens: Screen[] }>('/api/admin/screens').then((r) => setScreens(r.screens));
    api<HistoryRow[]>('/api/admin/price-history').then((h) => setHistory(h.slice(0, 8)));
    api<{ active: boolean; is_offer: boolean; sold_out: boolean }[]>('/api/admin/products').then((p) =>
      setCounts({
        products: p.length,
        active: p.filter((x) => x.active).length,
        offers: p.filter((x) => x.is_offer && x.active).length,
        soldOut: p.filter((x) => x.sold_out && x.active).length,
      }),
    );
  }, [revision]);

  const status = (id: number) => screenStatus.find((s) => s.screen_id === id);
  const online = screens.filter((s) => (status(s.id)?.connections ?? 0) > 0).length;

  return (
    <div class="dash-page">
      <div class="hero-banner">
        <div>
          <small>Bienvenido</small>
          <h2>{settings?.store_name ?? 'Chicolven C.A.'}</h2>
          <p>Cambie un precio y los televisores se actualizan solos en segundos.</p>
        </div>
        <a class="btn primary big" href="#/productos">
          <Icon name="edit" size={18} /> Cambiar precios
        </a>
      </div>

      <div class="kpis">
        <a class={`kpi ${rate ? (rate.stale ? 'warn' : 'blue') : 'danger'}`} href="#/tasa">
          <span class="kpi-icon">
            <Icon name="dollar" size={22} />
          </span>
          <div>
            <small>Tasa en uso</small>
            <b>{rate ? `Bs ${rate.display}` : 'Sin tasa'}</b>
            <span>{rate ? `${rate.is_manual ? 'Manual' : rate.source.toUpperCase()} · vigente ${fmtDate(rate.effective_date)}` : 'Solo se muestran USD'}</span>
          </div>
        </a>
        <a class="kpi red" href="#/productos">
          <span class="kpi-icon">
            <Icon name="box" size={22} />
          </span>
          <div>
            <small>Productos visibles</small>
            <b>{counts.active}</b>
            <span>de {counts.products} en total</span>
          </div>
        </a>
        <a class="kpi yellow" href="#/productos">
          <span class="kpi-icon">
            <Icon name="percent" size={22} />
          </span>
          <div>
            <small>En oferta</small>
            <b>{counts.offers}</b>
            <span>{counts.soldOut ? `${counts.soldOut} agotado${counts.soldOut === 1 ? '' : 's'}` : 'ninguno agotado'}</span>
          </div>
        </a>
        <a class="kpi green" href="#/pantallas">
          <span class="kpi-icon">
            <Icon name="tv" size={22} />
          </span>
          <div>
            <small>Televisores en línea</small>
            <b>
              {online}/{screens.length}
            </b>
            <span>{online === screens.length && screens.length ? 'todos conectados' : 'revise los desconectados'}</span>
          </div>
        </a>
      </div>

      <div class="dash">
        <Card title="Televisores" icon="tv" description="Estado de conexión de cada pantalla">
          {screens.length === 0 && <p class="muted">Aún no hay pantallas. Créelas en “Pantallas”.</p>}
          <ul class="screen-list">
            {screens.map((s) => {
              const st = status(s.id);
              const on = (st?.connections ?? 0) > 0;
              return (
                <li key={s.id}>
                  <span class={`dot ${on ? 'on' : 'off'}`} />
                  <b>{s.name}</b>
                  <span class="muted grow">{on ? 'conectado' : `desconectado · visto ${timeAgo(st?.last_seen ?? null)}`}</span>
                  <a class="btn small ghost" href={`/tv/${s.id}`} target="_blank" rel="noreferrer">
                    <Icon name="external" size={14} /> Ver
                  </a>
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Últimos cambios de precio" icon="clock" description="Historial reciente en USD">
          {history.length === 0 ? (
            <p class="muted">Sin cambios todavía.</p>
          ) : (
            <table class="table compact">
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.product_name}</td>
                    <td class="num">
                      <span class="muted">$ {centsToInput(h.old_usd_cents)}</span> →{' '}
                      <b class={h.new_usd_cents > h.old_usd_cents ? 'up' : 'down'}>$ {centsToInput(h.new_usd_cents)}</b>
                    </td>
                    <td class="muted nowrap" title={fmtDateTime(h.changed_at)}>
                      {timeAgo(h.changed_at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
