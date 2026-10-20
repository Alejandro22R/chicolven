/** Small fetch wrapper for the admin API. The session token lives in localStorage. */

const TOKEN_KEY = 'chicolven.admin.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // private mode: the session only lasts for this page
  }
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

let onUnauthorized: () => void = () => {};
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (init.body instanceof FormData) body = init.body;
  else if (init.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(init.body);
  }
  const res = await fetch(path, { method: init.method ?? (body ? 'POST' : 'GET'), headers, body });
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json() : await res.text();
  if (res.status === 401 && !path.startsWith('/api/auth/login')) {
    setToken(null);
    onUnauthorized();
  }
  if (!res.ok) {
    const message = typeof data === 'object' && data && 'error' in data ? String((data as { error: unknown }).error) : `Error ${res.status}`;
    throw new ApiError(message, res.status);
  }
  return data as T;
}

/** Adds the token to download links (CSV, backups). */
export function withToken(path: string): string {
  const token = getToken();
  return token ? `${path}${path.includes('?') ? '&' : '?'}token=${encodeURIComponent(token)}` : path;
}

export async function uploadImage(file: File): Promise<{ path: string; url: string }> {
  const form = new FormData();
  form.append('file', file);
  return api('/api/admin/media', { method: 'POST', body: form });
}
