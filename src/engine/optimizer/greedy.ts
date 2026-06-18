/**
 * The "fill to the next cliff" greedy optimizer — a single forward pass that
 * picks, for each year, the locally cost-minimizing Roth conversion amount
 * from a small set of threshold-edge candidates. This is the reference
 * baseline: fast, simple, and typically within a few percent of the true
 * (DP-computed) optimum.
 */

import { computeYear } from '../computeYear.ts';
import { initialState, simulate } from '../simulate.ts';
import {
  computeRmd,
  irmaaTierThresholds,
  ltcgBracketEdges,
  ordinaryBracketEdges,
  standardDeduction,
} from '../tables/index.ts';
import type {
  AccountSource,
  Assumptions,
  FilingStatus,
  SimResult,
  Strategy,
  YearDecision,
  YearState,
} from '../types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default account drawdown order used by the greedy strategy. */
const DEFAULT_WITHDRAWAL_ORDER: readonly AccountSource[] = ['taxable', 'traditional', 'roth'];

/**
 * Frozen (never inflation-adjusted) NIIT MAGI thresholds.
 * Mirrors the constant of the same name in computeYear.ts, which is not exported.
 */
const NIIT_THRESHOLD: Record<FilingStatus, number> = { single: 200_000, mfj: 250_000 };

/** The bracket rate the 'aggressive' candidate fills up to. */
const AGGRESSIVE_TARGET_RATE = 0.24;

/**
 * IRMAA in year Y is driven by MAGI from year Y-2. So a conversion made this
 * year first affects IRMAA tables two calendar years from now.
 */
const IRMAA_ATTRIBUTION_LAG_YEARS = 2;

/** SS claim ages swept by greedyOptimize. */
const MIN_SS_CLAIM_AGE = 62;
const MAX_SS_CLAIM_AGE = 70;
/** SS claim age used by buildGreedyStrategy when none is supplied. */
const DEFAULT_SS_CLAIM_AGE = 67;

/** Age at which Rule of 55 stops applying (same as PENALTY_FREE_AGE in computeYear). */
const RULE_OF_55_UPPER_AGE = 59.5;
const RULE_OF_55_LOWER_AGE = 55;

// ─── Bracket headroom helpers ──────────────────────────────────────────────────

/**
 * Returns how much additional taxable income fits before the top of the
 * bracket band that contains `taxableIncome`. Infinity if already in the
 * top (unbounded) band.
 */
