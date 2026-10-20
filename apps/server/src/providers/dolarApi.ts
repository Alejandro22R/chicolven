import { z } from 'zod';
import { parseRateToE4 } from '@chicolven/shared/money';
import { toCaracasDate } from '../services/time.ts';
import { assertSaneRate, fetchText, type RateProvider, type RateQuote } from './types.ts';

export const DOLARAPI_URL = 'https://ve.dolarapi.com/v1/dolares/oficial';

const schema = z.object({
  promedio: z.union([z.number(), z.string()]),
  fechaActualizacion: z.string().optional(),
});

/** Community API that mirrors the BCV official rate: { promedio, fechaActualizacion }. */
export function parseDolarApi(json: unknown): RateQuote {
  const data = schema.parse(json);
  const rateE4 = assertSaneRate(parseRateToE4(data.promedio), 'DolarApi');
  return { source: 'dolarapi', rate_e4: rateE4, effective_date: toCaracasDate(data.fechaActualizacion) };
}

export function dolarApiProvider(): RateProvider {
  return {
    id: 'dolarapi',
    label: 'DolarApi (ve.dolarapi.com)',
    async fetch(signal) {
      return parseDolarApi(JSON.parse(await fetchText(DOLARAPI_URL, { signal })));
    },
  };
}
