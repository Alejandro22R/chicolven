import os from 'node:os';

/** IPv4 addresses of this PC on the local network (to show the TV URLs). */
export function localAddresses(): string[] {
  const out: string[] = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const addr of list ?? []) if (addr.family === 'IPv4' && !addr.internal) out.push(addr.address);
  }
  return out;
}
