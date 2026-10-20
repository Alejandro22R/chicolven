import { STORE } from '@chicolven/shared/brand';

const dateFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: STORE.timezone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: STORE.timezone, hour: '2-digit', hourCycle: 'h23' });

/** Calendar date (YYYY-MM-DD) in Caracas for the given instant. */
export function caracasDate(at: Date = new Date()): string {
  return dateFmt.format(at);
}

/** Hour of day (0-23) in Caracas. */
export function caracasHour(at: Date = new Date()): number {
  return Number(hourFmt.format(at));
}

/** Accepts "YYYY-MM-DD" or any ISO timestamp and returns the Caracas calendar date, or null. */
export function toCaracasDate(value: string | null | undefined): string | null {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : caracasDate(date);
}
