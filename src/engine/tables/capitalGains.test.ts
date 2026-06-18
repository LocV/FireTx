import { describe, it, expect } from 'vitest';
import { waCapitalGainsTax } from './capitalGains.ts';

// 2026 exemption: $262,000; rate 7% up to $1M above exemption; 9.9% above $1M

describe('waCapitalGainsTax', () => {
  it('returns 0 when gains are below exemption', () => {
    expect(waCapitalGainsTax(100_000, 2026)).toBe(0);
  });

  it('returns 0 exactly at the exemption', () => {
    expect(waCapitalGainsTax(262_000, 2026)).toBe(0);
  });

  it('applies 7% on gains just above the exemption', () => {
    // $263,000 gain → $1,000 taxable at 7%
    expect(waCapitalGainsTax(263_000, 2026)).toBeCloseTo(70, 0);
  });

  it('applies 7% on $500k gain (task example)', () => {
    // taxable = 500k - 262k = 238k; 238k × 7% ≈ $16,660
    expect(waCapitalGainsTax(500_000, 2026)).toBeCloseTo(238_000 * 0.07, 0);
  });

  it('applies 7% up to $1M, 9.9% above (task example)', () => {
    // $1.5M gain: taxable = 1.5M - 262k = 1.238M
    // 7% on 1M + 9.9% on 238k
    const expected = 1_000_000 * 0.07 + 238_000 * 0.099;
    expect(waCapitalGainsTax(1_500_000, 2026)).toBeCloseTo(expected, 0);
  });

  it('$1M above exemption boundary — just below triggers only 7%', () => {
    // exactly $1M of taxable gain = 262k + 1M = $1,262,000 total
    expect(waCapitalGainsTax(1_262_000, 2026)).toBeCloseTo(1_000_000 * 0.07, 0);
  });

  it('$1M above exemption boundary — one dollar over triggers 9.9% on excess', () => {
    const taxAtBoundary = waCapitalGainsTax(1_262_000, 2026);
    const taxOneDollarOver = waCapitalGainsTax(1_262_001, 2026);
    expect(taxOneDollarOver - taxAtBoundary).toBeCloseTo(0.099, 3);
  });

  it('exemption inflates with year', () => {
    // In 2030, exemption is higher, so same gain → less tax
    expect(waCapitalGainsTax(300_000, 2030)).toBeLessThan(waCapitalGainsTax(300_000, 2026));
  });
});
