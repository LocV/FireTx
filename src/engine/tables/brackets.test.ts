import { describe, it, expect } from 'vitest';
import { federalOrdinaryTax, federalLtcgTax, standardDeduction, ordinaryBracketEdges, ltcgBracketEdges } from './brackets.ts';

describe('federalOrdinaryTax', () => {
  it('returns 0 for zero income', () => {
    expect(federalOrdinaryTax(0, 2026, 'single')).toBe(0);
  });

  it('applies 10% bracket at bottom', () => {
    // $5,000 in the 10% bracket
    expect(federalOrdinaryTax(5_000, 2026, 'single')).toBeCloseTo(500, 0);
  });

  it('correctly applies graduated brackets for single filer', () => {
    // ~$50,000: 10% on first $11,925, 12% on $36,550, then 22% on remainder
    const tax = federalOrdinaryTax(50_000, 2026, 'single');
    const expected = 11_925 * 0.10 + (48_475 - 11_925) * 0.12 + (50_000 - 48_475) * 0.22;
    expect(tax).toBeCloseTo(expected, 1);
  });

  it('bracket boundary: just below 22% threshold uses 12%', () => {
    const atBoundary = federalOrdinaryTax(48_475, 2026, 'single');
    const belowBoundary = federalOrdinaryTax(48_474, 2026, 'single');
    // Going from 48474 to 48475, the last dollar is taxed at 12%
    expect(atBoundary - belowBoundary).toBeCloseTo(0.12, 2);
  });

  it('bracket boundary: first dollar above 22% threshold applies 22%', () => {
    const atBoundary = federalOrdinaryTax(48_476, 2026, 'single');
    const belowBoundary = federalOrdinaryTax(48_475, 2026, 'single');
    expect(atBoundary - belowBoundary).toBeCloseTo(0.22, 2);
  });

  it('computes MFJ brackets', () => {
    const tax = federalOrdinaryTax(100_000, 2026, 'mfj');
    // 10% on 23850, 12% on (96950-23850), then 22% on remainder
    const expected = 23_850 * 0.10 + (96_950 - 23_850) * 0.12 + (100_000 - 96_950) * 0.22;
    expect(tax).toBeCloseTo(expected, 1);
  });
});

describe('federalLtcgTax', () => {
  it('returns 0 when stacked total stays in 0% zone (MFJ)', () => {
    // MFJ 0% threshold: $96,700. ordinary=40k, ltcg=20k → stacked=60k, still 0%
    expect(federalLtcgTax(20_000, 40_000, 2026, 'mfj')).toBe(0);
  });

  it('applies 15% when stacked total crosses 0% threshold (MFJ)', () => {
    // ordinary=90k, ltcg=20k → stacked bottom=90k, top=110k. 6700 in 0%, rest at 15%
    const tax = federalLtcgTax(20_000, 90_000, 2026, 'mfj');
    const in15pct = 90_000 + 20_000 - 96_700;
    expect(tax).toBeCloseTo(in15pct * 0.15, 1);
  });

  it('applies 15% on full amount when ordinary income already above 0% threshold', () => {
    // ordinary=200k (above 96700), ltcg=20k → full 20k at 15%
    expect(federalLtcgTax(20_000, 200_000, 2026, 'mfj')).toBeCloseTo(3_000, 1);
  });

  it('returns 0 for zero LTCG', () => {
    expect(federalLtcgTax(0, 100_000, 2026, 'single')).toBe(0);
  });

  it('straddles 0%/15% boundary for single filer', () => {
    // Single 0% threshold: $48,350. ordinary=40k, ltcg=20k → stacked=60k
    const tax = federalLtcgTax(20_000, 40_000, 2026, 'single');
    const in15pct = 60_000 - 48_350;
    expect(tax).toBeCloseTo(in15pct * 0.15, 1);
  });
});

describe('ordinaryBracketEdges', () => {
  it('returns the 2026 single edges in ascending order', () => {
    const edges = ordinaryBracketEdges(2026, 'single');
    expect(edges[0]).toEqual({ min: 0, rate: 0.10 });
    expect(edges[2]).toEqual({ min: 48_475, rate: 0.22 });
    for (let i = 1; i < edges.length; i++) {
      expect(edges[i].min).toBeGreaterThan(edges[i - 1].min);
    }
  });

  it('inflates edges for later years', () => {
    const edges2026 = ordinaryBracketEdges(2026, 'mfj');
    const edges2030 = ordinaryBracketEdges(2030, 'mfj');
    expect(edges2030[1].min).toBeGreaterThan(edges2026[1].min);
  });
});

describe('ltcgBracketEdges', () => {
  it('returns the 2026 MFJ LTCG edges in ascending order', () => {
    const edges = ltcgBracketEdges(2026, 'mfj');
    expect(edges[0]).toEqual({ min: 0, rate: 0.0 });
    expect(edges[1]).toEqual({ min: 96_700, rate: 0.15 });
    expect(edges[2]).toEqual({ min: 600_050, rate: 0.20 });
  });

  it('inflates edges for later years', () => {
    const edges2026 = ltcgBracketEdges(2026, 'single');
    const edges2030 = ltcgBracketEdges(2030, 'single');
    expect(edges2030[1].min).toBeGreaterThan(edges2026[1].min);
  });
});

describe('standardDeduction', () => {
  it('returns base deduction for single under 65', () => {
    expect(standardDeduction(2026, 'single', 60)).toBeCloseTo(15_000, 0);
  });

  it('adds over-65 add-on for single filer age 65+', () => {
    expect(standardDeduction(2026, 'single', 65)).toBeCloseTo(15_000 + 2_000, 0);
  });

  it('MFJ base deduction for couple both under 65', () => {
    expect(standardDeduction(2026, 'mfj', 60)).toBeCloseTo(30_000, 0);
  });

  it('MFJ adds 2× over-65 add-on when both spouses are 65+', () => {
    // Per task spec: standardDeduction(2026, 'mfj', 66) → base + both spouses add-on
    expect(standardDeduction(2026, 'mfj', 66)).toBeCloseTo(30_000 + 2 * 1_600, 0);
  });

  it('inflates with year', () => {
    const d2026 = standardDeduction(2026, 'single', 60);
    const d2030 = standardDeduction(2030, 'single', 60);
    expect(d2030).toBeGreaterThan(d2026);
  });
});
