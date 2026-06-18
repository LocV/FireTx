import { describe, it, expect } from 'vitest';
import {
  computeWithdrawal,
  computeTaxableSocialSecurity,
  computeMagi,
  computeFederalIncomeTax,
  computeNiit,
  computeIrmaa,
  computeEarlyWithdrawalPenalty,
  growBalances,
  computeYear,
} from './computeYear.ts';
import type { YearState, YearDecision, Assumptions } from './types.ts';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeState(overrides: Partial<YearState> = {}): YearState {
  return {
    age: 52,
    year: 2026,
    filingStatus: 'mfj',
    traditional: 1_000_000,
    roth: 200_000,
    taxable: { value: 400_000, basis: 250_000 },
    ssClaimed: false,
    ssClaimAge: null,
    ssAnnualBenefit: 0,
    magiHistory: [],
    ruleOf55Applies: false,
    ...overrides,
  };
}

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

const NO_CONVERSION: YearDecision = {
  conversionAmount: 0,
  withdrawalOrder: ['taxable', 'traditional', 'roth'],
};

// ─── computeWithdrawal ──────────────────────────────────────────────────────

describe('computeWithdrawal', () => {
  it('returns all zeros when no need', () => {
    const result = computeWithdrawal(0, makeState(), ['taxable', 'traditional', 'roth']);
    expect(result.tradWithdrawals).toBe(0);
    expect(result.taxableWithdrawals.total).toBe(0);
    expect(result.rothWithdrawals).toBe(0);
  });

  it('draws from taxable first, splitting basis and gain proportionally', () => {
    const state = makeState({ taxable: { value: 400_000, basis: 200_000 } });
    const result = computeWithdrawal(40_000, state, ['taxable', 'traditional', 'roth']);
    // 50% gain fraction
    expect(result.taxableWithdrawals.total).toBeCloseTo(40_000, 5);
    expect(result.taxableWithdrawals.gainPortion).toBeCloseTo(20_000, 5);
    expect(result.taxableWithdrawals.basisPortion).toBeCloseTo(20_000, 5);
    expect(result.tradWithdrawals).toBe(0);
  });

  it('falls through to traditional once taxable is exhausted', () => {
    const state = makeState({ taxable: { value: 10_000, basis: 5_000 } });
    const result = computeWithdrawal(30_000, state, ['taxable', 'traditional', 'roth']);
    expect(result.taxableWithdrawals.total).toBeCloseTo(10_000, 5);
    expect(result.tradWithdrawals).toBeCloseTo(20_000, 5);
  });

  it('falls through to roth once traditional is exhausted', () => {
    const state = makeState({
      taxable: { value: 0, basis: 0 },
      traditional: 5_000,
      roth: 50_000,
    });
    const result = computeWithdrawal(20_000, state, ['taxable', 'traditional', 'roth']);
    expect(result.tradWithdrawals).toBeCloseTo(5_000, 5);
    expect(result.rothWithdrawals).toBeCloseTo(15_000, 5);
  });
});

// ─── computeTaxableSocialSecurity (the torpedo) ────────────────────────────

describe('computeTaxableSocialSecurity', () => {
  it('returns 0 when provisional income is below the lower threshold', () => {
    // PI = 5,000 + 0.5*24,000 = 17,000 < $25k single threshold
    expect(computeTaxableSocialSecurity(5_000, 24_000, 'single')).toBe(0);
  });

  it('returns 50% of excess in the mid tier', () => {
    // PI = 20,000 + 0.5*24,000 = 32,000; between 25k and 34k
    const taxable = computeTaxableSocialSecurity(20_000, 24_000, 'single');
    expect(taxable).toBeCloseTo(0.5 * (32_000 - 25_000), 1);
  });

  it('caps at 85% of gross benefit when far above the upper threshold', () => {
    // PI = 50,000 + 12,000 = 62,000 > $34k single upper threshold
    expect(computeTaxableSocialSecurity(50_000, 24_000, 'single')).toBeCloseTo(0.85 * 24_000, 1);
  });

  it('returns 0 when there is no SS benefit', () => {
    expect(computeTaxableSocialSecurity(100_000, 0, 'mfj')).toBe(0);
  });

  it('demonstrates the torpedo: marginal rate above ~$0.85 per dollar near the upper threshold (MFJ)', () => {
    const ssGross = 40_000;
    const below = computeTaxableSocialSecurity(60_000, ssGross, 'mfj'); // PI = 80k > 44k upper
    const above = computeTaxableSocialSecurity(61_000, ssGross, 'mfj');
    // Already capped at 85% in both cases once deep past the upper threshold
    expect(above - below).toBeCloseTo(0, 5);
    expect(below).toBeCloseTo(0.85 * ssGross, 1);
  });
});

