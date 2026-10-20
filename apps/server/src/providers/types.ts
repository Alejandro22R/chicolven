import http from 'node:http';
import https from 'node:https';

/** A rate as reported by an external source. Treated as untrusted until validated by RateService. */
export interface RateQuote {
  source: string;
  rate_e4: number;
  /** YYYY-MM-DD in Caracas; null when the source does not say. */
  effective_date: string | null;
}

export interface RateProvider {
  id: string;
  label: string;
  fetch(signal: AbortSignal): Promise<RateQuote>;
}

/** Sanity bounds for any rate: 0,01 to 10.000.000 Bs per USD. */
export const MIN_RATE_E4 = 100;
export const MAX_RATE_E4 = 100_000_000_000;

export function assertSaneRate(rateE4: number | null, source: string): number {
  if (rateE4 === null || !Number.isSafeInteger(rateE4) || rateE4 < MIN_RATE_E4 || rateE4 > MAX_RATE_E4) {
    throw new Error(`${source}: tasa fuera de rango (${rateE4})`);
  }
  return rateE4;
}

export interface FetchTextOptions {
  signal: AbortSignal;
  /** Accept invalid TLS certificates (the BCV site has had certificate problems). */
  insecure?: boolean;
  maxBytes?: number;
  redirects?: number;
}

/** Minimal GET returning the body as text. Uses node:https so TLS checking can be relaxed per call. */
export function fetchText(url: string, opts: FetchTextOptions): Promise<string> {
  const { signal, insecure = false, maxBytes = 3_000_000, redirects = 3 } = opts;
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const client = target.protocol === 'http:' ? http : https;
    const req = client.get(
      target,
      {
        signal,
        rejectUnauthorized: !insecure,
        headers: {
          'User-Agent': 'Mozilla/5.0 (ChicolvenVitrina)',
          Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'Accept-Encoding': 'identity',
        },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400 && res.headers.location && redirects > 0) {
          res.resume();
          const next = new URL(res.headers.location, target).toString();
          fetchText(next, { ...opts, redirects: redirects - 1 }).then(resolve, reject);
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`HTTP ${status} en ${target.host}`));
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > maxBytes) {
            req.destroy(new Error('Respuesta demasiado grande'));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        res.on('error', reject);
      },
    );
    req.on('error', reject);
  });
}

/** Reads a dot path ("data.usd.promedio", "rates.0.value") from parsed JSON. */
export function readPath(obj: unknown, dotPath: string): unknown {
  let cur: unknown = obj;
  for (const key of dotPath.split('.').filter(Boolean)) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}
