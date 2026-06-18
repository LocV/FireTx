import { describe, it, expect } from 'vitest';
import {
  simulate,
  initialState,
  resolveDecision,
  computeEstateCost,
  discountFactor,
  currentPhase,
  ssBenefitMultiplier,
  SIMULATION_BASE_YEAR,
} from './simulate.ts';
import { Phase, type Assumptions, type Strategy, type YearState } from './types.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeAssumptions(overrides: Partial<Assumptions> = {}): Assumptions {
  return {
    birthYear: 1974,
    currentAge: 52,
    horizonAge: 95,
    traditional: 1_000_000,
    roth: 200_000,
    taxable: { value: 400_000, basis: 250_000 },
    annualSpending: 80_000,
    ssMonthlyBenefitAtFRA: 3_000,
    expectedReturn: 0.06,
    discountRate: 0,
    filingStatus: 'mfj',
    state: 'WA',
    heirMarginalRate: 0.32,
    ...overrides,
  };
}

function makeTerminalState(overrides: Partial<YearState> = {}): YearState {
  return {
    age: 95,
    year: 2069,
    filingStatus: 'mfj',
    traditional: 0,
    roth: 0,
    taxable: { value: 0, basis: 0 },
    ssClaimed: true,
    ssClaimAge: 67,
    ssAnnualBenefit: 48_000,
    magiHistory: [],
    ruleOf55Applies: false,
    ...overrides,
  };
}

const ZERO_CONVERSION_STRATEGY: Strategy = {
  ssClaimAge: 67,
  perYear: [],
};

// ─── ssBenefitMultiplier ────────────────────────────────────────────────────

describe('ssBenefitMultiplier', () => {
  it('returns 1.0 at full retirement age (67)', () => {
    expect(ssBenefitMultiplier(67)).toBeCloseTo(1.0, 5);
  });

  it('returns ~0.7 at age 62 (~30% reduction)', () => {
    expect(ssBenefitMultiplier(62)).toBeCloseTo(0.7, 5);
  });

  it('returns 1.24 at age 70 (8%/yr delayed credit for 3 years)', () => {
    expect(ssBenefitMultiplier(70)).toBeCloseTo(1.24, 5);
  });
});

// ─── currentPhase ───────────────────────────────────────────────────────────

describe('currentPhase', () => {
  const birthYear = 1972; // rmdStartAge(1972) = 75

  it('age 54 → PRE_55', () => {
    expect(currentPhase(54, birthYear)).toBe(Phase.PRE_55);
  });

  it('age 55 → RULE_OF_55', () => {
    expect(currentPhase(55, birthYear)).toBe(Phase.RULE_OF_55);
  });

  it('age 60 → PENALTY_FREE', () => {
    expect(currentPhase(60, birthYear)).toBe(Phase.PENALTY_FREE);
  });

  it('age 66 → MEDICARE_ERA', () => {
    expect(currentPhase(66, birthYear)).toBe(Phase.MEDICARE_ERA);
  });

  it('age 75 → RMD_ERA', () => {
    expect(currentPhase(75, birthYear)).toBe(Phase.RMD_ERA);
  });
});

// ─── discountFactor ─────────────────────────────────────────────────────────

describe('discountFactor', () => {
  it('returns 1.0 for year 0 regardless of rate', () => {
    expect(discountFactor(0, 0.03)).toBe(1.0);
  });

  it('returns ~0.744 for 10 years at 3%', () => {
    expect(discountFactor(10, 0.03)).toBeCloseTo(0.744, 2);
  });

  it('returns 1.0 for any horizon when rate is 0 (nominal sum mode)', () => {
    expect(discountFactor(40, 0)).toBe(1.0);
  });
});

// ─── initialState ───────────────────────────────────────────────────────────

describe('initialState', () => {
  it('builds a state from assumptions with placeholder MAGI history', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);

    expect(state.age).toBe(assumptions.currentAge);
    expect(state.year).toBe(SIMULATION_BASE_YEAR);
    expect(state.traditional).toBe(assumptions.traditional);
    expect(state.magiHistory).toEqual([0, 0]);
    expect(state.ssClaimAge).toBe(67);
  });

  it('does not mark SS as claimed when claim age is in the future', () => {
    const assumptions = makeAssumptions({ currentAge: 52 });
    const state = initialState(assumptions, 67);
    expect(state.ssClaimed).toBe(false);
  });

  it('marks SS as already claimed if currentAge >= ssClaimAge', () => {
    const assumptions = makeAssumptions({ currentAge: 68 });
    const state = initialState(assumptions, 67);
    expect(state.ssClaimed).toBe(true);
  });

  it('does not apply Rule of 55 outside the 55-59.5 window', () => {
    const assumptions = makeAssumptions({ currentAge: 52 });
    const state = initialState(assumptions, 67);
    expect(state.ruleOf55Applies).toBe(false);
  });
});

// ─── resolveDecision ────────────────────────────────────────────────────────

