import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Category, ExchangeRate, RateInfo, ScreenStatus, Settings, WsServerMessage } from '@chicolven/shared/types';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.ts';
import { confirmAction, confirmDiscard, infoAlert } from './alerts.ts';
import { AppContext, type AppState } from './state.ts';
import { Icon, type IconName } from './components/icons.tsx';
import { timeAgo } from './components/ui.tsx';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Products } from './pages/Products.tsx';
import { Categories } from './pages/Categories.tsx';
import { Screens } from './pages/Screens.tsx';
import { Promos } from './pages/Promos.tsx';
import { Rates } from './pages/Rates.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { System } from './pages/System.tsx';

interface Route {
  path: string;
  label: string;
  icon: IconName;
  group: string;
  page: () => preact.JSX.Element;
}

const ROUTES: Route[] = [
  { path: 'inicio', label: 'Inicio', icon: 'home', group: 'General', page: Dashboard },
  { path: 'productos', label: 'Productos', icon: 'box', group: 'Catálogo', page: Products },
  { path: 'categorias', label: 'Categorías', icon: 'tag', group: 'Catálogo', page: Categories },
  { path: 'promociones', label: 'Promociones', icon: 'megaphone', group: 'Catálogo', page: Promos },
  { path: 'pantallas', label: 'Pantallas', icon: 'tv', group: 'Televisores', page: Screens },
  { path: 'apariencia', label: 'Apariencia y precios', icon: 'palette', group: 'Televisores', page: SettingsPage },
  { path: 'tasa', label: 'Tasa BCV', icon: 'dollar', group: 'Sistema', page: Rates },
  { path: 'sistema', label: 'Sistema', icon: 'settings', group: 'Sistema', page: System },
];
const GROUPS = ['General', 'Catálogo', 'Televisores', 'Sistema'];

function currentRoute(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
}

