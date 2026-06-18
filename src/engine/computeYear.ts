/**
 * The per-year tax cost function — the core of the simulator.
 * computeYear() is a pure orchestrator: it calls the helper functions below in
 * the mandatory 13-step order and assembles the results. No tax math lives here.
 */

import {
  federalOrdinaryTax,
  federalLtcgTax,
  standardDeduction,
  annualIrmaaSurcharge,
  computeRmd,
  waCapitalGainsTax,
} from './tables/index.ts';
import type {
  AccountSource,
  Assumptions,
  FilingStatus,
  TaxableAccount,
  WithdrawalResult,
  YearDecision,
  YearRecord,
  YearState,
} from './types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Frozen (never inflation-adjusted) provisional-income thresholds for SS taxation. */
const SS_LOWER_THRESHOLD: Record<FilingStatus, number> = { single: 25_000, mfj: 32_000 };
const SS_UPPER_THRESHOLD: Record<FilingStatus, number> = { single: 34_000, mfj: 44_000 };

/** Maximum fraction of Social Security benefits that can ever be taxable. */
const SS_MAX_TAXABLE_FRACTION = 0.85;
/** Marginal inclusion rate for provisional income between the lower and upper thresholds. */
const SS_MID_TIER_RATE = 0.5;

/** NIIT rate and frozen (never inflation-adjusted) MAGI thresholds. */
const NIIT_RATE = 0.038;
const NIIT_THRESHOLD: Record<FilingStatus, number> = { single: 200_000, mfj: 250_000 };

/** Early-withdrawal penalty rate and the age below which it applies. */
const EARLY_WITHDRAWAL_PENALTY_RATE = 0.10;
const PENALTY_FREE_AGE = 59.5;

/** Number of spouses whose Medicare premiums are subject to IRMAA under MFJ. */
const MFJ_SPOUSE_COUNT = 2;

/** IRMAA in year Y is driven by MAGI from year Y-2 — the forward attribution lag. */
const IRMAA_ATTRIBUTION_LAG_YEARS = 2;

// ─── Helper: STEP 2 — Spending sourcing ──────────────────────────────────────

/**
 * Determines how much to draw from each account to meet the spending need
 * (after RMD and net Social Security have already covered part of it).
 * Draws accounts in the order specified by withdrawalOrder.
 * Tracks the basis/gain split for taxable account withdrawals.
 *
 * @param need - Remaining cash needed after RMD and SS income
 * @param state - Current account balances (traditional already net of RMD)
 * @param order - Account priority sequence
 * @returns Breakdown of withdrawals with tax character per account
 * @example
 * computeWithdrawal(10_000, state, ['taxable', 'traditional', 'roth'])
 */
export function computeWithdrawal(
  need: number,
  state: YearState,
  order: readonly AccountSource[],
): WithdrawalResult {
  let remaining = Math.max(0, need);
  let tradWithdrawals = 0;
  let taxableTotal = 0;
  let basisPortion = 0;
  let gainPortion = 0;
  let rothWithdrawals = 0;

  for (const source of order) {
    if (remaining <= 0) break;
    if (source === 'traditional') {
      const draw = Math.min(remaining, state.traditional);
      tradWithdrawals += draw;
      remaining -= draw;
    } else if (source === 'taxable') {
      const draw = Math.min(remaining, state.taxable.value);
      const gainFraction =
        state.taxable.value > 0
          ? Math.max(0, (state.taxable.value - state.taxable.basis) / state.taxable.value)
          : 0;
      gainPortion += draw * gainFraction;
      basisPortion += draw * (1 - gainFraction);
      taxableTotal += draw;
      remaining -= draw;
    } else {
      const draw = Math.min(remaining, state.roth);
      rothWithdrawals += draw;
      remaining -= draw;
    }
  }

  return {
    tradWithdrawals,
    taxableWithdrawals: { total: taxableTotal, basisPortion, gainPortion },
    rothWithdrawals,
  };
}

// ─── Helper: STEP 4b — Taxable Social Security (the torpedo) ─────────────────

