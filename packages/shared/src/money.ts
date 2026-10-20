/**
 * Money utilities. Every price calculation in the app goes through this module.
 *
 * - USD amounts are integer cents (`Cents`).
 * - Bs amounts are integer céntimos (`Cents` as well).
 * - Exchange rates are integers scaled by 10_000 (`RateE4`), i.e. 4 decimals.
 *
 * Floats are never used for money: conversions use BigInt and a single rounding step.
 */

export type Cents = number;
export type RateE4 = number;

export const RATE_SCALE = 10_000;

export type RoundingMode = 'nearest' | 'up' | 'down';

export interface RoundingOptions {
  /** Round the Bs amount to a multiple of this many céntimos (1 = 0,01; 50 = 0,50; 100 = 1,00). */
  stepCents: number;
  mode: RoundingMode;
}

export const DEFAULT_ROUNDING: RoundingOptions = { stepCents: 1, mode: 'nearest' };

function assertInt(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) throw new RangeError(`${label} must be a safe integer, got ${value}`);
}

/** Divides a non-negative BigInt by `divisor`, rounding according to `mode`. */
function divRound(value: bigint, divisor: bigint, mode: RoundingMode): bigint {
  const q = value / divisor;
  const r = value % divisor;
  if (r === 0n) return q;
  if (mode === 'up') return q + 1n;
  if (mode === 'down') return q;
  return r * 2n >= divisor ? q + 1n : q;
}

/**
 * Converts a USD amount to Bs: round(usd × rate) to the configured step.
 * The exact product is computed first, then rounded once.
 */
export function usdCentsToBsCents(
  usdCents: Cents,
  rateE4: RateE4,
  rounding: RoundingOptions = DEFAULT_ROUNDING,
): Cents {
  assertInt(usdCents, 'usdCents');
  assertInt(rateE4, 'rateE4');
  assertInt(rounding.stepCents, 'stepCents');
  if (usdCents < 0 || rateE4 < 0) throw new RangeError('Amounts and rates must be non-negative');
  if (rounding.stepCents < 1) throw new RangeError('stepCents must be >= 1');
  const exact = BigInt(usdCents) * BigInt(rateE4); // céntimos × 10_000
  const unit = BigInt(RATE_SCALE) * BigInt(rounding.stepCents);
  return Number(divRound(exact, unit, rounding.mode) * BigInt(rounding.stepCents));
}

/** Applies a percentage adjustment expressed in basis points (100 bp = 1 %) to a rate. */
export function applyRateAdjust(rateE4: RateE4, adjustBp: number): RateE4 {
  assertInt(rateE4, 'rateE4');
  assertInt(adjustBp, 'adjustBp');
  if (adjustBp === 0) return rateE4;
  const factor = 10_000n + BigInt(adjustBp);
  if (factor < 0n) throw new RangeError('Adjustment below -100 %');
  return Number(divRound(BigInt(rateE4) * factor, 10_000n, 'nearest'));
}

/** Applies a percentage change (in basis points) to a USD price, rounding to the cent. */
export function adjustCentsByBp(cents: Cents, bp: number): Cents {
  assertInt(cents, 'cents');
  assertInt(bp, 'bp');
  const factor = 10_000n + BigInt(bp);
  if (factor < 0n) throw new RangeError('Adjustment below -100 %');
  return Number(divRound(BigInt(cents) * factor, 10_000n, 'nearest'));
}

/**
 * Parses a decimal string typed by a person ("5,50", "5.50", "1.234,56", "1,234.56", "36,1234")
 * into an integer scaled by 10^decimals. Extra decimals are rounded half-up.
 * Returns null when the input is not a valid non-negative number.
 */
export function parseDecimal(input: string | number, decimals: number): number | null {
  let text: string;
  if (typeof input === 'number') {
    if (!Number.isFinite(input) || input < 0) return null;
    // toFixed avoids exponent notation; one extra digit keeps half-up rounding below.
    text = input.toFixed(Math.min(decimals + 1, 20));
  } else {
    text = input.trim().replace(/\s+/g, '').replace(/^(\$|bs\.?|usd|ves)/i, '');
  }
  if (text === '' || !/^[\d.,]+$/.test(text)) return null;

  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  let intPart: string;
  let fracPart: string;
  if (lastDot >= 0 && lastComma >= 0) {
    const sep = lastDot > lastComma ? '.' : ',';
    const thousands = sep === '.' ? ',' : '.';
    const idx = text.lastIndexOf(sep);
    intPart = text.slice(0, idx).split(thousands).join('');
    fracPart = text.slice(idx + 1);
  } else {
    const sep = lastComma >= 0 ? ',' : '.';
    const parts = text.split(sep);
    if (parts.length > 2) {
      // "1.234.567" → thousands separators only
      intPart = parts.join('');
      fracPart = '';
    } else {
      intPart = parts[0] ?? '';
      fracPart = parts[1] ?? '';
    }
  }
  if (!/^\d*$/.test(intPart) || !/^\d*$/.test(fracPart)) return null;
  if (intPart === '' && fracPart === '') return null;

  const padded = (fracPart + '0'.repeat(decimals + 1)).slice(0, decimals + 1);
  const base = BigInt((intPart || '0') + padded.slice(0, decimals));
  const roundUp = Number(padded[decimals]) >= 5;
  const result = Number(base + (roundUp ? 1n : 0n));
  return Number.isSafeInteger(result) ? result : null;
}

export function parseUsdToCents(input: string | number): Cents | null {
  return parseDecimal(input, 2);
}

export function parseRateToE4(input: string | number): RateE4 | null {
  return parseDecimal(input, 4);
}

/** Formats an integer scaled by 10^decimals using Venezuelan notation: 1.234,56 */
export function formatScaled(value: number, decimals: number): string {
  assertInt(value, 'value');
  const negative = value < 0;
  const digits = Math.abs(value).toString().padStart(decimals + 1, '0');
  const intDigits = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  const grouped = intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (negative ? '-' : '') + grouped + (decimals > 0 ? ',' + frac : '');
}

export function formatCents(cents: Cents): string {
  return formatScaled(cents, 2);
}

export function formatUsd(cents: Cents): string {
  return '$ ' + formatCents(cents);
}

export function formatBs(cents: Cents): string {
  return 'Bs ' + formatCents(cents);
}

/** Formats a rate with 2 or 4 decimals (rounded). */
export function formatRate(rateE4: RateE4, decimals: 2 | 4 = 2): string {
  if (decimals === 4) return formatScaled(rateE4, 4);
  return formatScaled(Number(divRound(BigInt(rateE4), 100n, 'nearest')), 2);
}

/** Plain editable representation for inputs: "5,50" */
export function centsToInput(cents: Cents): string {
  return formatScaled(cents, 2).replace(/\./g, '');
}

export function rateToInput(rateE4: RateE4): string {
  return formatScaled(rateE4, 4).replace(/\./g, '');
}

/** Relative change between two rates in basis points (absolute value). */
export function rateChangeBp(previousE4: RateE4, nextE4: RateE4): number {
  if (previousE4 <= 0) return 0;
  return Math.round((Math.abs(nextE4 - previousE4) * 10_000) / previousE4);
}
