/**
 * The forward simulation loop — Layer 1 of the optimizer.
 * Runs computeYear() across the full horizon, accumulates discounted cost,
 * and tallies the one-time estate cost at the end. Deterministic and pure:
 * no Date.now(), no randomness, no mutation of inputs.
 */

import { computeYear } from './computeYear.ts';
import {
  ordinaryBracketEdges,
  irmaaTierThresholds,
  standardDeduction,
  computeRmd,
  rmdStartAge,
  waEstateExemption,
  waEstateTax,
  federalEstateExemption,
  federalEstateTax,
} from './tables/index.ts';
import {
  Phase,
  type AccountSource,
  type Assumptions,
  type PhaseTemplate,
  type SimResult,
  type Strategy,
  type YearDecision,
  type YearRecord,
  type YearState,
} from './types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Calendar year corresponding to simulation year 0.
 * The engine never reads Date.now(); this anchors the tax tables to a fixed
 * baseline year consistent with the 2026 table data in tables/.
 */
export const SIMULATION_BASE_YEAR = 2026;

/** Default account drawdown order used whenever a strategy doesn't specify one. */
const DEFAULT_WITHDRAWAL_ORDER: readonly AccountSource[] = ['taxable', 'traditional', 'roth'];

/** A no-op decision: no conversion, default withdrawal order. */
const ZERO_CONVERSION_DECISION: YearDecision = {
  conversionAmount: 0,
  withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER,
};

/** Social Security full retirement age (FRA) for the benefit-multiplier formula. */
const SS_FULL_RETIREMENT_AGE = 67;
/** Months per year — used to annualize the monthly SS benefit estimate. */
const MONTHS_PER_YEAR = 12;
/** First 36 months of early claiming are reduced at 5/9% per month (~0.5556%/mo). */
const SS_EARLY_TIER1_MONTH_CAP = 36;
const SS_EARLY_REDUCTION_RATE_TIER1 = 5 / 9 / 100;
/** Months earlier than 36 (down to age 62) are reduced at 5/12% per month. */
const SS_EARLY_REDUCTION_RATE_TIER2 = 5 / 12 / 100;
/** Delayed retirement credit: 8%/year = 2/3% per month, up to age 70. */
const SS_DELAYED_CREDIT_RATE_PER_MONTH = 8 / 12 / 100;

/** Age at which the Rule of 55 window begins. */
const RULE_OF_55_LOWER_AGE = 55;
/** Age at which traditional withdrawals become fully penalty-free. */
const PENALTY_FREE_AGE = 59.5;
/** Age at which Medicare/IRMAA begins. */
const MEDICARE_AGE = 65;

/** MFJ households are assumed to receive each spouse's WA estate exemption. */
const MFJ_EXEMPTION_MULTIPLIER = 2;
/**
 * Approximate federal long-term capital gains rate avoided on taxable-account
 * gains via step-up in basis at death. Used to value the step-up benefit.
 */
const HEIR_CAPITAL_GAINS_RATE = 0.15;

// ─── Social Security ──────────────────────────────────────────────────────────

/**
 * Returns the multiplier applied to the FRA (age 67) monthly benefit for a
 * given claim age, modeling early-claiming reductions and delayed credits.
 *
 * @example
 * ssBenefitMultiplier(67) // 1.0
 * ssBenefitMultiplier(62) // 0.7  — ~30% permanent reduction
 * ssBenefitMultiplier(70) // 1.24 — 8%/year delayed credit
 */
export function ssBenefitMultiplier(claimAge: number): number {
  if (claimAge < SS_FULL_RETIREMENT_AGE) {
    const monthsEarly = (SS_FULL_RETIREMENT_AGE - claimAge) * MONTHS_PER_YEAR;
    const tier1Months = Math.min(monthsEarly, SS_EARLY_TIER1_MONTH_CAP);
    const tier2Months = Math.max(0, monthsEarly - SS_EARLY_TIER1_MONTH_CAP);
    const reduction =
      tier1Months * SS_EARLY_REDUCTION_RATE_TIER1 + tier2Months * SS_EARLY_REDUCTION_RATE_TIER2;
    return 1 - reduction;
  }
  if (claimAge > SS_FULL_RETIREMENT_AGE) {
    const monthsLate = (claimAge - SS_FULL_RETIREMENT_AGE) * MONTHS_PER_YEAR;
    return 1 + monthsLate * SS_DELAYED_CREDIT_RATE_PER_MONTH;
  }
  return 1;
}