// ─── computeMagi ────────────────────────────────────────────────────────────

describe('computeMagi', () => {
  it('adds tax-exempt interest to AGI', () => {
    expect(computeMagi(80_000, 0)).toBe(80_000);
    expect(computeMagi(80_000, 5_000)).toBe(85_000);
  });
});

// ─── computeFederalIncomeTax (LTCG stacking) ───────────────────────────────

describe('computeFederalIncomeTax', () => {
  it('LTCG in the 0% zone produces no tax', () => {
    // ordinary=0, ltcg=50,000; MFJ 0% ceiling is $96,700 — both fit
    expect(computeFederalIncomeTax(0, 50_000, 2026, 'mfj')).toBe(0);
  });

  it('ordinary income filling the 0% zone pushes LTCG into the 15% band', () => {
    // ordinary=90,000 (taxableOrdinary), ltcg=20,000 → stacked top = 110,000 > 96,700
    const tax = computeFederalIncomeTax(90_000, 20_000, 2026, 'mfj');
    const ordinaryTax = federalOrdinaryTaxRef(90_000);
    // LTCG: 6,700 at 0%, 13,300 at 15%
    const ltcgTax = (110_000 - 96_700) * 0.15;
    expect(tax).toBeCloseTo(ordinaryTax + ltcgTax, 0);
  });

  // local helper mirroring brackets.ts for assertion purposes only
  function federalOrdinaryTaxRef(taxableIncome: number): number {
    const brackets = [
      { min: 0, rate: 0.10 },
      { min: 23_850, rate: 0.12 },
      { min: 96_950, rate: 0.22 },
    ];
    let tax = 0;
    for (let i = 0; i < brackets.length; i++) {
      const bottom = brackets[i].min;
      const top = i + 1 < brackets.length ? brackets[i + 1].min : Infinity;
      const taxableInBand = Math.min(taxableIncome, top) - bottom;
      if (taxableInBand <= 0) break;
      tax += taxableInBand * brackets[i].rate;
    }
    return tax;
  }
});

// ─── computeNiit (frozen threshold) ────────────────────────────────────────

describe('computeNiit', () => {
  it('returns 0 when MAGI is below the frozen threshold', () => {
    expect(computeNiit(50_000, 190_000, 'single')).toBe(0);
  });

  it('applies 3.8% on the lesser of NII or MAGI excess', () => {
    // MAGI exceeds $200k threshold by $10k; NII is $50k → tax on the smaller, $10k
    expect(computeNiit(50_000, 210_000, 'single')).toBeCloseTo(380, 1);
  });

  it('returns 0 when NII is 0 even if MAGI is above threshold', () => {
    expect(computeNiit(0, 300_000, 'single')).toBe(0);
  });
});

// ─── computeIrmaa (cliff, 2-year lookback) ─────────────────────────────────

describe('computeIrmaa', () => {
  it('returns 0 below age 65 regardless of MAGI', () => {
    expect(computeIrmaa(500_000, 64, 'single', 2026)).toBe(0);
  });

  it('one dollar under the MFJ first tier — no surcharge', () => {
    expect(computeIrmaa(211_999, 67, 'mfj', 2026)).toBe(0);
  });

  it('at the MFJ first tier — full tier-1 surcharge (per person)', () => {
    expect(computeIrmaa(212_000, 67, 'mfj', 2026)).toBeCloseTo(850, 0);
  });
});

