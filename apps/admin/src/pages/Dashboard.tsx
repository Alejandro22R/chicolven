import { useEffect, useState } from 'preact/hooks';
import type { Screen } from '@chicolven/shared/types';
import { centsToInput } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { fmtDate, fmtDateTime, timeAgo } from '../components/ui.tsx';

interface HistoryRow {
  id: number;
  product_name: string;
  old_usd_cents: number;
  new_usd_cents: number;
  changed_at: string;
}

export function Dashboard() {
  const { rate, screenStatus, revision } = useApp();
  const [screens, setScreens] = useState<Screen[]>([]);
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [counts, setCounts] = useState({ products: 0, active: 0, offers: 0 });

  useEffect(() => {
    api<{ screens: Screen[] }>('/api/admin/screens').then((r) => setScreens(r.screens));
    api<HistoryRow[]>('/api/admin/price-history').then((h) => setHistory(h.slice(0, 8)));
    api<{ active: boolean; is_offer: boolean }[]>('/api/admin/products').then((p) =>
      setCounts({ products: p.length, active: p.filter((x) => x.active).length, offers: p.filter((x) => x.is_offer && x.active).length }),
    );
  }, [revision]);

  const status = (id: number) => screenStatus.find((s) => s.screen_id === id);

  return (
    <div class="dash">
      <section class="card rate-card">
        <h2>Tasa del día</h2>
        {rate ? (
          <>
            <div class="big">Bs {rate.display}</div>
            <p>
              Fuente: <b>{rate.is_manual ? 'Manual' : rate.source.toUpperCase()}</b> · Vigente {fmtDate(rate.effective_date)}
            </p>
            <p class={rate.stale ? 'danger' : 'muted'}>Actualizada {timeAgo(rate.fetched_at)} ({fmtDateTime(rate.fetched_at)})</p>
          </>
        ) : (
          <p class="danger">No hay tasa registrada. Los TVs muestran solo precios en USD.</p>
        )}
        <a class="btn" href="#/tasa">
          Gestionar tasa
        </a>
      </section>

      <section class="card">
        <h2>Productos</h2>
        <div class="stats">
          <div>
            <b>{counts.active}</b>
            <span>activos</span>
          </div>
          <div>
            <b>{counts.offers}</b>
            <span>en oferta</span>
          </div>
          <div>
            <b>{counts.products}</b>
            <span>en total</span>
          </div>
        </div>
        <a class="btn primary" href="#/productos">
          Cambiar precios
        </a>
      </section>

      <section class="card span2">
        <h2>Televisores</h2>
        {screens.length === 0 && <p class="muted">Aún no hay pantallas. Créelas en “Pantallas”.</p>}
        <ul class="screen-list">
          {screens.map((s) => {
            const st = status(s.id);
            const on = (st?.connections ?? 0) > 0;
            return (
              <li key={s.id}>
                <span class={`dot ${on ? 'on' : 'off'}`} />
                <b>{s.name}</b>
                <span class="muted">{on ? `conectado (${st!.connections})` : `desconectado · visto ${timeAgo(st?.last_seen ?? null)}`}</span>
                <a href={`/tv/${s.id}`} target="_blank" rel="noreferrer">
                  Ver
                </a>
              </li>
            );
          })}
        </ul>
      </section>

      <section class="card span2">
        <h2>Últimos cambios de precio</h2>
        {history.length === 0 ? (
          <p class="muted">Sin cambios todavía.</p>
        ) : (
          <table class="table">
            <tbody>
              {history.map((h) => (
                <tr key={h.id}>
                  <td>{h.product_name}</td>
                  <td class="num">
                    $ {centsToInput(h.old_usd_cents)} → <b>$ {centsToInput(h.new_usd_cents)}</b>
                  </td>
                  <td class="muted">{timeAgo(h.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