/**
 * Returns the portion of the gross SS benefit that is subject to income tax,
 * based on provisional income (PI = ordinary income before SS + ½ × gross benefit).
 *
 * Tiers (FROZEN thresholds — never inflation-adjusted):
 *   PI <= lower threshold            → 0% taxable
 *   lower < PI <= upper threshold    → 50% of excess above the lower threshold
 *   PI > upper threshold             → 85% of (PI − upper) + 50% of (upper − lower),
 *                                       capped at 85% of the gross benefit
 *
 * ⚠️ THE TORPEDO EFFECT: above the upper threshold, each $1 of additional income
 * (including conversions) adds ~$0.85 to the tax base — a hidden marginal rate spike.
 * MUST be computed AFTER other income is assembled.
 *
 * @example
 * computeTaxableSocialSecurity(5_000, 24_000, 'single')  // 0 — PI = 17,000 < $25k
 * computeTaxableSocialSecurity(50_000, 24_000, 'single') // ~$20,400 — 85% cap reached
 */
export function computeTaxableSocialSecurity(
  ordinaryIncomeBeforeSS: number,
  ssGrossBenefit: number,
  filingStatus: FilingStatus,
): number {
  if (ssGrossBenefit <= 0) return 0;

  const provisionalIncome = ordinaryIncomeBeforeSS + 0.5 * ssGrossBenefit;
  const lower = SS_LOWER_THRESHOLD[filingStatus];
  const upper = SS_UPPER_THRESHOLD[filingStatus];
  const maxTaxable = SS_MAX_TAXABLE_FRACTION * ssGrossBenefit;

  if (provisionalIncome <= lower) return 0;

  if (provisionalIncome <= upper) {
    return Math.min(SS_MID_TIER_RATE * (provisionalIncome - lower), maxTaxable);
  }

  const taxableAboveUpper =
    SS_MAX_TAXABLE_FRACTION * (provisionalIncome - upper) + SS_MID_TIER_RATE * (upper - lower);
  return Math.min(maxTaxable, taxableAboveUpper);
}

// ─── Helper: MAGI ─────────────────────────────────────────────────────────────

/**
 * Modified Adjusted Gross Income = AGI + tax-exempt interest.
 * MAGI is used for IRMAA and NIIT (not taxable income). Keep separate from taxableOrdinary.
 * Tax-exempt interest (e.g. muni bonds) is included in MAGI even though not taxable.
 *
 * @example
 * computeMagi(80_000, 0) // 80_000
 */
export function computeMagi(agi: number, taxExemptInterest: number): number {
  return agi + taxExemptInterest;
}

// ─── Helper: STEP 6 — Federal income tax ─────────────────────────────────────

/**
 * Total federal income tax = ordinary tax (on taxableOrdinary) + LTCG tax (stacked).
 * LTCG rates (0/15/20%) are determined by where (taxableOrdinary + ltcg) lands,
 * NOT by ltcg alone. This is the "stacking trap" — a conversion that fills ordinary
 * income can push otherwise-0% gains into the 15% zone.
 *
 * @param taxableOrdinary - Ordinary income after standard deduction
 * @param ltcg - Long-term capital gains + qualified dividends
 * @param year - Calendar year for bracket lookup
 * @example
 * computeFederalIncomeTax(0, 50_000, 2026, 'mfj') // 0 — both under the 0% LTCG ceiling
 */
export function computeFederalIncomeTax(
  taxableOrdinary: number,
  ltcg: number,
  year: number,
  filingStatus: FilingStatus,
): number {
  const ordinaryTax = federalOrdinaryTax(taxableOrdinary, year, filingStatus);
  const ltcgTax = federalLtcgTax(ltcg, taxableOrdinary, year, filingStatus);
  return ordinaryTax + ltcgTax;
}

// ─── Helper: STEP 7 — NIIT ────────────────────────────────────────────────────

