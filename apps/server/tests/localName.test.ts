import { describe, expect, it } from 'vitest';
import { replyTo } from '../src/services/localName.ts';

const host = 'chicolven.local';
const ips = ['192.168.1.20'];

describe('mDNS replies', () => {
  it('answers one-shot queries (random source port) directly, echoing id and question', () => {
    const r = replyTo(host, { id: 77, questions: [{ name: 'Chicolven.local', type: 'A' }] }, { address: '192.168.1.50', port: 54321 }, ips);
    expect(r?.to).toEqual({ address: '192.168.1.50', port: 54321 });
    expect(r?.packet.id).toBe(77);
    expect(r?.packet.questions).toHaveLength(1);
    expect(r?.packet.answers[0]).toMatchObject({ name: host, type: 'A', data: '192.168.1.20' });
  });

  it('answers QU questions directly and normal ones to the multicast group', () => {
    const qu = replyTo(host, { questions: [{ name: host, type: 'A', class: 'UNKNOWN_32769' }] }, { address: '192.168.1.51', port: 5353 }, ips);
    expect(qu?.to).toEqual({ address: '192.168.1.51', port: 5353 });
    const multicast = replyTo(host, { questions: [{ name: host, type: 'A', class: 'IN' }] }, { address: '192.168.1.51', port: 5353 }, ips);
    expect(multicast?.to).toBeUndefined();
    expect(multicast?.via).toBe('192.168.1.20');
  });

  it('ignores other names and record types', () => {
    expect(replyTo(host, { questions: [{ name: 'impresora.local', type: 'A' }] }, undefined, ips)).toBeNull();
    expect(replyTo(host, { questions: [{ name: host, type: 'AAAA' }] }, undefined, ips)).toBeNull();
  });
});
