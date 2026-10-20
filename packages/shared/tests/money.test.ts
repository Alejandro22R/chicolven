import { describe, expect, it } from 'vitest';
import {
  adjustCentsByBp,
  applyRateAdjust,
  centsToInput,
  formatBs,
  formatRate,
  formatScaled,
  formatUsd,
  parseRateToE4,
  parseUsdToCents,
  rateChangeBp,
  usdCentsToBsCents,
} from '../src/money.ts';

describe('usdCentsToBsCents', () => {
  it('converts with exact rounding to the cent', () => {
    // $5,00 × 36,5012 = 182,506 → 182,51
    expect(usdCentsToBsCents(500, 365012)).toBe(18251);
    // $1,99 × 36,5012 = 72,637388 → 72,64
    expect(usdCentsToBsCents(199, 365012)).toBe(7264);
  });

  it('avoids float errors', () => {
    // 0,10 × 3,0000 = 0,30 exactly (0.1*3 in floats is 0.30000000000000004)
    expect(usdCentsToBsCents(10, 30000)).toBe(30);
    // $12,35 × 100,0000 = 1235,00
    expect(usdCentsToBsCents(1235, 1000000)).toBe(123500);
  });

  it('rounds half up at the cent', () => {
    // $0,01 × 0,5000 = 0,005 → 0,01
    expect(usdCentsToBsCents(1, 5000)).toBe(1);
    // $0,01 × 0,4999 = 0,004999 → 0,00
    expect(usdCentsToBsCents(1, 4999)).toBe(0);
  });

  it('rounds to multiples of 0,50', () => {
    // 182,506 → nearest 0,50 = 182,50
    expect(usdCentsToBsCents(500, 365012, { stepCents: 50, mode: 'nearest' })).toBe(18250);
    // 182,75 is exactly between 182,50 and 183,00 → 183,00
    expect(usdCentsToBsCents(500, 365500, { stepCents: 50, mode: 'nearest' })).toBe(18300);
    // up mode always goes to the next 0,50
    expect(usdCentsToBsCents(500, 365012, { stepCents: 50, mode: 'up' })).toBe(18300);
  });

  it('rounds up to whole bolívares', () => {
    expect(usdCentsToBsCents(500, 365012, { stepCents: 100, mode: 'up' })).toBe(18300);
    expect(usdCentsToBsCents(500, 365012, { stepCents: 100, mode: 'down' })).toBe(18200);
    // exact values are not bumped
    expect(usdCentsToBsCents(100, 360000, { stepCents: 100, mode: 'up' })).toBe(3600);
  });

  it('handles large values without overflow', () => {
    // $99.999,99 × 9.999,9999
    expect(usdCentsToBsCents(9_999_999, 99_999_999)).toBe(99_999_989_000);
  });

  it('rejects invalid input', () => {
    expect(() => usdCentsToBsCents(1.5, 10000)).toThrow();
    expect(() => usdCentsToBsCents(-1, 10000)).toThrow();
    expect(() => usdCentsToBsCents(1, 10000, { stepCents: 0, mode: 'up' })).toThrow();
  });
});

describe('parsing', () => {
  it('parses USD typed in different formats', () => {
    expect(parseUsdToCents('5')).toBe(500);
    expect(parseUsdToCents('5,5')).toBe(550);
    expect(parseUsdToCents('5.50')).toBe(550);
    expect(parseUsdToCents('$ 12,35')).toBe(1235);
    expect(parseUsdToCents('1.234,56')).toBe(123456);
    expect(parseUsdToCents('1,234.56')).toBe(123456);
    expect(parseUsdToCents('1.234.567')).toBe(123456700);
    expect(parseUsdToCents('0,125')).toBe(13);
    expect(parseUsdToCents(4.35)).toBe(435);
    expect(parseUsdToCents(0.1 + 0.2)).toBe(30);
  });

  it('rejects garbage', () => {
    expect(parseUsdToCents('')).toBeNull();
    expect(parseUsdToCents('abc')).toBeNull();
    expect(parseUsdToCents('-5')).toBeNull();
    expect(parseUsdToCents(',')).toBeNull();
    expect(parseUsdToCents(Number.NaN)).toBeNull();
  });

  it('parses rates with 4 decimals', () => {
    expect(parseRateToE4('36,5012')).toBe(365012);
    expect(parseRateToE4('36,50123456')).toBe(365012);
    expect(parseRateToE4('36,50125')).toBe(365013);
    expect(parseRateToE4(36.5012)).toBe(365012);
    expect(parseRateToE4('205,6789')).toBe(2056789);
  });
});

describe('formatting', () => {
  it('uses Venezuelan notation', () => {
    expect(formatScaled(123456, 2)).toBe('1.234,56');
    expect(formatScaled(5, 2)).toBe('0,05');
    expect(formatScaled(123456789, 2)).toBe('1.234.567,89');
    expect(formatUsd(550)).toBe('$ 5,50');
    expect(formatBs(18251)).toBe('Bs 182,51');
    expect(formatRate(365012)).toBe('36,50');
    expect(formatRate(365050)).toBe('36,51');
    expect(formatRate(365012, 4)).toBe('36,5012');
    expect(centsToInput(123456)).toBe('1234,56');
  });
});

describe('adjustments', () => {
  it('applies a rate margin in basis points', () => {
    expect(applyRateAdjust(365012, 0)).toBe(365012);
    expect(applyRateAdjust(365012, 200)).toBe(372312); // +2 %
    expect(applyRateAdjust(365012, -100)).toBe(361362); // -1 %
  });

  it('adjusts prices by percentage', () => {
    expect(adjustCentsByBp(1000, 1000)).toBe(1100);
    expect(adjustCentsByBp(999, 500)).toBe(1049); // 10,4895 → 10,49
  });

  it('measures rate jumps', () => {
    expect(rateChangeBp(365012, 365012)).toBe(0);
    expect(rateChangeBp(100000, 115000)).toBe(1500);
    expect(rateChangeBp(100000, 85000)).toBe(1500);
  });
});
