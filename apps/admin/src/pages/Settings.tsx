import { useEffect, useState } from 'preact/hooks';
import type { CustomRateSource, Settings } from '@chicolven/shared/types';
import { formatBs, usdCentsToBsCents } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { useApp } from '../state.ts';
import { Field, ImagePicker, Toggle } from '../components/ui.tsx';

const ROUNDING = [
  { step: 1, label: 'Al céntimo (0,01)' },
  { step: 10, label: 'A 0,10' },
  { step: 50, label: 'A 0,50' },
  { step: 100, label: 'A 1 Bs' },
  { step: 500, label: 'A 5 Bs' },
  { step: 1000, label: 'A 10 Bs' },
];

export function SettingsPage() {
  const { settings, rate, reloadShared, toast } = useApp();
  const [s, setS] = useState<Settings | null>(settings);
  useEffect(() => setS(settings), [settings]);
  if (!s) return <p class="muted">Cargando…</p>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((x) => (x ? { ...x, [k]: v } : x));
  const save = async (e: Event) => {
    e.preventDefault();
    try {
      await api('/api/admin/settings', { method: 'PUT', body: s });
      await reloadShared();
      toast('Ajustes guardados');
    } catch (err) {
      toast((err as Error).message, 'error');
    }
  };

  const example = rate
    ? formatBs(usdCentsToBsCents(1290, rate.effective_rate_e4, { stepCents: s.rounding_step_cents, mode: s.rounding_mode }))
    : '—';

  const setSource = (i: number, patch: Partial<CustomRateSource>) =>
    set(
      'rate_custom_sources',
      s.rate_custom_sources.map((x, j) => (i === j ? { ...x, ...patch } : x)),
    );
  const toggleProvider = (id: string, on: boolean) =>
    set('rate_providers', on ? [...s.rate_providers.filter((p) => p !== id), id] : s.rate_providers.filter((p) => p !== id));

  return (
    <form class="settings" onSubmit={save}>
      <section class="card">
        <h2>Tienda</h2>
        <div class="row">
          <Field label="Nombre">
            <input value={s.store_name} onInput={(e) => set('store_name', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="RIF">
            <input value={s.store_rif} onInput={(e) => set('store_rif', (e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Field label="Logo (opcional, reemplaza al logo incluido)">
          <ImagePicker value={s.logo_path} onChange={(v) => set('logo_path', v)} />
        </Field>
      </section>

      <section class="card">
        <h2>Precios en pantalla</h2>
        <div class="row toggles">
          <Toggle label="Mostrar USD" checked={s.show_usd} onChange={(v) => set('show_usd', v)} />
          <Toggle label="Mostrar Bs" checked={s.show_bs} onChange={(v) => set('show_bs', v)} />
        </div>
        <div class="row">
          <Field label="Moneda principal (grande)">
            <select value={s.primary_currency} onChange={(e) => set('primary_currency', (e.target as HTMLSelectElement).value as Settings['primary_currency'])}>
              <option value="usd">USD arriba, Bs debajo</option>
              <option value="bs">Bs arriba, USD debajo</option>
            </select>
          </Field>
          <Field label="Redondeo de Bs" hint={`Ejemplo: $ 12,90 → ${example}`}>
            <select value={s.rounding_step_cents} onChange={(e) => set('rounding_step_cents', Number((e.target as HTMLSelectElement).value))}>
              {ROUNDING.map((r) => (
                <option key={r.step} value={r.step}>
                  {r.label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Sentido del redondeo">
            <select value={s.rounding_mode} onChange={(e) => set('rounding_mode', (e.target as HTMLSelectElement).value as Settings['rounding_mode'])}>
              <option value="nearest">Al más cercano</option>
              <option value="up">Siempre hacia arriba</option>
              <option value="down">Siempre hacia abajo</option>
            </select>
          </Field>
        </div>
        <Field label="Mensaje de la marquesina (parte inferior)">
          <textarea rows={2} maxLength={500} value={s.ticker_message} onInput={(e) => set('ticker_message', (e.target as HTMLTextAreaElement).value)} />
        </Field>
        <Toggle label="Modo bajo consumo en todos los TVs (sin sombras ni animaciones decorativas)" checked={s.low_power} onChange={(v) => set('low_power', v)} />
      </section>

      <section class="card">
        <h2>Tasa de cambio</h2>
        <div class="row">
          <Field label="Origen de la tasa">
            <select value={s.rate_source_mode} onChange={(e) => set('rate_source_mode', (e.target as HTMLSelectElement).value as Settings['rate_source_mode'])}>
              <option value="auto">Automática (con respaldo manual)</option>
              <option value="manual">Solo manual</option>
            </select>
          </Field>
          <Field label="¿Qué tasa usar?" hint="El BCV publica hacia las 4 p. m. la tasa del día hábil siguiente.">
            <select value={s.rate_mode} onChange={(e) => set('rate_mode', (e.target as HTMLSelectElement).value as Settings['rate_mode'])}>
              <option value="today">Tasa vigente hoy (recomendado)</option>
              <option value="latest">Tasa publicada más reciente</option>
            </select>
          </Field>
        </div>
        <div class="row toggles">
          <Toggle label="Página del BCV" checked={s.rate_providers.includes('bcv')} onChange={(v) => toggleProvider('bcv', v)} />
          <Toggle label="DolarApi (comunitaria)" checked={s.rate_providers.includes('dolarapi')} onChange={(v) => toggleProvider('dolarapi', v)} />
          <Toggle label="Aceptar certificado inválido del BCV" checked={s.bcv_insecure_tls} onChange={(v) => set('bcv_insecure_tls', v)} />
        </div>
        <div class="row">
          <Field label="Consultar cada (min)">
            <input type="number" min={5} max={720} value={s.rate_fetch_minutes} onInput={(e) => set('rate_fetch_minutes', Number((e.target as HTMLInputElement).value))} />
          </Field>
          <Field label="Horario: desde (h)">
            <input type="number" min={0} max={23} value={s.store_open_hour} onInput={(e) => set('store_open_hour', Number((e.target as HTMLInputElement).value))} />
          </Field>
          <Field label="hasta (h)">
            <input type="number" min={1} max={24} value={s.store_close_hour} onInput={(e) => set('store_close_hour', Number((e.target as HTMLInputElement).value))} />
          </Field>
        </div>
        <div class="row">
          <Field label="Variación máxima sin confirmar (%)" hint="Protege contra lecturas erróneas de la página.">
            <input type="number" min={1} max={100} value={s.rate_max_jump_pct} onInput={(e) => set('rate_max_jump_pct', Number((e.target as HTMLInputElement).value))} />
          </Field>
          <Field label="Ajuste sobre la tasa (%)" hint="0 = tasa BCV exacta. Ej.: 2 para +2 %.">
            <input
              type="number"
              step="0.01"
              min={-50}
              max={50}
              value={s.rate_adjust_bp / 100}
              onInput={(e) => set('rate_adjust_bp', Math.round(Number((e.target as HTMLInputElement).value) * 100))}
            />
          </Field>
          <Field label="Avisar si la tasa tiene más de (h)">
            <input type="number" min={1} max={240} value={s.rate_stale_hours} onInput={(e) => set('rate_stale_hours', Number((e.target as HTMLInputElement).value))} />
          </Field>
        </div>
        <details>
          <summary>Fuentes JSON adicionales (avanzado)</summary>
          <p class="hint">Cualquier URL que devuelva JSON con la tasa. "Ruta" es la ubicación del número, p. ej. <code>promedio</code> o <code>data.usd</code>.</p>
          {s.rate_custom_sources.map((src, i) => (
            <div class="row" key={i}>
              <Field label="Nombre">
                <input value={src.name} onInput={(e) => setSource(i, { name: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="URL">
                <input value={src.url} onInput={(e) => setSource(i, { url: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Ruta de la tasa">
                <input value={src.rate_path} onInput={(e) => setSource(i, { rate_path: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Ruta de la fecha">
                <input value={src.date_path ?? ''} onInput={(e) => setSource(i, { date_path: (e.target as HTMLInputElement).value || undefined })} />
              </Field>
              <button type="button" class="icon" onClick={() => set('rate_custom_sources', s.rate_custom_sources.filter((_, j) => j !== i))}>
                ✕
              </button>
            </div>
          ))}
          <button
            type="button"
            class="btn small"
            onClick={() => set('rate_custom_sources', [...s.rate_custom_sources, { name: 'fuente', url: 'https://', rate_path: 'promedio' }])}
          >
            + Agregar fuente
          </button>
        </details>
      </section>

      <div class="sticky-save">
        <button class="btn primary big">Guardar ajustes</button>
      </div>
    </form>
  );
}