/**
 * Net Investment Income Tax: 3.8% on the lesser of NII or the amount by which
 * MAGI exceeds the threshold.
 *
 * ⚠️ FROZEN THRESHOLDS (never inflation-adjusted): $200k single / $250k MFJ.
 * Inflation slowly drags more households across this line every year.
 *
 * @param nii - Net investment income (interest + dividends + realized LTCG + passive)
 * @param magi - Full MAGI including NII
 * @example
 * computeNiit(50_000, 210_000, 'single') // 380 — 3.8% of min(50k, 10k)
 */
export function computeNiit(nii: number, magi: number, filingStatus: FilingStatus): number {
  if (nii <= 0) return 0;
  const excess = Math.max(0, magi - NIIT_THRESHOLD[filingStatus]);
  return NIIT_RATE * Math.min(nii, excess);
}

// ─── Helper: STEP 8 — IRMAA ───────────────────────────────────────────────────

/**
 * Annual IRMAA surcharge (Part B + Part D combined) for ONE person.
 * Returns 0 if age < 65 (Medicare not yet active).
 *
 * ⚠️ USES MAGI FROM TWO YEARS AGO. The caller must pass magi2YearsAgo
 * from state.magiHistory — NOT the current year's MAGI.
 * This is the Markov attribution reformulation. Do not change this.
 *
 * For MFJ: call once per spouse (both spouses owe the surcharge independently) —
 * the caller is responsible for doubling this value for MFJ households.
 *
 * @example
 * computeIrmaa(212_000, 67, 'mfj', 2026) // ~850 — crossed the first MFJ tier
 */
export function computeIrmaa(
  magi2YearsAgo: number,
  age: number,
  filingStatus: FilingStatus,
  year: number,
): number {
  if (age < 65) return 0;
  return annualIrmaaSurcharge(magi2YearsAgo, year, filingStatus);
}

// ─── Helper: STEP 9 — Early-withdrawal penalty ───────────────────────────────

/**
 * 10% penalty on traditional account distributions before age 59½.
 * Exceptions:
 *   - Rule of 55: applies to separation-year 401(k) only, NOT IRAs.
 *   - Roth contributions are always penalty-free (only earnings are penalized).
 * Penalty applies only to the additional traditional withdrawal amount,
 * not the RMD (RMDs only occur at 75+, well past the penalty age) and not conversions.
 *
 * @example
 * computeEarlyWithdrawalPenalty(10_000, 50, false) // 1_000
 */
export function computeEarlyWithdrawalPenalty(
  traditionalWithdrawals: number,
  age: number,
  ruleOf55Applies: boolean,
): number {
  if (age >= PENALTY_FREE_AGE || ruleOf55Applies) return 0;
  return EARLY_WITHDRAWAL_PENALTY_RATE * traditionalWithdrawals;
}

// ─── Helper: STEP 12 — Grow balances ─────────────────────────────────────────

/**
 * Applies the expected annual return to all three accounts, producing
 * the balances for the START of the next year.
 * Taxable basis is left unchanged — reinvested dividends/distributions are
 * not modeled as a separate income source in this simulator.
 * Returns only the balance fields — does not produce a full new YearState.
 *
 * @example
 * growBalances({ traditional: 100, roth: 100, taxable: { value: 100, basis: 50 }, ... }, 0.06)
 * // → { traditional: 106, roth: 106, taxable: { value: 106, basis: 50 } }
 */
export function growBalances(
  state: YearState,
  expectedReturn: number,
): Pick<YearState, 'traditional' | 'roth' | 'taxable'> {
  const growthFactor = 1 + expectedReturn;
  return {
    traditional: state.traditional * growthFactor,
    roth: state.roth * growthFactor,
    taxable: {
      value: state.taxable.value * growthFactor,
      basis: state.taxable.basis,
    },
  };
}

// ─── Internal helpers (not exported — orchestration support only) ───────────

/** Account balances after withdrawals and the Roth conversion, before growth. */
interface PreGrowthBalances {
  readonly traditional: number;
  readonly roth: number;
  readonly taxable: TaxableAccount;
  readonly conversionAmount: number;
}

