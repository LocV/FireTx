import { describe, it, expect } from 'vitest';
import { annualIrmaaSurcharge, irmaaTierThresholds } from './irmaa.ts';

// 2026 single thresholds: 106k, 133k, 167k, 200k, 500k
// 2026 MFJ thresholds:    212k, 266k, 334k, 400k, 750k
// Surcharges:             0, 850, 2000, 3200, 4000, 4800

describe('annualIrmaaSurcharge — single 2026 cliff tests', () => {
  it('just below first tier: $0 surcharge', () => {
    expect(annualIrmaaSurcharge(105_999, 2026, 'single')).toBe(0);
  });

  it('at first tier boundary: tier 1 surcharge', () => {
    expect(annualIrmaaSurcharge(106_000, 2026, 'single')).toBeCloseTo(850, 0);
  });

  it('one dollar over first tier: still tier 1', () => {
    expect(annualIrmaaSurcharge(106_001, 2026, 'single')).toBeCloseTo(850, 0);
  });

  it('just below second tier: tier 1 surcharge', () => {
    expect(annualIrmaaSurcharge(132_999, 2026, 'single')).toBeCloseTo(850, 0);
  });

  it('at second tier boundary: tier 2 surcharge', () => {
    expect(annualIrmaaSurcharge(133_000, 2026, 'single')).toBeCloseTo(2_000, 0);
  });

  it('just above second tier: tier 2 surcharge', () => {
    expect(annualIrmaaSurcharge(133_001, 2026, 'single')).toBeCloseTo(2_000, 0);
  });

  it('at third tier boundary: tier 3 surcharge', () => {
    expect(annualIrmaaSurcharge(167_000, 2026, 'single')).toBeCloseTo(3_200, 0);
  });

  it('at fourth tier boundary: tier 4 surcharge', () => {
    expect(annualIrmaaSurcharge(200_000, 2026, 'single')).toBeCloseTo(4_000, 0);
  });

  it('at fifth tier boundary: tier 5 surcharge', () => {
    expect(annualIrmaaSurcharge(500_000, 2026, 'single')).toBeCloseTo(4_800, 0);
  });
});

describe('annualIrmaaSurcharge — MFJ 2026 cliff tests', () => {
  it('just below first MFJ tier: $0 surcharge', () => {
    expect(annualIrmaaSurcharge(211_999, 2026, 'mfj')).toBe(0);
  });

  it('at first MFJ tier boundary: tier 1 surcharge', () => {
    expect(annualIrmaaSurcharge(212_000, 2026, 'mfj')).toBeCloseTo(850, 0);
  });

  it('one dollar over first MFJ tier: tier 1 surcharge', () => {
    expect(annualIrmaaSurcharge(212_001, 2026, 'mfj')).toBeCloseTo(850, 0);
  });

  it('at second MFJ tier: tier 2 surcharge', () => {
    expect(annualIrmaaSurcharge(266_000, 2026, 'mfj')).toBeCloseTo(2_000, 0);
  });
});

describe('irmaaTierThresholds', () => {
  it('returns the 5 single tier thresholds for 2026 in ascending order', () => {
    const thresholds = irmaaTierThresholds(2026, 'single');
    expect(thresholds).toEqual([106_000, 133_000, 167_000, 200_000, 500_000]);
  });

  it('returns the 5 MFJ tier thresholds for 2026 in ascending order', () => {
    const thresholds = irmaaTierThresholds(2026, 'mfj');
    expect(thresholds).toEqual([212_000, 266_000, 334_000, 400_000, 750_000]);
  });

  it('inflates thresholds for later years', () => {
    const t2026 = irmaaTierThresholds(2026, 'single');
    const t2030 = irmaaTierThresholds(2030, 'single');
    expect(t2030[0]).toBeGreaterThan(t2026[0]);
  });
});

describe('annualIrmaaSurcharge — projection', () => {
  it('thresholds inflate over time (2030 threshold higher than 2026)', () => {
    // Below 2026 threshold but same nominal — should be $0 in later year
    const surcharge2026 = annualIrmaaSurcharge(106_000, 2026, 'single');
    const surcharge2030 = annualIrmaaSurcharge(106_000, 2030, 'single');
    expect(surcharge2026).toBeCloseTo(850, 0);
    // 106k < inflated 2030 threshold, so still $0
    expect(surcharge2030).toBe(0);
  });
});