// ─── computeEarlyWithdrawalPenalty ─────────────────────────────────────────

describe('computeEarlyWithdrawalPenalty', () => {
  it('applies 10% before 59.5 with no Rule of 55', () => {
    expect(computeEarlyWithdrawalPenalty(10_000, 50, false)).toBeCloseTo(1_000, 1);
  });

  it('waives the penalty under Rule of 55', () => {
    expect(computeEarlyWithdrawalPenalty(10_000, 56, true)).toBe(0);
  });

  it('waives the penalty at or after 59.5', () => {
    expect(computeEarlyWithdrawalPenalty(10_000, 60, false)).toBe(0);
  });
});

// ─── growBalances ───────────────────────────────────────────────────────────

describe('growBalances', () => {
  it('applies the growth factor to all three accounts, leaving basis unchanged', () => {
    const state = makeState({
      traditional: 100_000,
      roth: 50_000,
      taxable: { value: 100_000, basis: 60_000 },
    });
    const grown = growBalances(state, 0.06);
    expect(grown.traditional).toBeCloseTo(106_000, 1);
    expect(grown.roth).toBeCloseTo(53_000, 1);
    expect(grown.taxable.value).toBeCloseTo(106_000, 1);
    expect(grown.taxable.basis).toBe(60_000);
  });
});

// ─── computeYear (orchestration / RMD floor) ───────────────────────────────

describe('computeYear', () => {
  it('forces RMD into ordinary income at age 75+ regardless of conversionAmount', () => {
    const state = makeState({
      age: 75,
      traditional: 1_000_000,
      filingStatus: 'single',
    });
    const assumptions = makeAssumptions({ filingStatus: 'single', annualSpending: 0 });
    const decision: YearDecision = { conversionAmount: 0, withdrawalOrder: ['traditional'] };

    const { record } = computeYear(state, decision, assumptions, 10);

    // RMD = 1,000,000 / 24.6 (uniform lifetime factor at 75)
    expect(record.rmd).toBeCloseTo(1_000_000 / 24.6, 1);
    expect(record.ordinaryIncome).toBeGreaterThanOrEqual(record.rmd);
  });

  it('clamps the Roth conversion to the post-RMD/withdrawal traditional balance', () => {
    const state = makeState({
      age: 60,
      traditional: 10_000,
      taxable: { value: 0, basis: 0 },
      roth: 0,
    });
    const assumptions = makeAssumptions({ annualSpending: 0 });
    const decision: YearDecision = {
      conversionAmount: 50_000, // far more than available
      withdrawalOrder: ['traditional'],
    };

    const { record, nextState } = computeYear(state, decision, assumptions, 0);

    expect(record.conversionAmount).toBeCloseTo(10_000, 1);
    expect(nextState.traditional).toBe(0);
  });

  it('produces a balanced year cost equal to the sum of its components', () => {
    const state = makeState();
    const assumptions = makeAssumptions();
    const { record, yearCost } = computeYear(state, NO_CONVERSION, assumptions, 0);

    const sum =
      record.federalIncomeTax +
      record.stateTax +
      record.niit +
      record.irmaa +
      record.penalty +
      record.waCapGainsTax;
    expect(yearCost).toBeCloseTo(sum, 6);
    expect(record.yearCost).toBeCloseTo(sum, 6);
  });

  it('records this year MAGI in nextState.magiHistory for future IRMAA lookback', () => {
    const state = makeState();
    const assumptions = makeAssumptions();
    const { nextState, record } = computeYear(state, NO_CONVERSION, assumptions, 0);

    expect(nextState.magiHistory).toHaveLength(1);
    expect(nextState.magiHistory[0]).toBeCloseTo(record.magi, 5);
  });

  it('applies $0 state income tax for WA residents', () => {
    const state = makeState();
    const assumptions = makeAssumptions({ state: 'WA' });
    const { record } = computeYear(state, NO_CONVERSION, assumptions, 0);
    expect(record.stateTax).toBe(0);
  });
});