export function App() {
  const [authed, setAuthed] = useState(Boolean(getToken()));
  const [route, setRoute] = useState(currentRoute());
  const [menuOpen, setMenuOpen] = useState(false);
  const [settings, setSettings] = useState<Settings | null>(null);
  const [rate, setRate] = useState<RateInfo | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [screenStatus, setScreenStatus] = useState<ScreenStatus[]>([]);
  const [defaultPin, setDefaultPin] = useState(false);
  const [connected, setConnected] = useState(true);
  const [revision, setRevision] = useState(0);
  const guard = useRef<(() => boolean) | null>(null);
  const welcomed = useRef(false);

  const reloadShared = useCallback(async () => {
    const [s, r, c, session] = await Promise.all([
      api<Settings>('/api/admin/settings'),
      api<{ current: RateInfo | null; pending: ExchangeRate[] }>('/api/admin/rates'),
      api<Category[]>('/api/admin/categories'),
      api<{ default_pin: boolean }>('/api/auth/session'),
    ]);
    setSettings(s);
    setRate(r.current);
    setCategories(c);
    setDefaultPin(session.default_pin);
    return { rate: r.current, pending: r.pending.length, defaultPin: session.default_pin };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    const onHash = () => {
      setRoute(currentRoute());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    // Closing the tab with unsaved changes.
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (guard.current?.()) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, []);

  useEffect(() => {
    if (!authed) return;
    reloadShared()
      .then(async (info) => {
        if (welcomed.current) return;
        welcomed.current = true;
        // Reminders right after logging in, most important first.
        if (info.defaultPin) {
          await infoAlert(
            'Cambie el PIN de acceso',
            'Está usando el PIN de fábrica <b>1234</b>. Cualquier persona en la red podría cambiar los precios.<br>Cámbielo en <b>Sistema → Cambiar PIN</b>.',
          );
        }
        if (!info.rate) {
          await infoAlert('No hay tasa registrada', 'Los televisores muestran solo precios en USD. Vaya a <b>Tasa BCV</b> y consulte la tasa o escriba una manual.');
        } else if (info.rate.stale) {
          await infoAlert('La tasa está desactualizada', `La tasa en uso se actualizó <b>${timeAgo(info.rate.fetched_at)}</b>. Revise <b>Tasa BCV</b>.`);
        }
        if (info.pending > 0) {
          await infoAlert('Hay una tasa pendiente', 'Se recibió una tasa con una variación grande. Confírmela o recházela en <b>Tasa BCV</b>.');
        }
      })
      .catch(() => {});
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?role=admin&token=${encodeURIComponent(getToken() ?? '')}`);
      ws.onopen = () => {
        retry = 0;
        setConnected(true);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as WsServerMessage;
        if (msg.type === 'screens-status') setScreenStatus(msg.screens);
        if (msg.type === 'content-changed') {
          setRevision((r) => r + 1);
          reloadShared().catch(() => {});
        }
      };
      ws.onclose = () => {
        if (stopped) return;
        setConnected(false);
        retry = Math.min(retry + 1, 5);
        setTimeout(connect, 1000 * 2 ** retry);
      };
    };
    connect();
    return () => {
      stopped = true;
      ws?.close();
    };
  }, [authed]);

  if (!authed) {
    return (
      <Login
        onLogin={(token) => {
          setToken(token);
          welcomed.current = false;
          setAuthed(true);
        }}
      />
    );
  }

  const active = ROUTES.find((r) => r.path === route) ?? ROUTES[0]!;
  const Page = active.page;
  const state: AppState = {
    settings,
    rate,
    categories,
    screenStatus,
    defaultPin,
    connected,
    revision,
    reloadShared: async () => {
      await reloadShared();
    },
    setLeaveGuard: (fn) => {
      guard.current = fn;
    },
  };

  const navigate = async (e: Event, path: string) => {
    e.preventDefault();
    if (path === active.path) return setMenuOpen(false);
    if (guard.current?.() && !(await confirmDiscard())) return;
    guard.current = null;
    location.hash = `#/${path}`;
  };

  const logout = async () => {
    if (guard.current?.() && !(await confirmDiscard())) return;
    if (!(await confirmAction({ title: '¿Cerrar sesión?', text: 'Tendrá que escribir el PIN para volver a entrar.', confirmText: 'Cerrar sesión' }))) return;
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setAuthed(false);
  };

  const onlineTvs = screenStatus.filter((s) => s.connections > 0).length;

  return (
    <AppContext.Provider value={state}>
      <div class="shell">
        <div class={`aside-backdrop${menuOpen ? ' open' : ''}`} onClick={() => setMenuOpen(false)} />
        <aside class={menuOpen ? 'open' : ''}>
          <div class="brand">
            <img src={settings?.logo_path ? `/media/${settings.logo_path}` : '/player/logo.svg'} alt="Chicolven" />
            <div class="brand-meta">
              <b>{settings?.store_name ?? 'Chicolven C.A.'}</b>
              <small>RIF {settings?.store_rif ?? 'J-41066000-7'}</small>
            </div>
          </div>
          <nav>
            {GROUPS.map((g) => (
              <div class="nav-group" key={g}>
                <span class="nav-label">{g}</span>
                {ROUTES.filter((r) => r.group === g).map((r) => (
                  <a key={r.path} href={`#/${r.path}`} class={r.path === active.path ? 'active' : ''} onClick={(e) => navigate(e, r.path)}>
                    <span class="nav-ico">
                      <Icon name={r.icon} size={18} />
                    </span>
                    {r.label}
                    {r.path === 'tasa' && !rate && <span class="nav-badge">!</span>}
                    {r.path === 'sistema' && defaultPin && <span class="nav-badge">!</span>}
                  </a>
                ))}
              </div>
            ))}
          </nav>
          <div class="aside-foot">
            <a class="aside-rate" href="#/tasa" onClick={(e) => navigate(e, 'tasa')}>
              <small>Tasa del día</small>
              <b>{rate ? `Bs ${rate.display}` : 'Sin tasa'}</b>
              <span class={`dot ${rate && !rate.stale ? 'on' : 'warn'}`} />
            </a>
            <button class="btn ghost logout" onClick={logout}>
              <Icon name="logout" size={16} /> Cerrar sesión
            </button>
          </div>
        </aside>
        <main>
          <header class="topbar">
            <button class="icon menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menú">
              <Icon name="menu" size={22} />
            </button>
            <div class="crumbs">
              <small>{active.group}</small>
              <h1>{active.label}</h1>
            </div>
            <span class={`live ${connected ? 'on' : 'off'}`} title={connected ? 'Conectado al servidor' : 'Sin conexión con el servidor'}>
              <Icon name="wifi" size={15} /> {connected ? `${onlineTvs} TV${onlineTvs === 1 ? '' : 's'} en línea` : 'Reconectando…'}
            </span>
            <a class="btn small ghost hide-sm" href="/tv/" target="_blank" rel="noreferrer">
              <Icon name="external" size={15} /> Ver TVs
            </a>
          </header>
          {!connected && (
            <div class="banner danger">
              <Icon name="alert" size={16} /> Se perdió la conexión con el servidor. Los cambios no se guardarán hasta que vuelva.
            </div>
          )}
          {defaultPin && (
            <div class="banner warn">
              <Icon name="shield" size={16} /> Está usando el PIN de fábrica (1234).{' '}
              <a href="#/sistema" onClick={(e) => navigate(e, 'sistema')}>
                Cámbielo aquí
              </a>
              .
            </div>
          )}
          <div class="content">
            <Page key={active.path} />
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}