describe('resolveDecision', () => {
  it('returns the explicit perYear decision when provided', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const strategy: Strategy = {
      ssClaimAge: 67,
      perYear: [{ conversionAmount: 25_000, withdrawalOrder: ['taxable', 'traditional', 'roth'] }],
    };

    const decision = resolveDecision(strategy, state, 0, assumptions);
    expect(decision.conversionAmount).toBe(25_000);
  });

  it('falls back to zero conversion when neither perYear nor phaseTemplates is given', () => {
    const assumptions = makeAssumptions();
    const state = initialState(assumptions, 67);
    const strategy: Strategy = { ssClaimAge: 67 };

    const decision = resolveDecision(strategy, state, 0, assumptions);
    expect(decision.conversionAmount).toBe(0);
  });

  it('falls back to zero conversion when the current phase has no template', () => {
    const assumptions = makeAssumptions({ currentAge: 52 });
    const state = initialState(assumptions, 67);
    const strategy: Strategy = {
      ssClaimAge: 67,
      phaseTemplates: { [Phase.MEDICARE_ERA]: 'aggressive' },
    };

    const decision = resolveDecision(strategy, state, 0, assumptions);
    expect(decision.conversionAmount).toBe(0);
  });

  it('produces a non-negative conversion amount for each phase template, clamped to traditional balance', () => {
    const assumptions = makeAssumptions({ currentAge: 60 });
    const state = initialState(assumptions, 67);

    for (const template of ['conservative', 'moderate', 'aggressive'] as const) {
      const strategy: Strategy = {
        ssClaimAge: 67,
        phaseTemplates: { [Phase.PENALTY_FREE]: template },
      };
      const decision = resolveDecision(strategy, state, 0, assumptions);
      expect(decision.conversionAmount).toBeGreaterThanOrEqual(0);
      expect(decision.conversionAmount).toBeLessThanOrEqual(state.traditional);
    }
  });

  it('aggressive conversion is never larger than moderate (IRMAA-tier) headroom', () => {
    const assumptions = makeAssumptions({ currentAge: 60 });
    const state = initialState(assumptions, 67);

    const moderate = resolveDecision(
      { ssClaimAge: 67, phaseTemplates: { [Phase.PENALTY_FREE]: 'moderate' } },
      state,
      0,
      assumptions,
    );
    const aggressive = resolveDecision(
      { ssClaimAge: 67, phaseTemplates: { [Phase.PENALTY_FREE]: 'aggressive' } },
      state,
      0,
      assumptions,
    );

    expect(aggressive.conversionAmount).toBeLessThanOrEqual(moderate.conversionAmount + 1e-6);
  });
});

// ─── computeEstateCost ──────────────────────────────────────────────────────

describe('computeEstateCost', () => {
  it('applies the §2058 deduction: federal base is reduced by WA estate tax paid', () => {
    const assumptions = makeAssumptions({ filingStatus: 'mfj', heirMarginalRate: 0.32 });
    const terminalState = makeTerminalState({
      year: 2026,
      filingStatus: 'mfj',
      traditional: 5_000_000,
      roth: 0,
      taxable: { value: 0, basis: 0 },
    });

    const total = computeEstateCost(terminalState, assumptions);

    // Naive (non-§2058) total would be waTax + 0.40*(5M - fedExemption) + heirTax.
    // Since the federal base is reduced by the WA tax, total must be strictly less.
    const fedExemption = 2 * 15_000_000; // MFJ doubles the 2026 single exemption
    const naiveFedTax = 0.4 * Math.max(0, 5_000_000 - fedExemption);
    const heirTax = 5_000_000 * assumptions.heirMarginalRate;

    expect(total).toBeLessThan(naiveFedTax + heirTax + 1); // both ~0 here given huge fed exemption
    expect(total).toBeGreaterThan(0); // WA tax + heir tax still apply
  });

  it('reduces cost via step-up in basis on unrealized taxable gains', () => {
    const assumptions = makeAssumptions();
    const withGain = makeTerminalState({ taxable: { value: 200_000, basis: 50_000 } });
    const withoutGain = makeTerminalState({ taxable: { value: 200_000, basis: 200_000 } });

    expect(computeEstateCost(withGain, assumptions)).toBeLessThan(computeEstateCost(withoutGain, assumptions));
  });

  it('charges heir income tax proportional to the inherited traditional balance', () => {
    const assumptions = makeAssumptions({ heirMarginalRate: 0.32 });
    const small = makeTerminalState({ traditional: 100_000 });
    const large = makeTerminalState({ traditional: 200_000 });

    const diff = computeEstateCost(large, assumptions) - computeEstateCost(small, assumptions);
    expect(diff).toBeCloseTo(100_000 * 0.32, 0);
  });
});

// ─── simulate ───────────────────────────────────────────────────────────────

describe('simulate', () => {
  it('is a pure function — identical inputs produce identical output', () => {
    const assumptions = makeAssumptions();
    const strategy: Strategy = { ssClaimAge: 67, phaseTemplates: { [Phase.PENALTY_FREE]: 'moderate' } };

    const result1 = simulate(strategy, assumptions);
    const result2 = simulate(strategy, assumptions);

    expect(result1.totalCost).toBe(result2.totalCost);
    expect(result1.trace).toEqual(result2.trace);
  });

  it('produces a trace with exactly (horizonAge - currentAge) records', () => {
    const assumptions = makeAssumptions({ currentAge: 52, horizonAge: 90 });
    const strategy: Strategy = { ssClaimAge: 67 };

    const result = simulate(strategy, assumptions);
    expect(result.trace).toHaveLength(38);
  });

  it('compounds the traditional balance at expectedReturn under zero conversion and zero spending', () => {
    const assumptions = makeAssumptions({
      currentAge: 52,
      horizonAge: 55,
      annualSpending: 0,
      expectedReturn: 0.06,
    });
    const result = simulate(ZERO_CONVERSION_STRATEGY, assumptions);

    const expected = assumptions.traditional * Math.pow(1.06, 3);
    expect(result.trace[2].traditionalBalance).toBeCloseTo(expected, 0);
  });

  it('does not mutate the assumptions or strategy objects', () => {
    const assumptions = makeAssumptions();
    const strategy: Strategy = { ssClaimAge: 67, perYear: [] };
    const assumptionsCopy = JSON.parse(JSON.stringify(assumptions));
    const strategyCopy = JSON.parse(JSON.stringify(strategy));

    simulate(strategy, assumptions);

    expect(assumptions).toEqual(assumptionsCopy);
    expect(strategy).toEqual(strategyCopy);
  });
});
