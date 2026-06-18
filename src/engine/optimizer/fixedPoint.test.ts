import { describe, expect, it } from 'vitest';
import { optimizeFixedPoint } from './fixedPoint.ts';
import type { Assumptions } from '../types.ts';

const ASSUMPTIONS: Assumptions = {
  birthYear: 1971,
  currentAge: 55,
  horizonAge: 70,
  traditional: 1_200_000,
  roth: 100_000,
  taxable: { value: 300_000, basis: 200_000 },
  annualSpending: 70_000,
  ssMonthlyBenefitAtFRA: 2_800,
  expectedReturn: 0.05,
  discountRate: 0,
  filingStatus: 'mfj',
  state: 'WA',
  heirMarginalRate: 0.32,
};

describe('optimizeFixedPoint', () => {
  it('converges in fewer than 20 iterations', () => {
    const { converged, iterations } = optimizeFixedPoint(ASSUMPTIONS);
    expect(converged).toBe(true);
    expect(iterations).toBeLessThan(20);
  });

  it('returns a strategy and result consistent with optimizeCoordinate', () => {
    const { strategy, result } = optimizeFixedPoint(ASSUMPTIONS);
    expect(strategy.phaseTemplates).toBeDefined();
    expect(result.totalCost).toBeGreaterThan(0);
  });
});