// ─── Phase determination ──────────────────────────────────────────────────────

/**
 * Returns the Phase the person is in for the given age.
 * Used by resolveDecision() to select the right phase template.
 *
 * @example
 * currentPhase(54, 1972) // Phase.PRE_55
 * currentPhase(75, 1972) // Phase.RMD_ERA
 */
export function currentPhase(age: number, birthYear: number): Phase {
  const rmdAge = rmdStartAge(birthYear);
  if (age < RULE_OF_55_LOWER_AGE) return Phase.PRE_55;
  if (age < PENALTY_FREE_AGE) return Phase.RULE_OF_55;
  if (age < MEDICARE_AGE) return Phase.PENALTY_FREE;
  if (age < rmdAge) return Phase.MEDICARE_ERA;
  return Phase.RMD_ERA;
}

/**
 * Whether the Rule of 55 (penalty-free 401(k) access after separation in the
 * year you turn 55+) applies at the given age.
 *
 * SIMPLIFICATION: this engine assumes the person separates from their employer
 * at `assumptions.currentAge` (the start of the simulation). The Rule of 55
 * therefore applies only if that separation happened at or after age 55, and
 * only while the person is between 55 and 59½.
 */
function isRuleOf55Eligible(age: number, separationAge: number): boolean {
  return separationAge >= RULE_OF_55_LOWER_AGE && age >= RULE_OF_55_LOWER_AGE && age < PENALTY_FREE_AGE;
}

// ─── Discounting ───────────────────────────────────────────────────────────────

/**
 * Returns the present-value discount factor for a cost incurred `yearsFromNow`
 * years out. A discount rate of 0 disables discounting (nominal sum mode).
 *
 * @example
 * discountFactor(0, 0.03)  // 1.0
 * discountFactor(10, 0.03) // ~0.744
 * discountFactor(5, 0)     // 1.0
 */
export function discountFactor(yearsFromNow: number, discountRate: number): number {
  if (discountRate === 0) return 1;
  return 1 / Math.pow(1 + discountRate, yearsFromNow);
}

// ─── Initial state ─────────────────────────────────────────────────────────────

/**
 * Builds the starting YearState from user-supplied assumptions and a chosen
 * SS claim age. magiHistory is pre-populated with two placeholder zeros so
 * the IRMAA 2-year lookback never indexes out of bounds in years 0 and 1.
 *
 * @example
 * initialState(assumptions, 67).age // assumptions.currentAge
 */
export function initialState(assumptions: Assumptions, ssClaimAge: number): YearState {
  const MAGI_LOOKBACK_YEARS = 2;
  return {
    age: assumptions.currentAge,
    year: SIMULATION_BASE_YEAR,
    filingStatus: assumptions.filingStatus,
    traditional: assumptions.traditional,
    roth: assumptions.roth,
    taxable: assumptions.taxable,
    ssClaimed: assumptions.currentAge >= ssClaimAge,
    ssClaimAge,
    ssAnnualBenefit: assumptions.ssMonthlyBenefitAtFRA * MONTHS_PER_YEAR * ssBenefitMultiplier(ssClaimAge),
    magiHistory: new Array(MAGI_LOOKBACK_YEARS).fill(0),
    ruleOf55Applies: isRuleOf55Eligible(assumptions.currentAge, assumptions.currentAge),
  };
}

// ─── Phase-template conversion sizing ──────────────────────────────────────────

/**
 * Returns how much additional taxable income fits before the top of the
 * ordinary-income bracket band that contains `taxableIncome`.
 * Returns Infinity if already in the top band (no upper bound).
 */
