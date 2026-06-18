import { describe, it, expect } from 'vitest';
import {
  candidateConversionAmounts,
  greedyConversionAmount,
  buildGreedyStrategy,
  greedyOptimize,
} from './greedy.ts';
import { initialState, simulate } from '../simulate.ts';
import { computeYear } from '../computeYear.ts';
import type { Assumptions, Strategy, YearDecision } from '../types.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAssumptions(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    birthYear: 1974,
    currentAge: 60,
    horizonAge: 90,
    traditional: 1_000_000,
    roth: 200_000,
    taxable: { value: 400_000, basis: 250_000 },
    annualSpending: 60_000,
    ssMonthlyBenefitAtFRA: 3_000,
    expectedReturn: 0.06,
    discountRate: 0,
    filingStatus: 'mfj',
    state: 'WA',
    heirMarginalRate: 0.32,
    ...overrides,
  };
}

// ─── candidateConversionAmounts ────────────────────────────────────────────────

describe('candidateConversionAmounts', () => {
  it('always includes 0 as the first (smallest) candidate', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const candidates = candidateConversionAmounts(state, 0, assumptions);
    expect(candidates[0]).toBe(0);
  });

  it('is sorted in ascending order', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const candidates = candidateConversionAmounts(state, 0, assumptions);
    expect(candidates).toEqual([...candidates].sort((a, b) => a - b));
  });

  it('every candidate is within [0, state.traditional]', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const candidates = candidateConversionAmounts(state, 0, assumptions);
    candidates.forEach((c) => {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThanOrEqual(state.traditional);
    });
  });

  it('produces more than one candidate for a typical mid-conversion-window state', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const candidates = candidateConversionAmounts(state, 0, assumptions);
    expect(candidates.length).toBeGreaterThan(1);
  });
});

// ─── greedyConversionAmount ────────────────────────────────────────────────────

describe('greedyConversionAmount', () => {
  it('never converts more than the traditional balance and is non-negative', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const amount = greedyConversionAmount(state, 0, assumptions);
    expect(amount).toBeGreaterThanOrEqual(0);
    expect(amount).toBeLessThanOrEqual(state.traditional);
  });

  it('chooses an amount whose yearCost is <= the yearCost of every other candidate', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const amount = greedyConversionAmount(state, 0, assumptions);

    const order: YearDecision['withdrawalOrder'] = ['taxable', 'traditional', 'roth'];
    const chosenCost = computeYear(state, { conversionAmount: amount, withdrawalOrder: order }, assumptions, 0).yearCost;

    for (const candidate of candidateConversionAmounts(state, 0, assumptions)) {
      const cost = computeYear(state, { conversionAmount: candidate, withdrawalOrder: order }, assumptions, 0).yearCost;
      expect(chosenCost).toBeLessThanOrEqual(cost + 1e-6);
    }
  });
});

// ─── buildGreedyStrategy ────────────────────────────────────────────────────────

describe('buildGreedyStrategy', () => {
  it('produces a perYear strategy with length = horizonAge - currentAge', () => {
    const assumptions = makeAssumptions();
    const strategy = buildGreedyStrategy(assumptions);
    expect(strategy.perYear).toHaveLength(assumptions.horizonAge - assumptions.currentAge);
  });

  it('every decision has a non-negative conversion amount', () => {
    const assumptions = makeAssumptions();
    const strategy = buildGreedyStrategy(assumptions);
    strategy.perYear?.forEach((decision) => {
      expect(decision.conversionAmount).toBeGreaterThanOrEqual(0);
    });
  });
});

// ─── greedyOptimize ─────────────────────────────────────────────────────────────

describe('greedyOptimize', () => {
  it('result is at least as good as a zero-conversion strategy', () => {
    const assumptions = makeAssumptions();
    const { result: greedyResult } = greedyOptimize(assumptions);

    const numYears = assumptions.horizonAge - assumptions.currentAge;
    const zeroDecision: YearDecision = { conversionAmount: 0, withdrawalOrder: ['taxable', 'traditional', 'roth'] };
    const zeroStrategy: Strategy = { ssClaimAge: 70, perYear: new Array(numYears).fill(zeroDecision) };
    const zeroResult = simulate(zeroStrategy, assumptions);

    expect(greedyResult.totalCost).toBeLessThanOrEqual(zeroResult.totalCost);
  });

  it('returns an SS claim age in [62, 70]', () => {
    const assumptions = makeAssumptions();
    const { strategy } = greedyOptimize(assumptions);
    expect(strategy.ssClaimAge).toBeGreaterThanOrEqual(62);
    expect(strategy.ssClaimAge).toBeLessThanOrEqual(70);
  });
});