/**
 * Applies withdrawals and the Roth conversion (STEP 3) to account balances.
 * The requested conversion is clamped to what remains in traditional after
 * RMD and additional withdrawals — the RMD floor cannot be converted away.
 */
function applyConversion(
  traditionalAfterRmd: number,
  withdrawal: WithdrawalResult,
  state: YearState,
  requestedConversion: number,
): PreGrowthBalances {
  const traditionalAfterWithdrawal = traditionalAfterRmd - withdrawal.tradWithdrawals;
  const conversionAmount = Math.min(
    Math.max(0, requestedConversion),
    Math.max(0, traditionalAfterWithdrawal),
  );
  return {
    traditional: traditionalAfterWithdrawal - conversionAmount,
    roth: state.roth - withdrawal.rothWithdrawals + conversionAmount,
    taxable: {
      value: state.taxable.value - withdrawal.taxableWithdrawals.total,
      basis: state.taxable.basis - withdrawal.taxableWithdrawals.basisPortion,
    },
    conversionAmount,
  };
}

/** Assembles the YearRecord for the trace from already-computed values. */
function buildYearRecord(params: {
  state: YearState;
  rmd: number;
  conversionAmount: number;
  ordinaryIncome: number;
  magi: number;
  federalIncomeTax: number;
  stateTax: number;
  niit: number;
  irmaa: number;
  irmaaAttributed: number;
  penalty: number;
  waCapGainsTax: number;
  yearCost: number;
  grown: Pick<YearState, 'traditional' | 'roth' | 'taxable'>;
}): YearRecord {
  const { state, grown, ...costs } = params;
  return {
    age: state.age,
    year: state.year,
    ...costs,
    traditionalBalance: grown.traditional,
    rothBalance: grown.roth,
    taxableBalance: grown.taxable.value,
  };
}

// ─── Orchestrator ─────────────────────────────────────────────────────────────

/**
 * Executes all 13 steps of the per-year tax calculation for a single simulation year.
 * Returns the year's total tax cost, the updated state for the next year, and
 * a detailed YearRecord for UI display.
 *
 * STEP ORDER IS MANDATORY — each step feeds the next:
 *   1. RMD (forced income floor, age 75+)
 *   2. Spending sourcing (withdraw to cover spending - RMD - SS)
 *   3. Roth conversion (add to ordinary income)
 *   4. Ordinary income assembly
 *   4b. Taxable SS (torpedo — must come after other income)
 *   5. LTCG assembly (stacked on top of ordinary)
 *   6. Federal income tax (ordinary + stacked LTCG)
 *   7. NIIT (on NII vs MAGI)
 *   8. IRMAA (on MAGI from 2 years ago, age 65+)
 *   9. Early-withdrawal penalty (age < 59½)
 *   10. WA capital gains tax (on taxable account sales)
 *   11. Year cost total
 *   12. Grow balances
 *   13. Record MAGI in history
 *
 * @param simulationYear - 0-based index (used to retrieve MAGI lookback from history)
 * @example
 * const { yearCost, nextState, record } = computeYear(state, decision, assumptions, 0);
 */
