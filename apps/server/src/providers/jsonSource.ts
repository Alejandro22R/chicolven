import type { CustomRateSource } from '@chicolven/shared/types';
import { parseRateToE4 } from '@chicolven/shared/money';
import { toCaracasDate } from '../services/time.ts';
import { assertSaneRate, fetchText, readPath, type RateProvider, type RateQuote } from './types.ts';

/** Reads a rate from any JSON document using the configured dot paths. */
export function parseCustomJson(json: unknown, source: CustomRateSource): RateQuote {
  const raw = readPath(json, source.rate_path);
  if (typeof raw !== 'number' && typeof raw !== 'string') {
    throw new Error(`${source.name}: no se encontró "${source.rate_path}"`);
  }
  const rateE4 = assertSaneRate(parseRateToE4(raw), source.name);
  const dateRaw = source.date_path ? readPath(json, source.date_path) : null;
  return {
    source: `custom:${source.name}`,
    rate_e4: rateE4,
    effective_date: typeof dateRaw === 'string' ? toCaracasDate(dateRaw) : null,
  };
}

export function jsonSourceProvider(source: CustomRateSource): RateProvider {
  return {
    id: `custom:${source.name}`,
    label: source.name,
    async fetch(signal) {
      return parseCustomJson(JSON.parse(await fetchText(source.url, { signal })), source);
    },
  };
}