function ordinaryBracketHeadroom(
  taxableIncome: number,
  edges: readonly { readonly min: number; readonly rate: number }[],
): number {
  for (let i = 0; i < edges.length; i++) {
    const bandTop = i + 1 < edges.length ? edges[i + 1].min : Infinity;
    if (taxableIncome < bandTop) return bandTop - taxableIncome;
  }
  return Infinity;
}

/**
 * Returns how much additional taxable income fits before the top of the
 * bracket band whose rate equals `targetRate`. Returns 0 if `taxableIncome`
 * has already passed that band.
 */
function bracketTopHeadroom(
  taxableIncome: number,
  edges: readonly { readonly min: number; readonly rate: number }[],
  targetRate: number,
): number {
  const targetIndex = edges.findIndex((edge) => edge.rate === targetRate);
  if (targetIndex === -1) return 0;
  const bandTop = targetIndex + 1 < edges.length ? edges[targetIndex + 1].min : Infinity;
  return Math.max(0, bandTop - taxableIncome);
}

/**
 * Returns how much additional MAGI fits before crossing the next IRMAA tier.
 * Returns Infinity if `magi` is already at or above the highest tier.
 */
function irmaaTierHeadroom(magi: number, thresholds: readonly number[]): number {
  for (const threshold of thresholds) {
    if (magi < threshold) return threshold - magi;
  }
  return Infinity;
}

/**
 * Converts a coarse PhaseTemplate intensity into a concrete conversion dollar
 * amount, clamped to the traditional balance remaining after this year's RMD.
 *
 * - 'conservative' → fill to the top of the current ordinary bracket
 * - 'moderate'     → fill to the next IRMAA tier boundary
 * - 'aggressive'   → fill to the top of the 24% bracket OR the next IRMAA
 *                     tier, whichever leaves less headroom
 */
function conversionAmountForTemplate(
  template: PhaseTemplate,
  state: YearState,
  assumptions: Assumptions,
): number {
  const AGGRESSIVE_TARGET_RATE = 0.24;
  const rmd = computeRmd(state.traditional, state.age, assumptions.birthYear);
  const stdDeduction = standardDeduction(state.year, state.filingStatus, state.age);
  const baseTaxable = Math.max(0, rmd - stdDeduction);
  const edges = ordinaryBracketEdges(state.year, state.filingStatus);
  const irmaaThresholds = irmaaTierThresholds(state.year, state.filingStatus);

  let amount: number;
  if (template === 'conservative') {
    amount = ordinaryBracketHeadroom(baseTaxable, edges);
  } else if (template === 'moderate') {
    amount = irmaaTierHeadroom(rmd, irmaaThresholds);
  } else {
    const bracket24Room = bracketTopHeadroom(baseTaxable, edges, AGGRESSIVE_TARGET_RATE);
    const irmaaRoom = irmaaTierHeadroom(rmd, irmaaThresholds);
    amount = Math.min(bracket24Room, irmaaRoom);
  }

  const traditionalAfterRmd = Math.max(0, state.traditional - rmd);
  return Math.min(Math.max(0, amount), traditionalAfterRmd);
}

/**
 * Translates a Strategy into a concrete YearDecision for the given simulation
 * year. Explicit `perYear` decisions take precedence over `phaseTemplates`.
 * Falls back to a zero-conversion decision if neither is specified (or the
 * current phase has no template).
 *
 * @example
 * resolveDecision({ ssClaimAge: 67, perYear: [{ conversionAmount: 50_000, withdrawalOrder: [...] }] }, state, 0, assumptions)
 */
export function resolveDecision(
  strategy: Strategy,
  state: YearState,
  simulationYear: number,
  assumptions: Assumptions,
): YearDecision {
  if (strategy.perYear) {
    return strategy.perYear[simulationYear] ?? ZERO_CONVERSION_DECISION;
  }

  if (strategy.phaseTemplates) {
    const phase = currentPhase(state.age, assumptions.birthYear);
    const template = strategy.phaseTemplates[phase];
    if (!template) return ZERO_CONVERSION_DECISION;
    return {
      conversionAmount: conversionAmountForTemplate(template, state, assumptions),
      withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER,
    };
  }

  return ZERO_CONVERSION_DECISION;
}