export function computeYear(
  state: YearState,
  decision: YearDecision,
  assumptions: Assumptions,
  simulationYear: number,
): { yearCost: number; nextState: YearState; record: YearRecord } {
  // STEP 1: RMD — forced income floor from age 75+, cannot be converted away.
  const rmd = computeRmd(state.traditional, state.age, assumptions.birthYear);
  const traditionalAfterRmd = state.traditional - rmd;

  // STEP 2: Spending sourcing — withdraw to cover spending need beyond RMD + net SS.
  const ssGross = state.ssClaimed ? state.ssAnnualBenefit : 0;
  const remainingNeed = Math.max(0, assumptions.annualSpending - rmd - ssGross);
  const withdrawal = computeWithdrawal(
    remainingNeed,
    { ...state, traditional: traditionalAfterRmd },
    decision.withdrawalOrder,
  );

  // STEP 3: Roth conversion — voluntary, clamped to the post-withdrawal traditional balance.
  const balances = applyConversion(traditionalAfterRmd, withdrawal, state, decision.conversionAmount);

  // STEP 4 + 4b: Ordinary income assembly, including the taxable-SS torpedo.
  const tradIncome = rmd + withdrawal.tradWithdrawals + balances.conversionAmount;
  const taxableSS = computeTaxableSocialSecurity(tradIncome, ssGross, state.filingStatus);
  const ordinaryIncome = tradIncome + taxableSS;

  // STEP 5: LTCG assembly — gain portion of taxable-account withdrawals.
  const realizedLtcg = withdrawal.taxableWithdrawals.gainPortion;

  // STEP 6: Federal income tax (ordinary + stacked LTCG). WA has no state income tax.
  const stdDeduction = standardDeduction(state.year, state.filingStatus, state.age);
  const taxableOrdinary = Math.max(0, ordinaryIncome - stdDeduction);
  const federalIncomeTax = computeFederalIncomeTax(
    taxableOrdinary,
    realizedLtcg,
    state.year,
    state.filingStatus,
  );
  const stateTax = 0;

  // STEP 7: NIIT — net investment income vs. frozen MAGI threshold.
  const magi = computeMagi(ordinaryIncome + realizedLtcg, 0);
  const niit = computeNiit(realizedLtcg, magi, state.filingStatus);

  // STEP 8: IRMAA — driven by MAGI from 2 years ago; per-person, doubled for MFJ.
  const magi2YearsAgo = state.magiHistory[simulationYear - 2] ?? 0;
  const irmaaPerPerson = computeIrmaa(magi2YearsAgo, state.age, state.filingStatus, state.year);
  const irmaa = state.filingStatus === 'mfj' ? irmaaPerPerson * MFJ_SPOUSE_COUNT : irmaaPerPerson;

  // STEP 8 (Markov reformulation, task 07): the IRMAA that THIS year's MAGI
  // will cause two years from now, attributed back to this year so the DP
  // optimizer's cost depends only on (age, balance, decision) — not on
  // magiHistory. Evaluated at age+2 / year+2 (when the surcharge is paid).
  const irmaaAttributedPerPerson = computeIrmaa(magi, state.age + IRMAA_ATTRIBUTION_LAG_YEARS, state.filingStatus, state.year + IRMAA_ATTRIBUTION_LAG_YEARS);
  const irmaaAttributed =
    state.filingStatus === 'mfj' ? irmaaAttributedPerPerson * MFJ_SPOUSE_COUNT : irmaaAttributedPerPerson;

  // STEP 9: Early-withdrawal penalty on additional withdrawals (not RMD or conversion).
  const penalty = computeEarlyWithdrawalPenalty(withdrawal.tradWithdrawals, state.age, state.ruleOf55Applies);

  // STEP 10: WA capital gains tax on realized taxable-account gains.
  const waCapGainsTax = assumptions.state === 'WA' ? waCapitalGainsTax(realizedLtcg, state.year) : 0;

  // STEP 11: Year cost total.
  const yearCost = federalIncomeTax + stateTax + niit + irmaa + penalty + waCapGainsTax;

  // STEP 12: Grow balances for the start of next year.
  const grown = growBalances(
    { ...state, traditional: balances.traditional, roth: balances.roth, taxable: balances.taxable },
    assumptions.expectedReturn,
  );

  // STEP 13: Record this year's MAGI so step 8 can retrieve it two years from now.
  const nextState: YearState = {
    ...state,
    age: state.age + 1,
    year: state.year + 1,
    traditional: grown.traditional,
    roth: grown.roth,
    taxable: grown.taxable,
    magiHistory: [...state.magiHistory, magi],
  };

  const record = buildYearRecord({
    state,
    rmd,
    conversionAmount: balances.conversionAmount,
    ordinaryIncome,
    magi,
    federalIncomeTax,
    stateTax,
    niit,
    irmaa,
    irmaaAttributed,
    penalty,
    waCapGainsTax,
    yearCost,
    grown,
  });

  return { yearCost, nextState, record };
}
