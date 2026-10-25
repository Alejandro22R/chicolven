import dgram from 'node:dgram';
import os from 'node:os';
import makeMdns from 'multicast-dns';
import type { EventLog } from './eventLog.ts';

/**
 * Announces this PC on the local network as <name>.local (mDNS / Bonjour), so TVs and phones can
 * open http://chicolven.local:3000 instead of the IP. Devices that do not support mDNS (some
 * older Smart TVs) still work with the IP.
 */
const MDNS_PORT = 5353;
const MDNS_GROUP = '224.0.0.251';

export interface MdnsQuestion {
  name: string;
  type: string;
  class?: string;
}

export interface MdnsReply {
  packet: { id?: number; questions?: MdnsQuestion[]; answers: { name: string; type: 'A'; ttl: number; data: string }[] };
  /** Unicast destination; undefined = multicast to the mDNS group. */
  to?: { address: string; port: number };
  /** Local IP the reply should leave from (the asker's subnet). */
  via: string;
}

/**
 * Decides how to answer "who is <host>?" (RFC 6762):
 * - "one-shot" queries sent from a port other than 5353 (Windows, Android, many TVs) must be
 *   answered directly to that port, repeating the query id and question;
 * - questions with the "unicast response" bit (QU) are answered directly too;
 * - anything else is answered to the multicast group.
 */
export function replyTo(
  host: string,
  query: { id?: number; questions: MdnsQuestion[] },
  rinfo: { address: string; port: number } | undefined,
  ips: string[],
): MdnsReply | null {
  const questions = query.questions.filter((q) => q.name.toLowerCase() === host && (q.type === 'A' || q.type === 'ANY'));
  if (questions.length === 0 || ips.length === 0) return null;
  const answers = ips.map((ip) => ({ name: host, type: 'A' as const, ttl: 120, data: ip }));
  const legacy = Boolean(rinfo && rinfo.port !== MDNS_PORT);
  const wantsUnicast = questions.some((q) => q.class === 'UNKNOWN_32769'); // IN class with the QU bit
  if (rinfo && (legacy || wantsUnicast)) {
    return {
      packet: legacy ? { id: query.id, questions, answers } : { answers },
      to: { address: rinfo.address, port: rinfo.port },
      via: ips[0]!,
    };
  }
  return { packet: { answers }, via: ips[0]! };
}

/**
 * Announces this PC on the local network as <name>.local (mDNS / Bonjour), so TVs and phones can
 * open http://chicolven.local:3000 instead of the IP. Devices that do not support mDNS (some
 * older Smart TVs) still work with the IP.
 */
export class LocalNameService {
  private mdns: ReturnType<typeof makeMdns> | null = null;
  private socket: dgram.Socket | null = null;

  constructor(
    public readonly name: string,
    private log?: EventLog,
  ) {}

  get host(): string {
    return `${this.name}.local`;
  }

  start(): void {
    try {
      // Own socket so each reply can leave through the network card of the asker: on PCs with
      // virtual adapters (WSL, Hyper-V, VirtualBox, VPN) the default one is often the wrong one.
      this.socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
      this.mdns = makeMdns({ socket: this.socket, reuseAddr: true });
    } catch (err) {
      this.log?.add('warn', `No se pudo anunciar ${this.host}: ${String(err)}`);
      return;
    }
    this.mdns.on('error', (err) => this.log?.add('warn', `No se pudo anunciar ${this.host} (mDNS): ${String(err)}`));
    this.mdns.on('query', (query, rinfo) => {
      const reply = replyTo(this.host, query as { id?: number; questions: MdnsQuestion[] }, rinfo, addressesFor(rinfo?.address));
      if (!reply || !this.mdns) return;
      if (!reply.to) {
        try {
          this.socket?.setMulticastInterface(reply.via);
        } catch {
          /* interface just went away; send through the default one */
        }
      }
      this.mdns.respond(reply.packet as never, reply.to ?? { address: MDNS_GROUP, port: MDNS_PORT });
    });
    this.log?.add('info', `Anunciado en la red como ${this.host}`);
  }

  stop(): void {
    this.mdns?.destroy();
    this.mdns = null;
    this.socket = null;
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
