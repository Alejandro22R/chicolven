import { useState } from 'preact/hooks';
import { api, ApiError } from '../api.ts';
import { errorAlert, missingFields } from '../alerts.ts';
import { Icon } from '../components/icons.tsx';

export function Login(props: { onLogin: (token: string) => void }) {
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!pin.trim()) return missingFields(['PIN de acceso (4 a 8 números)'], 'Escriba su PIN', 'Para entrar al panel necesita:');
    if (!/^\d{4,8}$/.test(pin)) return errorAlert('El PIN tiene de 4 a 8 números.', 'PIN inválido');
    setBusy(true);
    try {
      const res = await api<{ token: string }>('/api/auth/login', { body: { pin } });
      props.onLogin(res.token);
    } catch (err) {
      setShake(true);
      setTimeout(() => setShake(false), 500);
      setPin('');
      const tooMany = err instanceof ApiError && err.status === 429;
      await errorAlert((err as Error).message, tooMany ? 'Demasiados intentos' : 'No se pudo entrar');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <form onSubmit={submit} class={`login-card${shake ? ' shake' : ''}`}>
        <img src="/player/logo.svg" alt="Chicolven" />
        <h1>Panel de administración</h1>
        <p>Precios y pantallas de la tienda</p>
        <div class="pin-wrap">
          <Icon name="shield" size={20} />
          <input
            type="password"
            inputMode="numeric"
            autoComplete="current-password"
            placeholder="PIN"
            maxLength={8}
            value={pin}
            autoFocus
            onInput={(e) => setPin((e.target as HTMLInputElement).value.replace(/\D/g, ''))}
          />
        </div>
        <button class="btn primary big" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
