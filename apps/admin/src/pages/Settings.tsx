import { useEffect, useState } from 'preact/hooks';
import type { CustomRateSource, FooterRateStyle, Settings } from '@chicolven/shared/types';
import { formatBs, usdCentsToBsCents } from '@chicolven/shared/money';
import { api } from '../api.ts';
import { confirmAction, confirmDiscard, errorAlert, notify } from '../alerts.ts';
import { useApp } from '../state.ts';
import { Icon } from '../components/icons.tsx';
import { Card, changed, Field, ImagePicker, PageHeader, Toggle, useValidation } from '../components/ui.tsx';

const ROUNDING = [
  { step: 1, label: 'Al céntimo (0,01)' },
  { step: 10, label: 'A 0,10' },
  { step: 50, label: 'A 0,50' },
  { step: 100, label: 'A 1 Bs' },
  { step: 500, label: 'A 5 Bs' },
  { step: 1000, label: 'A 10 Bs' },
];

const CARD_PRESETS = [
  { name: 'Blanca', bg: '#FFFFFF', text: '#0A0A0A' },
  { name: 'Negra', bg: '#0A0A0A', text: '#FFFFFF' },
  { name: 'Roja', bg: '#7A0C10', text: '#FFFFFF' },
  { name: 'Crema', bg: '#FFF6E0', text: '#0A0A0A' },
];

const FOOTER_STYLES: { id: FooterRateStyle; name: string }[] = [
  { id: 'red', name: 'Rojo' },
  { id: 'black', name: 'Negro' },
  { id: 'white', name: 'Blanco' },
];