function headroomToBandTop(
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
function headroomToRate(
  taxableIncome: number,
  edges: readonly { readonly min: number; readonly rate: number }[],
  targetRate: number,
): number {
  const targetIndex = edges.findIndex((edge) => edge.rate === targetRate);
  if (targetIndex === -1) return 0;
  const bandTop = targetIndex + 1 < edges.length ? edges[targetIndex + 1].min : Infinity;
  return Math.max(0, bandTop - taxableIncome);
}

// ─── candidateConversionAmounts ────────────────────────────────────────────────

/**
 * Returns the set of conversion amounts worth considering for the given year.
 * Optima almost always sit at a threshold edge, so we evaluate only these
 * meaningful breakpoints rather than scanning a continuous range.
 *
 * Candidates include (deduplicated, ascending order):
 *   - 0 (no conversion)
 *   - Top of current ordinary bracket, minus baseOrdinaryIncome (RMD)
 *   - Each IRMAA tier boundary (projected 2 years ahead), minus baseOrdinaryIncome
 *   - NIIT threshold (frozen: $200k single / $250k MFJ), minus baseOrdinaryIncome
 *   - The 0% LTCG ceiling, minus baseTaxableIncome
 *   - Top of the 24% bracket (aggressive cap)
 *
 * All values are clamped to [0, state.traditional].
 *
 * @example
 * candidateConversionAmounts(state, 0, assumptions)[0] // 0
 */
export function candidateConversionAmounts(
  state: YearState,
  // Kept for signature symmetry with greedyConversionAmount/computeYear (which need
  // the 0-based simulation index for trace bookkeeping); table lookups here use the
  // calendar year on `state` instead, so this index is intentionally unused.
  _simulationYear: number,
  assumptions: Assumptions,
): readonly number[] {
  const rmd = computeRmd(state.traditional, state.age, assumptions.birthYear);
  const stdDeduction = standardDeduction(state.year, state.filingStatus, state.age);
  const baseTaxable = Math.max(0, rmd - stdDeduction);

  const ordinaryEdges = ordinaryBracketEdges(state.year, state.filingStatus);
  const ltcgEdges = ltcgBracketEdges(state.year, state.filingStatus);
  const irmaaThresholds = irmaaTierThresholds(
    state.year + IRMAA_ATTRIBUTION_LAG_YEARS,
    state.filingStatus,
  );

  const raw = [
    0,
    headroomToBandTop(baseTaxable, ordinaryEdges),
    ...irmaaThresholds.map((threshold) => threshold - rmd),
    NIIT_THRESHOLD[state.filingStatus] - rmd,
    ltcgEdges[1].min - baseTaxable,
    headroomToRate(baseTaxable, ordinaryEdges, AGGRESSIVE_TARGET_RATE),
  ];

  const clamped = raw.map((value) => Math.min(Math.max(0, value), state.traditional));
  const unique = [...new Set(clamped)];
  return unique.sort((a, b) => a - b);
}

// ─── greedyConversionAmount ────────────────────────────────────────────────────

/**
 * Selects the conversion amount that minimizes THIS YEAR'S total cost from
 * the candidate set, by running computeYear once per candidate and comparing
 * yearCost.
 *
 * Note: this is greedy (locally optimal) — it does not account for the
 * impact of this year's MAGI on next year's IRMAA (2-yr lag). That coupling
 * is handled by the DP optimizer (task 07).
 *
 * @example
 * greedyConversionAmount(state, 0, assumptions) // e.g. 48_475
 */
export function greedyConversionAmount(
  state: YearState,
  simulationYear: number,
  assumptions: Assumptions,
): number {
  const candidates = candidateConversionAmounts(state, simulationYear, assumptions);

  let bestAmount = 0;
  let bestCost = Infinity;
  for (const conversionAmount of candidates) {
    const decision: YearDecision = { conversionAmount, withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER };
    const { yearCost } = computeYear(state, decision, assumptions, simulationYear);
    if (yearCost < bestCost) {
      bestCost = yearCost;
      bestAmount = conversionAmount;
    }
  }
  return bestAmount;
}

// ─── Eligibility tracking ──────────────────────────────────────────────────────

/**
 * Updates SS-claimed and Rule-of-55 flags for the current age, mirroring the
 * eligibility logic in simulate.ts's forward loop.
 *
 * SIMPLIFICATION (matches simulate.ts): the person is assumed to separate
 * from their employer at assumptions.currentAge, so Rule of 55 applies only
 * if that age is >= 55 and the current age is in [55, 59.5).
 */
function advanceEligibility(state: YearState, ssClaimAge: number, assumptions: Assumptions): YearState {
  const ssClaimed = state.ssClaimed || state.age >= ssClaimAge;
  const ruleOf55Applies =
    assumptions.currentAge >= RULE_OF_55_LOWER_AGE &&
    state.age >= RULE_OF_55_LOWER_AGE &&
    state.age < RULE_OF_55_UPPER_AGE;
  if (ssClaimed === state.ssClaimed && ruleOf55Applies === state.ruleOf55Applies) return state;
  return { ...state, ssClaimed, ruleOf55Applies };
}

// ─── buildGreedyStrategy ────────────────────────────────────────────────────────

/**
 * Runs a single forward pass from currentAge to horizonAge, selecting the
 * greedy-optimal conversion amount at each year. Returns a fully-specified
 * Strategy with perYear decisions populated.
 *
 * @param ssClaimAge - Social Security claim age for this strategy. Defaults
 *   to 67; greedyOptimize sweeps this across 62-70.
 * @example
 * buildGreedyStrategy(assumptions).perYear.length // horizonAge - currentAge
 */
export function buildGreedyStrategy(
  assumptions: Assumptions,
  ssClaimAge: number = DEFAULT_SS_CLAIM_AGE,
): Strategy {
  const numYears = assumptions.horizonAge - assumptions.currentAge;
  const perYear: YearDecision[] = [];
  let state = initialState(assumptions, ssClaimAge);

  for (let simulationYear = 0; simulationYear < numYears; simulationYear++) {
    state = advanceEligibility(state, ssClaimAge, assumptions);
    const conversionAmount = greedyConversionAmount(state, simulationYear, assumptions);
    const decision: YearDecision = { conversionAmount, withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER };
    perYear.push(decision);
    state = computeYear(state, decision, assumptions, simulationYear).nextState;
  }

  return { ssClaimAge, perYear };
}

// ─── greedyOptimize ─────────────────────────────────────────────────────────────

/**
 * Convenience wrapper: builds the greedy strategy for all SS claim ages
 * (62-70), simulates each, and returns the strategy + result with the
 * lowest totalCost.
 *
 * @returns The best (strategy, SimResult) pair found across all SS claim ages
 * @example
 * const { strategy, result } = greedyOptimize(assumptions);
 */
export function greedyOptimize(assumptions: Assumptions): { strategy: Strategy; result: SimResult } {
  let best: { strategy: Strategy; result: SimResult } | null = null;

  for (let ssClaimAge = MIN_SS_CLAIM_AGE; ssClaimAge <= MAX_SS_CLAIM_AGE; ssClaimAge++) {
    const strategy = buildGreedyStrategy(assumptions, ssClaimAge);
    const result = simulate(strategy, assumptions);
    if (best === null || result.totalCost < best.result.totalCost) {
      best = { strategy, result };
    }
  }

  // numYears >= 1 for any sensible horizon, so MIN_SS_CLAIM_AGE..MAX_SS_CLAIM_AGE
  // always produces at least one candidate.
  return best as { strategy: Strategy; result: SimResult };
}
