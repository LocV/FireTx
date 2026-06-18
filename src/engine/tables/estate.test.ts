import { describe, it, expect } from 'vitest';
import { federalEstateTax, waEstateTax, waEstateExemption, federalEstateExemption } from './estate.ts';

describe('federalEstateTax', () => {
  it('returns 0 for zero taxable estate', () => {
    expect(federalEstateTax(0)).toBe(0);
  });

  it('returns 0 for negative input', () => {
    expect(federalEstateTax(-100)).toBe(0);
  });

  it('applies flat 40% rate', () => {
    expect(federalEstateTax(1_000_000)).toBeCloseTo(400_000, 0);
    expect(federalEstateTax(5_000_000)).toBeCloseTo(2_000_000, 0);
  });
});

describe('waEstateTax', () => {
  it('returns 0 for zero taxable amount', () => {
    expect(waEstateTax(0)).toBe(0);
  });

  it('returns 0 for negative input', () => {
    expect(waEstateTax(-1)).toBe(0);
  });

  it('applies 10% on first $1M above exemption', () => {
    expect(waEstateTax(1_000_000)).toBeCloseTo(100_000, 0);
  });

  it('correctly straddles 14% bracket', () => {
    // $2M: 10% on first 1M + 14% on next 1M
    const expected = 1_000_000 * 0.10 + 1_000_000 * 0.14;
    expect(waEstateTax(2_000_000)).toBeCloseTo(expected, 0);
  });

  it('applies graduated rates correctly for large estate', () => {
    // $3M: 10% on 1M + 14% on 1M + 15% on 1M
    const expected = 1_000_000 * 0.10 + 1_000_000 * 0.14 + 1_000_000 * 0.15;
    expect(waEstateTax(3_000_000)).toBeCloseTo(expected, 0);
  });
});

describe('waEstateExemption', () => {
  it('returns $3M for 2026 and beyond', () => {
    expect(waEstateExemption(2026)).toBe(3_000_000);
    expect(waEstateExemption(2030)).toBe(3_000_000);
  });

  it('returns pre-freeze value for years before 2026', () => {
    expect(waEstateExemption(2025)).toBeGreaterThan(3_000_000);
  });
});

describe('federalEstateExemption', () => {
  it('returns ~$15M for single in 2026', () => {
    expect(federalEstateExemption(2026, 'single')).toBeCloseTo(15_000_000, -3);
  });

  it('returns ~$30M for MFJ in 2026', () => {
    expect(federalEstateExemption(2026, 'mfj')).toBeCloseTo(30_000_000, -3);
  });

  it('inflates with year', () => {
    expect(federalEstateExemption(2030, 'single')).toBeGreaterThan(
      federalEstateExemption(2026, 'single'),
    );
  });
});