/** Relative luminance contrast (WCAG) between two hex colors. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0]! + 0.7152 * c[1]! + 0.0722 * c[2]!;
  };
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (l1 + 0.05) / (l2 + 0.05);
}

const isUrl = (u: string) => /^https?:\/\/[^\s/]+\.[^\s]+/.test(u);

export function SettingsPage() {
  const { settings, rate, reloadShared, setLeaveGuard } = useApp();
  const [s, setS] = useState<Settings | null>(settings);
  const [busy, setBusy] = useState(false);
  const v = useValidation();
  useEffect(() => setS(settings), [settings]);
  const dirty = Boolean(s && settings && changed(s, settings));
  useEffect(() => {
    setLeaveGuard(() => dirty);
    return () => setLeaveGuard(null);
  }, [dirty]);

  if (!s) return <p class="muted">Cargando…</p>;

  const set = <K extends keyof Settings>(k: K, val: Settings[K]) => {
    v.clear(k as string);
    setS((x) => (x ? { ...x, [k]: val } : x));
  };
  const logo = s.logo_path ? `/media/${s.logo_path}` : '/player/logo.svg';

  const save = async (e: Event) => {
    e.preventDefault();
    const sources = s.rate_custom_sources;
    const ok = await v.validate([
      [!s.store_name.trim(), 'store_name', 'Nombre de la tienda'],
      [!s.show_usd && !s.show_bs, 'show_usd', 'Mostrar al menos una moneda (USD o Bs)'],
      [s.ticker_message.length > 500, 'ticker_message', 'Mensaje de la marquesina: máximo 500 caracteres'],
      [s.card_bg_color.toUpperCase() === s.card_text_color.toUpperCase(), 'card_text_color', 'Color del texto distinto al fondo de la tarjeta'],
      [s.rate_daily_enabled && !/^([01]\d|2[0-3]):[0-5]\d$/.test(s.rate_daily_time), 'rate_daily_time', 'Hora de la consulta diaria'],
      [!(s.rate_fetch_minutes >= 5 && s.rate_fetch_minutes <= 720), 'rate_fetch_minutes', 'Revisar cada: entre 5 y 720 minutos'],
      [!(s.store_open_hour < s.store_close_hour), 'store_close_hour', 'Horario de tienda: la hora de cierre debe ser mayor que la de apertura'],
      [!(s.rate_max_jump_pct >= 1 && s.rate_max_jump_pct <= 100), 'rate_max_jump_pct', 'Variación máxima: entre 1 y 100 %'],
      [!(s.rate_adjust_bp >= -5000 && s.rate_adjust_bp <= 5000), 'rate_adjust_bp', 'Ajuste sobre la tasa: entre -50 y 50 %'],
      [!(s.rate_stale_hours >= 1 && s.rate_stale_hours <= 240), 'rate_stale_hours', 'Aviso de tasa vieja: entre 1 y 240 horas'],
      [s.rate_source_mode === 'auto' && s.rate_providers.length === 0 && sources.length === 0, 'rate_providers', 'Al menos una fuente automática (BCV o DolarApi)'],
      ...sources.flatMap((src, i): [boolean, string, string][] => [
        [!src.name.trim(), `src${i}`, `Fuente adicional ${i + 1}: nombre`],
        [!isUrl(src.url), `src${i}`, `Fuente adicional ${i + 1}: dirección web válida (https://…)`],
        [!src.rate_path.trim(), `src${i}`, `Fuente adicional ${i + 1}: ruta de la tasa`],
      ]),
    ]);
    if (!ok) return;

    if (contrast(s.card_bg_color, s.card_text_color) < 3) {
      const sure = await confirmAction({
        title: 'Poco contraste en las tarjetas',
        text: 'El texto podría leerse mal desde lejos con esos colores. ¿Guardar igual?',
        confirmText: 'Guardar igual',
        cancelText: 'Cambiar colores',
        icon: 'warning',
      });
      if (!sure) return;
    }
    if (s.rate_source_mode === 'auto' && !s.rate_daily_enabled && !s.rate_poll_enabled) {
      const sure = await confirmAction({
        title: 'La tasa no se actualizará sola',
        text: 'Desactivó la consulta diaria y las revisiones extra. Tendrá que pulsar “Consultar ahora” o escribir la tasa a mano cada día. ¿Continuar?',
        confirmText: 'Sí, continuar',
        icon: 'warning',
      });
      if (!sure) return;
    }
    if (settings && s.rate_source_mode === 'manual' && settings.rate_source_mode !== 'manual') {
      const sure = await confirmAction({
        title: '¿Usar solo tasa manual?',
        text: 'Se dejará de consultar el BCV. Los precios en Bs usarán únicamente la tasa que usted escriba.',
        confirmText: 'Sí, solo manual',
        icon: 'warning',
      });
      if (!sure) return;
    }
    setBusy(true);
    try {
      await api('/api/admin/settings', { method: 'PUT', body: { ...s, store_name: s.store_name.trim() } });
      await reloadShared();
      notify('Ajustes guardados: los televisores ya se actualizaron');
    } catch (err) {
      await errorAlert((err as Error).message, 'No se pudo guardar');
    } finally {
      setBusy(false);
    }
  };

  const discard = async () => {
    if (await confirmDiscard()) setS(settings);
  };

  const example = rate
    ? formatBs(usdCentsToBsCents(1290, rate.effective_rate_e4, { stepCents: s.rounding_step_cents, mode: s.rounding_mode }))
    : '—';

  const setSource = (i: number, patch: Partial<CustomRateSource>) => {
    v.clear(`src${i}`);
    set(
      'rate_custom_sources',
      s.rate_custom_sources.map((x, j) => (i === j ? { ...x, ...patch } : x)),
    );
  };
  const toggleProvider = (id: string, on: boolean) =>
    set('rate_providers', on ? [...s.rate_providers.filter((p) => p !== id), id] : s.rate_providers.filter((p) => p !== id));
  const num = (e: Event) => Number((e.target as HTMLInputElement).value);

  return (
    <form class="settings" onSubmit={save} noValidate>
      <PageHeader icon="palette" title="Apariencia y precios" description="Todo lo que se ve en los televisores. Los cambios se aplican al guardar." />

      <Card title="Tienda" icon="home">
        <div class="row">
          <Field label="Nombre" required invalid={v.has('store_name')}>
            <input value={s.store_name} onInput={(e) => set('store_name', (e.target as HTMLInputElement).value)} />
          </Field>
          <Field label="RIF">
            <input value={s.store_rif} onInput={(e) => set('store_rif', (e.target as HTMLInputElement).value)} />
          </Field>
        </div>
        <Field label="Logo (opcional, reemplaza al logo incluido)">
          <ImagePicker value={s.logo_path} onChange={(val) => set('logo_path', val)} />
        </Field>
      </Card>

      <Card title="Logos en los televisores" icon="image" description="Tamaño relativo al diseño original (100 %).">
        <div class="preview-grid">
          <div>
            <Field label={`Logo del encabezado: ${s.header_logo_scale} %`}>
              <input type="range" min={50} max={200} step={10} value={s.header_logo_scale} onInput={(e) => set('header_logo_scale', num(e))} />
            </Field>
            <div class="mock-tv">
              {/* 1 TV rem = 100cqw / 192: the mock keeps the real proportions of a 1920 px screen */}
              <div class="mock-hdr" style={{ height: `calc(${Math.max(13, 11.5 * (s.header_logo_scale / 100) + 2.4)} * 100cqw / 192)` }}>
                <img
                  src={logo}
                  alt=""
                  style={{
                    height: `calc(${11.5 * (s.header_logo_scale / 100)} * 100cqw / 192)`,
                    maxWidth: `calc(${50 * (s.header_logo_scale / 100)} * 100cqw / 192)`,
                  }}
                />
                <span class="mock-bar" />
                <b>CHARCUTERÍA</b>
              </div>
              <div class="mock-body" />
            </div>
          </div>
          <div>
            <Field label={`Logo de la transición: ${s.transition_logo_scale} %`}>
              <input type="range" min={50} max={200} step={10} value={s.transition_logo_scale} onInput={(e) => set('transition_logo_scale', num(e))} />
            </Field>
            <div class="mock-tv">
              <div class="mock-wipe">
                <span class="b1" />
                <span class="b2" />
                <img
                  src={logo}
                  alt=""
                  style={{
                    maxWidth: `${Math.min(100 * (s.transition_logo_scale / 100), 175) / 1.92}%`,
                    maxHeight: `${Math.min(46 * (s.transition_logo_scale / 100), 80) / 0.84}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Tarjetas de producto" icon="box" description="Color de la franja con el nombre del producto y tamaño de la foto.">
        <div class="preview-grid">
          <div>
            <p class="field-title">Color de la franja del nombre</p>
            <div class="presets">
              {CARD_PRESETS.map((p) => (
                <button
                  type="button"
                  key={p.name}
                  class={`preset${s.card_bg_color.toUpperCase() === p.bg && s.card_text_color.toUpperCase() === p.text ? ' selected' : ''}`}
                  onClick={() => setS((x) => (x ? { ...x, card_bg_color: p.bg, card_text_color: p.text } : x))}
                >
                  <span style={{ background: p.bg, color: p.text }}>Aa</span>
                  {p.name}
                </button>
              ))}
            </div>
            <div class="row">
              <Field label="Fondo">
                <div class="color-input">
                  <input type="color" value={s.card_bg_color} onInput={(e) => set('card_bg_color', (e.target as HTMLInputElement).value.toUpperCase())} />
                  <code>{s.card_bg_color}</code>
                </div>
              </Field>
              <Field label="Texto" invalid={v.has('card_text_color')}>
                <div class="color-input">
                  <input type="color" value={s.card_text_color} onInput={(e) => set('card_text_color', (e.target as HTMLInputElement).value.toUpperCase())} />
                  <code>{s.card_text_color}</code>
                </div>
              </Field>
            </div>
            <Field label={`Tamaño de la foto del producto: ${s.card_image_scale} %`} hint="Suba la barra para agrandar la foto y bájela para achicarla.">
              <div class="range-row">
                <Icon name="image" size={14} />
                <input type="range" min={50} max={150} step={5} value={s.card_image_scale} onInput={(e) => set('card_image_scale', num(e))} />
                <Icon name="image" size={22} />
              </div>
            </Field>
          </div>
          <div class="mock-card" style={{ background: s.card_bg_color, color: s.card_text_color }}>
            <div class="mock-photo">
              {/* same geometry as the TV: 86 % of the photo area at 100 % */}
              <div class="mock-product" style={{ width: `${86 * (s.card_image_scale / 100)}%`, height: `${86 * (s.card_image_scale / 100)}%` }}>
                <span />
              </div>
            </div>
            <div class="mock-info">
              <span class="mock-unit">POR KG</span>
              <b>JAMÓN DE PIERNA</b>
              <div class="mock-tag">
                <span>$ 12,90</span>
                <small>Bs 2.653,26</small>
              </div>
            </div>
          </div>
        </div>
      </Card>

      <Card title="Recuadro de la tasa (pie de pantalla)" icon="dollar">
        <div class="footer-styles">
          {FOOTER_STYLES.map((f) => (
            <button type="button" key={f.id} class={`footer-opt${s.footer_rate_style === f.id ? ' selected' : ''}`} onClick={() => set('footer_rate_style', f.id)}>
              <div class={`mock-ftr rs-${f.id}`}>
                <span class="r-label">Tasa BCV</span>
                <span class="r-val">
                  <small>Bs</small>
                  {rate?.display ?? '36,50'}
                </span>
              </div>
              <b>{f.name}</b>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Precios en pantalla" icon="tag">
        <div class="row toggles">
          <Toggle label="Mostrar USD" checked={s.show_usd} onChange={(val) => set('show_usd', val)} />
          <Toggle label="Mostrar Bs" checked={s.show_bs} onChange={(val) => set('show_bs', val)} />
          {v.has('show_usd') && <span class="danger">Elija al menos una</span>}
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
        <Field label={`Mensaje de la marquesina (${s.ticker_message.length}/500)`} invalid={v.has('ticker_message')}>
          <textarea rows={2} value={s.ticker_message} onInput={(e) => set('ticker_message', (e.target as HTMLTextAreaElement).value)} />
        </Field>
        <Toggle label="Modo bajo consumo en todos los TVs (sin sombras ni animaciones decorativas)" checked={s.low_power} onChange={(val) => set('low_power', val)} />
      </Card>

      <Card title="Tasa de cambio" icon="clock" description="El BCV publica hacia las 4 p. m. la tasa del día hábil siguiente.">
        <div class="row">
          <Field label="Origen de la tasa">
            <select value={s.rate_source_mode} onChange={(e) => set('rate_source_mode', (e.target as HTMLSelectElement).value as Settings['rate_source_mode'])}>
              <option value="auto">Automática (con respaldo manual)</option>
              <option value="manual">Solo manual</option>
            </select>
          </Field>
          <Field label="¿Qué tasa usar?">
            <select value={s.rate_mode} onChange={(e) => set('rate_mode', (e.target as HTMLSelectElement).value as Settings['rate_mode'])}>
              <option value="today">Tasa vigente hoy (recomendado)</option>
              <option value="latest">Tasa publicada más reciente</option>
            </select>
          </Field>
        </div>

        <div class="subsection">
          <h4>
            <Icon name="clock" size={16} /> Consulta diaria
          </h4>
          <div class="row toggles">
            <Toggle label="Consultar la tasa todos los días" checked={s.rate_daily_enabled} onChange={(val) => set('rate_daily_enabled', val)} />
            <Field label="Hora (Caracas)" required={s.rate_daily_enabled} invalid={v.has('rate_daily_time')}>
              <input type="time" value={s.rate_daily_time} disabled={!s.rate_daily_enabled} onInput={(e) => set('rate_daily_time', (e.target as HTMLInputElement).value)} />
            </Field>
          </div>
          <p class="hint">Si falla (sin internet), se reintenta cada 5 minutos hasta lograrlo ese día. Si el PC estaba apagado a esa hora, se consulta al encender.</p>
        </div>

        <div class="subsection">
          <h4>
            <Icon name="refresh" size={16} /> Revisiones extra
          </h4>
          <div class="row toggles">
            <Toggle label="Revisar también durante el horario de tienda" checked={s.rate_poll_enabled} onChange={(val) => set('rate_poll_enabled', val)} />
          </div>
          <div class="row">
            <Field label="Cada (minutos)" invalid={v.has('rate_fetch_minutes')}>
              <input type="number" min={5} max={720} disabled={!s.rate_poll_enabled} value={s.rate_fetch_minutes} onInput={(e) => set('rate_fetch_minutes', num(e))} />
            </Field>
            <Field label="Desde (hora)">
              <input type="number" min={0} max={23} disabled={!s.rate_poll_enabled} value={s.store_open_hour} onInput={(e) => set('store_open_hour', num(e))} />
            </Field>
            <Field label="Hasta (hora)" invalid={v.has('store_close_hour')}>
              <input type="number" min={1} max={24} disabled={!s.rate_poll_enabled} value={s.store_close_hour} onInput={(e) => set('store_close_hour', num(e))} />
            </Field>
          </div>
        </div>

        <div class="subsection">
          <h4>
            <Icon name="wifi" size={16} /> Fuentes y seguridad
          </h4>
          <div class="row toggles">
            <Toggle label="Página del BCV" checked={s.rate_providers.includes('bcv')} onChange={(val) => toggleProvider('bcv', val)} />
            <Toggle label="DolarApi (comunitaria)" checked={s.rate_providers.includes('dolarapi')} onChange={(val) => toggleProvider('dolarapi', val)} />
            <Toggle label="Aceptar certificado inválido del BCV" checked={s.bcv_insecure_tls} onChange={(val) => set('bcv_insecure_tls', val)} />
            {v.has('rate_providers') && <span class="danger">Active al menos una fuente</span>}
          </div>
          <div class="row">
            <Field label="Variación máxima sin confirmar (%)" invalid={v.has('rate_max_jump_pct')} hint="Protege contra lecturas erróneas.">
              <input type="number" min={1} max={100} value={s.rate_max_jump_pct} onInput={(e) => set('rate_max_jump_pct', num(e))} />
            </Field>
            <Field label="Ajuste sobre la tasa (%)" invalid={v.has('rate_adjust_bp')} hint="0 = tasa BCV exacta.">
              <input
                type="number"
                step="0.01"
                min={-50}
                max={50}
                value={s.rate_adjust_bp / 100}
                onInput={(e) => set('rate_adjust_bp', Math.round(num(e) * 100))}
              />
            </Field>
            <Field label="Avisar si la tasa tiene más de (h)" invalid={v.has('rate_stale_hours')}>
              <input type="number" min={1} max={240} value={s.rate_stale_hours} onInput={(e) => set('rate_stale_hours', num(e))} />
            </Field>
          </div>
        </div>

        <details>
          <summary>Fuentes JSON adicionales (avanzado)</summary>
          <p class="hint">
            Cualquier URL que devuelva JSON con la tasa. "Ruta" es la ubicación del número, p. ej. <code>promedio</code> o <code>data.usd</code>.
          </p>
          {s.rate_custom_sources.map((src, i) => (
            <div class={`row source-row${v.has(`src${i}`) ? ' invalid' : ''}`} key={i}>
              <Field label="Nombre" required>
                <input value={src.name} onInput={(e) => setSource(i, { name: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="URL" required>
                <input value={src.url} onInput={(e) => setSource(i, { url: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Ruta de la tasa" required>
                <input value={src.rate_path} onInput={(e) => setSource(i, { rate_path: (e.target as HTMLInputElement).value })} />
              </Field>
              <Field label="Ruta de la fecha">
                <input value={src.date_path ?? ''} onInput={(e) => setSource(i, { date_path: (e.target as HTMLInputElement).value || undefined })} />
              </Field>
              <button
                type="button"
                class="icon"
                aria-label="Quitar fuente"
                onClick={async () => {
                  if (await confirmAction({ title: '¿Quitar esta fuente?', text: src.name || 'Fuente sin nombre', confirmText: 'Quitar', danger: true }))
                    set('rate_custom_sources', s.rate_custom_sources.filter((_, j) => j !== i));
                }}
              >
                <Icon name="trash" size={16} />
              </button>
            </div>
          ))}
          <button
            type="button"
            class="btn small"
            onClick={() => set('rate_custom_sources', [...s.rate_custom_sources, { name: '', url: 'https://', rate_path: 'promedio' }])}
          >
            <Icon name="plus" size={14} /> Agregar fuente
          </button>
        </details>
      </Card>

      <div class={`save-bar${dirty ? ' show' : ''}`}>
        <span>
          <Icon name="alert" size={16} /> Tiene cambios sin guardar
        </span>
        <span class="grow" />
        <button type="button" class="btn ghost" onClick={discard}>
          Descartar
        </button>
        <button class="btn primary big" disabled={busy}>
          <Icon name="check" size={16} /> {busy ? 'Guardando…' : 'Guardar ajustes'}
        </button>
      </div>
    </form>
  );
}
