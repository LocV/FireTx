import { describe, expect, it } from 'vitest';
import { buildBalanceGrid, dpOptimize, interpolateValue, solveDP } from './dp.ts';
import { greedyOptimize } from './greedy.ts';
import type { Assumptions } from '../types.ts';

/**
 * Kept small (9-year horizon) so the 9-claim-age x bucket-grid sweep in
 * dpOptimize stays fast enough for the test suite. Traditional balance is
 * large enough relative to spending that conversions cross at least one
 * IRMAA tier, exercising the Markov attribution path.
 */
const ASSUMPTIONS: Assumptions = {
  birthYear: 1962,
  currentAge: 63,
  horizonAge: 72,
  traditional: 1_400_000,
  roth: 150_000,
  taxable: { value: 300_000, basis: 200_000 },
  annualSpending: 80_000,
  ssMonthlyBenefitAtFRA: 2_800,
  expectedReturn: 0.05,
  discountRate: 0,
  filingStatus: 'mfj',
  state: 'WA',
  heirMarginalRate: 0.32,
};

const LARGE_BUCKET_SIZE = 100_000;

describe('buildBalanceGrid', () => {
  it('spans 0 to MAX_BALANCE in steps of bucketSize', () => {
    const grid = buildBalanceGrid(25_000);
    expect(grid[0]).toBe(0);
    expect(grid[grid.length - 1]).toBe(5_000_000);
    expect(grid[1] - grid[0]).toBe(25_000);
    expect(grid).toHaveLength(201);
  });
});

describe('interpolateValue', () => {
  const grid = [0, 100, 200];
  const values = [0, 10, 30];

  it('returns the exact value at a grid point', () => {
    expect(interpolateValue(100, grid, values)).toBe(10);
  });

  it('interpolates linearly between grid points', () => {
    expect(interpolateValue(50, grid, values)).toBe(5);
    expect(interpolateValue(150, grid, values)).toBe(20);
  });

  it('extrapolates linearly beyond the grid', () => {
    // slope between last two points is (30-10)/100 = 0.2
    expect(interpolateValue(300, grid, values)).toBeCloseTo(50, 6);
  });

  it('clamps below the grid to the first value', () => {
    expect(interpolateValue(-50, grid, values)).toBe(0);
  });
});

describe('solveDP', () => {
  it('produces a value function and policy covering every age and bucket', () => {
    const numYears = ASSUMPTIONS.horizonAge - ASSUMPTIONS.currentAge;
    const { valueFunction, policy, grid } = solveDP(ASSUMPTIONS, 67, LARGE_BUCKET_SIZE);

    expect(valueFunction).toHaveLength(numYears + 1);
    expect(policy).toHaveLength(numYears);
    for (const row of valueFunction) expect(row).toHaveLength(grid.length);
    for (const row of policy) expect(row).toHaveLength(grid.length);

    // Value function entries are non-negative costs.
    for (const row of valueFunction) {
      for (const v of row) expect(v).toBeGreaterThanOrEqual(0);
    }
  }, 20_000);
});

describe('dpOptimize', () => {
  it('dpCostAtStart is close to the forward-simulated totalCost', () => {
    const { result, dpCostAtStart } = dpOptimize(ASSUMPTIONS, LARGE_BUCKET_SIZE);
    const relativeDiff = Math.abs(result.totalCost - dpCostAtStart) / result.totalCost;
    expect(relativeDiff).toBeLessThan(0.05);
  }, 20_000);

  it('is at least as good as the greedy optimizer (within 0.1% rounding)', () => {
    const { result: dpResult } = dpOptimize(ASSUMPTIONS, LARGE_BUCKET_SIZE);
    const { result: greedyResult } = greedyOptimize(ASSUMPTIONS);
    expect(dpResult.totalCost).toBeLessThanOrEqual(greedyResult.totalCost * 1.001);
  }, 20_000);

  it('halving the bucket size changes totalCost by less than 1%', () => {
    const coarse = dpOptimize(ASSUMPTIONS, 100_000);
    const fine = dpOptimize(ASSUMPTIONS, 50_000);
    const delta = Math.abs(coarse.result.totalCost - fine.result.totalCost);
    expect(delta / fine.result.totalCost).toBeLessThan(0.01);
  }, 30_000);

  it('Markov attribution: attributed IRMAA total ~= paid IRMAA total', () => {
    // attributedIrmaaTotal - paidIrmaaTotal == IRMAA attributed to the final
    // two simulation years' MAGI, which would be PAID two years after the
    // horizon ends (outside the trace). That boundary term is at most ~2
    // years of MFJ first-tier surcharges (~$3.7k/yr/person x 2 people x 2
    // years), hence the wider tolerance vs. a mid-simulation check.
    const { result } = dpOptimize(ASSUMPTIONS, LARGE_BUCKET_SIZE);
    const attributedIrmaaTotal = result.trace.reduce((sum, r) => sum + r.irmaaAttributed, 0);
    const paidIrmaaTotal = result.trace.reduce((sum, r) => sum + r.irmaa, 0);
    expect(Math.abs(attributedIrmaaTotal - paidIrmaaTotal)).toBeLessThan(20_000);
  }, 20_000);
});
