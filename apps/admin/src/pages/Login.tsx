import { useState } from 'preact/hooks';
import { api } from '../api.ts';

export function Login(props: { onLogin: (token: string) => void }) {
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await api<{ token: string }>('/api/auth/login', { body: { pin } });
      props.onLogin(res.token);
    } catch (err) {
      setError((err as Error).message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div class="login">
      <form onSubmit={submit} class="login-card">
        <img src="/player/logo.svg" alt="Chicolven" />
        <h1>Panel de administración</h1>
        <input
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          placeholder="PIN"
          value={pin}
          autoFocus
          onInput={(e) => setPin((e.target as HTMLInputElement).value)}
        />
        {error && <p class="error">{error}</p>}
        <button class="btn primary big" disabled={busy || pin.length < 4}>
          Entrar
        </button>
      </form>
    </div>
  );
}
