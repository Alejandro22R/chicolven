import { useEffect, useState } from 'preact/hooks';
import { api } from './api.ts';

export interface TvAddress {
  /** e.g. "chicolven.local:3000" */
  name: string;
  /** e.g. "192.168.1.20:3000" (first network address), or the current host as fallback */
  ip: string;
}

let cached: Promise<TvAddress> | null = null;

/** Addresses the TVs should use (never "localhost", which only works on this PC). */
export function useTvAddress(): TvAddress {
  const [addr, setAddr] = useState<TvAddress>({ name: location.host, ip: location.host });
  useEffect(() => {
    cached ??= api<{ network: { port: number; local_name: string; ips: string[] } }>('/api/admin/system').then(({ network }) => {
      const port = network.port === 80 ? '' : `:${network.port}`;
      return { name: `${network.local_name}${port}`, ip: network.ips[0] ? `${network.ips[0]}${port}` : location.host };
    });
    cached.then(setAddr).catch(() => (cached = null));
  }, []);
  return addr;
}
