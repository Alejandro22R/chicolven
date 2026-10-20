import { parseRateToE4 } from '@chicolven/shared/money';
import { assertSaneRate, fetchText, type RateProvider, type RateQuote } from './types.ts';

export const BCV_URL = 'https://www.bcv.org.ve/';

/**
 * Extracts the USD rate and its "Fecha Valor" from the BCV home page.
 * The page has a block like:
 *   <div id="dolar"> ... <strong> 36,57310000 </strong> ...
 *   <span class="date-display-single" content="2024-05-13T00:00:00-04:00">
 * If the BCV changes its markup this is the only function to adjust.
 */
export function parseBcvHtml(html: string): RateQuote {
  const start = html.search(/id=["']dolar["']/i);
  if (start < 0) throw new Error('BCV: no se encontró el bloque del dólar');
  const block = html.slice(start, start + 3000);
  const match = block.match(/<strong>\s*([\d.,]+)\s*<\/strong>/i);
  if (!match) throw new Error('BCV: no se encontró el valor del dólar');
  const rateE4 = assertSaneRate(parseRateToE4(match[1]!), 'BCV');
  const dateMatch = html.match(/date-display-single[^>]*content=["'](\d{4}-\d{2}-\d{2})/i);
  return { source: 'bcv', rate_e4: rateE4, effective_date: dateMatch ? dateMatch[1]! : null };
}

export function bcvProvider(opts: { insecureTls: () => boolean }): RateProvider {
  return {
    id: 'bcv',
    label: 'BCV (bcv.org.ve)',
    async fetch(signal) {
      let html: string;
      try {
        html = await fetchText(BCV_URL, { signal, insecure: false });
      } catch (err) {
        // The BCV site has served broken certificate chains; retry relaxing TLS only if allowed.
        // The value is still validated (range + jump check) before it is used.
        const code = (err as NodeJS.ErrnoException).code ?? '';
        if (!opts.insecureTls() || !/CERT|SSL|SIGNATURE|UNABLE_TO|SELF_SIGNED/i.test(code + String(err))) throw err;
        html = await fetchText(BCV_URL, { signal, insecure: true });
      }
      return parseBcvHtml(html);
    },
  };
}
