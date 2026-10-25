import os from 'node:os';
import makeMdns from 'multicast-dns';
import type { EventLog } from './eventLog.ts';

/**
 * Announces this PC on the local network as <name>.local (mDNS / Bonjour), so TVs and phones can
 * open http://chicolven.local:3000 instead of the IP. Devices that do not support mDNS (some
 * older Smart TVs) still work with the IP.
 */
export class LocalNameService {
  private mdns: ReturnType<typeof makeMdns> | null = null;

  constructor(
    public readonly name: string,
    private log?: EventLog,
  ) {}

  get host(): string {
    return `${this.name}.local`;
  }

  start(): void {
    try {
      this.mdns = makeMdns({ reuseAddr: true });
    } catch (err) {
      this.log?.add('warn', `No se pudo anunciar ${this.host}: ${String(err)}`);
      return;
    }
    this.mdns.on('error', (err) => this.log?.add('warn', `mDNS: ${String(err)}`));
    this.mdns.on('query', (query, rinfo) => {
      const asked = query.questions.some((q) => q.name.toLowerCase() === this.host && (q.type === 'A' || (q.type as string) === 'ANY'));
      if (!asked) return;
      const ips = addressesFor(rinfo?.address);
      if (ips.length === 0) return;
      this.mdns?.respond({ answers: ips.map((ip) => ({ name: this.host, type: 'A' as const, ttl: 120, data: ip })) });
    });
    this.log?.add('info', `Anunciado en la red como ${this.host}`);
  }

  stop(): void {
    this.mdns?.destroy();
    this.mdns = null;
  }
}

/** This PC's IPv4 addresses, the one on the asker's subnet first (a PC can have Wi-Fi + cable). */
export function addressesFor(remote?: string): string[] {
  const list: { address: string; netmask: string }[] = [];
  for (const iface of Object.values(os.networkInterfaces())) {
    for (const a of iface ?? []) if (a.family === 'IPv4' && !a.internal) list.push({ address: a.address, netmask: a.netmask });
  }
  if (!remote) return list.map((a) => a.address);
  const toInt = (ip: string) => ip.split('.').reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;
  const same = list.filter((a) => (toInt(a.address) & toInt(a.netmask)) === (toInt(remote) & toInt(a.netmask)));
  return (same.length ? same : list).map((a) => a.address);
}