// ─── Estate cost ────────────────────────────────────────────────────────────────

/**
 * One-time terminal cost applied at the end of the simulation horizon.
 *
 * Order of operations matters (IRC §2058): WA estate tax is computed first,
 * on the full estate value above the WA exemption. The federal taxable estate
 * is then the estate value minus the federal exemption AND minus the WA tax
 * just paid — state estate tax is deductible from the federal base.
 *
 * Also accounts for the heir's 10-year-rule income tax on the inherited
 * traditional balance, offset by the step-up-in-basis benefit on the taxable
 * account (unrealized gains disappear at death).
 *
 * @example
 * computeEstateCost(terminalState, assumptions) // total estate-related cost
 */
export function computeEstateCost(terminalState: YearState, assumptions: Assumptions): number {
  const { traditional, roth, taxable, year, filingStatus } = terminalState;
  const estateValue = traditional + roth + taxable.value;

  // Step 1: WA estate tax, computed on the full estate above WA's exemption.
  const exemptionMultiplier = filingStatus === 'mfj' ? MFJ_EXEMPTION_MULTIPLIER : 1;
  const waExemption = waEstateExemption(year) * exemptionMultiplier;
  const waTax = waEstateTax(Math.max(0, estateValue - waExemption));

  // Step 2: Federal estate tax, base reduced by both the federal exemption
  // and the WA tax already paid (§2058 deduction).
  const fedExemption = federalEstateExemption(year, filingStatus);
  const fedTaxableEstate = Math.max(0, estateValue - fedExemption - waTax);
  const fedTax = federalEstateTax(fedTaxableEstate);

  // Step 3: Heir's income tax on the inherited traditional balance (10-yr rule).
  const heirIncomeTax = traditional * assumptions.heirMarginalRate;

  // Step 4: Step-up in basis eliminates the heir's capital gains liability on
  // the taxable account's unrealized appreciation.
  const unrealizedGain = Math.max(0, taxable.value - taxable.basis);
  const stepUpBenefit = unrealizedGain * HEIR_CAPITAL_GAINS_RATE;

  return waTax + fedTax + heirIncomeTax - stepUpBenefit;
}

// ─── Per-year state advancement ────────────────────────────────────────────────

/**
 * Applies the start-of-year transitions that don't depend on computeYear:
 * locking in the SS claim once the claim age is reached, and recomputing
 * Rule-of-55 eligibility for the current age.
 */
function advanceEligibility(state: YearState, strategy: Strategy, assumptions: Assumptions): YearState {
  const ssClaimed = state.ssClaimed || state.age >= strategy.ssClaimAge;
  const ruleOf55Applies = isRuleOf55Eligible(state.age, assumptions.currentAge);
  if (ssClaimed === state.ssClaimed && ruleOf55Applies === state.ruleOf55Applies) return state;
  return { ...state, ssClaimed, ruleOf55Applies };
}

// ─── Main entry point ───────────────────────────────────────────────────────────

/**
 * Runs the full forward simulation for the given strategy and assumptions.
 * Deterministic and pure: same inputs always produce the same output, with
 * no side effects and no mutation of either argument.
 *
 * @example
 * const { totalCost, trace } = simulate(strategy, assumptions);
 */
export function simulate(strategy: Strategy, assumptions: Assumptions): SimResult {
  const numYears = assumptions.horizonAge - assumptions.currentAge;
  const trace: YearRecord[] = [];
  let state = initialState(assumptions, strategy.ssClaimAge);
  let totalCost = 0;

  for (let simulationYear = 0; simulationYear < numYears; simulationYear++) {
    state = advanceEligibility(state, strategy, assumptions);
    const decision = resolveDecision(strategy, state, simulationYear, assumptions);
    const { yearCost, nextState, record } = computeYear(state, decision, assumptions, simulationYear);

    totalCost += yearCost * discountFactor(simulationYear, assumptions.discountRate);
    trace.push(record);
    state = nextState;
  }

  const estateCost = computeEstateCost(state, assumptions);
  totalCost += estateCost * discountFactor(numYears, assumptions.discountRate);

  return { totalCost, terminalState: state, trace };
}
