import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseBcvHtml } from '../src/providers/bcvScrape.ts';
import { parseDolarApi } from '../src/providers/dolarApi.ts';
import { parseCustomJson } from '../src/providers/jsonSource.ts';

const html = fs.readFileSync(path.join(__dirname, 'fixtures', 'bcv.html'), 'utf8');

describe('BCV scraping', () => {
  it('reads the USD block (not the EUR one) and the "Fecha Valor"', () => {
    expect(parseBcvHtml(html)).toEqual({ source: 'bcv', rate_e4: 2056789, effective_date: '2026-10-21' });
  });

  it('fails loudly when the markup changes', () => {
    expect(() => parseBcvHtml('<html>mantenimiento</html>')).toThrow(/dólar/);
    expect(() => parseBcvHtml('<div id="dolar"><strong>abc</strong></div>')).toThrow();
  });

  it('rejects absurd values', () => {
    expect(() => parseBcvHtml('<div id="dolar"><strong> 0,0000 </strong></div>')).toThrow(/rango/);
  });
});

describe('DolarApi', () => {
  it('parses promedio and converts the update time to a Caracas date', () => {
    const quote = parseDolarApi({ fuente: 'oficial', promedio: 205.6789, fechaActualizacion: '2026-10-20T02:00:00.000Z' });
    // 02:00 UTC is still the 19th in Caracas (UTC-4)
    expect(quote).toEqual({ source: 'dolarapi', rate_e4: 2056789, effective_date: '2026-10-19' });
  });

  it('rejects unexpected payloads', () => {
    expect(() => parseDolarApi({ error: 'x' })).toThrow();
    expect(() => parseDolarApi({ promedio: -3 })).toThrow();
  });
});

describe('custom JSON source', () => {
  it('follows the configured paths', () => {
    const quote = parseCustomJson(
      { data: { rates: [{ usd: '205,67' }] }, date: '2026-10-20' },
      { name: 'repo', url: 'https://example.com/rate.json', rate_path: 'data.rates.0.usd', date_path: 'date' },
    );
    expect(quote).toEqual({ source: 'custom:repo', rate_e4: 2056700, effective_date: '2026-10-20' });
  });

  it('reports a missing path', () => {
    expect(() => parseCustomJson({}, { name: 'x', url: 'https://e.com', rate_path: 'a.b' })).toThrow(/a\.b/);
  });
});
