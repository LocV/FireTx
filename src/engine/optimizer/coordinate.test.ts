import { describe, expect, it } from 'vitest';
import { optimizeCoordinate } from './coordinate.ts';
import { simulate } from '../simulate.ts';
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

describe('optimizeCoordinate', () => {
  it('returns a strategy, result, and a positive iteration count', () => {
    const { strategy, result, iterations } = optimizeCoordinate(ASSUMPTIONS);

    expect(iterations).toBeGreaterThan(0);
    expect(strategy.phaseTemplates).toBeDefined();
    expect(strategy.ssClaimAge).toBeGreaterThanOrEqual(62);
    expect(strategy.ssClaimAge).toBeLessThanOrEqual(70);
    expect(result.totalCost).toBeGreaterThan(0);
  });

  it('result matches simulating the returned strategy directly', () => {
    const { strategy, result } = optimizeCoordinate(ASSUMPTIONS);
    const replay = simulate(strategy, ASSUMPTIONS);
    expect(replay.totalCost).toBeCloseTo(result.totalCost, 6);
  });

  it('is at least as good as the all-moderate, default-claim-age baseline', () => {
    const { result } = optimizeCoordinate(ASSUMPTIONS);
    const baseline = simulate(
      {
        ssClaimAge: 67,
        phaseTemplates: {
          PRE_55: 'moderate',
          RULE_OF_55: 'moderate',
          PENALTY_FREE: 'moderate',
          MEDICARE_ERA: 'moderate',
          RMD_ERA: 'moderate',
        },
      },
      ASSUMPTIONS,
    );
    expect(result.totalCost).toBeLessThanOrEqual(baseline.totalCost);
  });
});
