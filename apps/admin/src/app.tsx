import { useCallback, useEffect, useState } from 'preact/hooks';
import type { Category, RateInfo, ScreenStatus, Settings, WsServerMessage } from '@chicolven/shared/types';
import { api, getToken, setToken, setUnauthorizedHandler } from './api.ts';
import { AppContext, type AppState } from './state.ts';
import { Login } from './pages/Login.tsx';
import { Dashboard } from './pages/Dashboard.tsx';
import { Products } from './pages/Products.tsx';
import { Categories } from './pages/Categories.tsx';
import { Screens } from './pages/Screens.tsx';
import { Promos } from './pages/Promos.tsx';
import { Rates } from './pages/Rates.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { System } from './pages/System.tsx';

const ROUTES = [
  { path: 'inicio', label: 'Inicio', icon: '🏠', page: Dashboard },
  { path: 'productos', label: 'Productos', icon: '🧀', page: Products },
  { path: 'categorias', label: 'Categorías', icon: '🗂️', page: Categories },
  { path: 'pantallas', label: 'Pantallas', icon: '📺', page: Screens },
  { path: 'promociones', label: 'Promociones', icon: '📣', page: Promos },
  { path: 'tasa', label: 'Tasa BCV', icon: '💱', page: Rates },
  { path: 'apariencia', label: 'Apariencia y precios', icon: '🎨', page: SettingsPage },
  { path: 'sistema', label: 'Sistema', icon: '⚙️', page: System },
] as const;

function currentRoute(): string {
  return location.hash.replace(/^#\/?/, '').split('?')[0] || 'inicio';
}

interface Toast {
  id: number;
  message: string;
  kind: 'ok' | 'error';
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
  const [revision, setRevision] = useState(0);
  const [toasts, setToasts] = useState<Toast[]>([]);

  const toast = useCallback((message: string, kind: 'ok' | 'error' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 5000 : 2500);
  }, []);

  const reloadShared = useCallback(async () => {
    const [s, r, c, session] = await Promise.all([
      api<Settings>('/api/admin/settings'),
      api<{ current: RateInfo | null }>('/api/admin/rates'),
      api<Category[]>('/api/admin/categories'),
      api<{ default_pin: boolean }>('/api/auth/session'),
    ]);
    setSettings(s);
    setRate(r.current);
    setCategories(c);
    setDefaultPin(session.default_pin);
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => setAuthed(false));
    const onHash = () => {
      setRoute(currentRoute());
      setMenuOpen(false);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    if (!authed) return;
    reloadShared().catch(() => {});
    // Live updates: screen connection status and content changes from other admins.
    let ws: WebSocket | null = null;
    let stopped = false;
    let retry = 0;
    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws?role=admin&token=${encodeURIComponent(getToken() ?? '')}`);
      ws.onopen = () => (retry = 0);
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
          setAuthed(true);
        }}
      />
    );
  }

  const active = ROUTES.find((r) => r.path === route) ?? ROUTES[0];
  const Page = active.page;
  const state: AppState = { settings, rate, categories, screenStatus, defaultPin, revision, reloadShared, toast };

  const logout = async () => {
    await api('/api/auth/logout', { method: 'POST' }).catch(() => {});
    setToken(null);
    setAuthed(false);
  };

  return (
    <AppContext.Provider value={state}>
      <div class="shell">
        <aside class={menuOpen ? 'open' : ''}>
          <div class="brand">
            <img src={settings?.logo_path ? `/media/${settings.logo_path}` : '/player/logo.svg'} alt="Chicolven" />
          </div>
          <nav>
            {ROUTES.map((r) => (
              <a key={r.path} href={`#/${r.path}`} class={r.path === active.path ? 'active' : ''}>
                <span class="ico">{r.icon}</span>
                {r.label}
              </a>
            ))}
          </nav>
          <button class="btn ghost logout" onClick={logout}>
            Cerrar sesión
          </button>
        </aside>
        <main>
          <header class="topbar">
            <button class="icon menu-btn" onClick={() => setMenuOpen(!menuOpen)} aria-label="Menú">
              ☰
            </button>
            <h1>{active.label}</h1>
            <a class="rate-chip" href="#/tasa" title="Tasa usada para los precios en Bs">
              {rate ? (
                <>
                  Tasa <b>Bs {rate.display}</b>
                  {rate.stale && <span class="warn-dot" title="La tasa tiene muchas horas sin actualizarse" />}
                </>
              ) : (
                <span class="danger">Sin tasa</span>
              )}
            </a>
          </header>
          {defaultPin && (
            <div class="banner warn">
              Está usando el PIN por defecto (1234). <a href="#/sistema">Cámbielo aquí</a>.
            </div>
          )}
          <div class="content">
            <Page />
          </div>
        </main>
      </div>
      <div class="toasts">
        {toasts.map((t) => (
          <div key={t.id} class={`toast ${t.kind}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppContext.Provider>
  );
}
