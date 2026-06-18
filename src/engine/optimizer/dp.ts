/**
 * Backward dynamic programming optimizer (docs/03-optimization.md §6C) — the
 * rigorous, globally-optimal solver. Discretizes the traditional-balance axis
 * into buckets and solves V(age, balance) backward from the terminal age,
 * where each year's value depends only on the next year's already-solved
 * value (no circular dependency, no fixed-point iteration needed).
 *
 * STATE-SPACE SIMPLIFICATION: the DP grid tracks only the traditional balance.
 * Roth balance, taxable balance, SS-claimed status, and Rule-of-55 eligibility
 * follow a precomputed "baseline trajectory" (a zero-conversion forward pass
 * for the given SS claim age) — these don't materially interact with the
 * conversion decision the way the traditional balance does, and tracking them
 * as additional grid axes would make the DP intractable. This mirrors how
 * `candidateConversionAmounts` (task 05) already treats per-year table lookups
 * as a function of (year, filingStatus, traditional balance) only.
 *
 * THE MARKOV FIX: standard computeYear's IRMAA depends on magiHistory[year-2],
 * coupling non-adjacent years. `stepCostWithIrmaaAttribution` instead uses
 * `record.irmaaAttributed` — the IRMAA THIS year's MAGI will cause two years
 * from now — discounted back two years. This restores the Markov property:
 * cost depends only on (age, balance, decision).
 */

import { computeYear } from '../computeYear.ts';
import { computeEstateCost, discountFactor, initialState, simulate } from '../simulate.ts';
import { computeRmd } from '../tables/index.ts';
import { candidateConversionAmounts } from './greedy.ts';
import type { AccountSource, Assumptions, SimResult, Strategy, YearDecision, YearState } from '../types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Granularity of the traditional-balance state grid. Coarser = faster; finer = more accurate. */
export const BUCKET_SIZE_INITIAL = 25_000;
/** Refined bucket size for sensitive regions / convergence checks. */
export const BUCKET_SIZE_REFINED = 5_000;

/** Maximum traditional balance to model. Beyond this, interpolateValue extrapolates linearly. */
export const MAX_BALANCE = 5_000_000;

/** Fixed-point convergence tolerance, in dollars (re-exported for documentation parity). */
export const CONVERGENCE_TOLERANCE = 5_000;

/** Default account drawdown order used when reconstructing the DP strategy. */
const DEFAULT_WITHDRAWAL_ORDER: readonly AccountSource[] = ['taxable', 'traditional', 'roth'];

/** A no-op decision: no conversion, default withdrawal order. */
const ZERO_CONVERSION_DECISION: YearDecision = {
  conversionAmount: 0,
  withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER,
};

/**
 * IRMAA attributed to this year's MAGI is paid two years from now —
 * discount it back two years when folding it into this year's step cost.
 */
const IRMAA_ATTRIBUTION_LAG_YEARS = 2;

/** SS claim ages swept by dpOptimize. */
const MIN_SS_CLAIM_AGE = 62;
const MAX_SS_CLAIM_AGE = 70;

/** Age at which Rule of 55 stops applying (mirrors computeYear's PENALTY_FREE_AGE). */
const RULE_OF_55_UPPER_AGE = 59.5;
const RULE_OF_55_LOWER_AGE = 55;

// ─── buildBalanceGrid ───────────────────────────────────────────────────────────

/**
 * Returns balance grid points from 0 to MAX_BALANCE in steps of `bucketSize`.
 * These are the state-space nodes the DP evaluates.
 *
 * @example
 * buildBalanceGrid(25_000).length // 201
 */
export function buildBalanceGrid(bucketSize: number): readonly number[] {
  const grid: number[] = [];
  for (let balance = 0; balance <= MAX_BALANCE; balance += bucketSize) {
    grid.push(balance);
  }
  return grid;
}

// ─── interpolateValue ───────────────────────────────────────────────────────────

/**
 * Linear interpolation (or extrapolation beyond the grid) of a value function
 * V(balance) given its values at each grid point. Assumes `grid` is uniformly
 * spaced and ascending, starting at 0 (as produced by `buildBalanceGrid`).
 *
 * @param balance - The actual balance, possibly between grid points or beyond MAX_BALANCE
 * @param grid - Sorted, uniformly-spaced grid points (e.g. from buildBalanceGrid)
 * @param values - V(grid[i]) for each grid point i
 * @example
 * interpolateValue(12_500, [0, 25_000], [0, 100]) // 50
 */
export function interpolateValue(
  balance: number,
  grid: readonly number[],
  values: readonly number[],
): number {
  const last = grid.length - 1;
  const bucketSize = grid[1] - grid[0];

  if (balance <= grid[0]) return values[0];
  if (balance >= grid[last]) {
    const slope = (values[last] - values[last - 1]) / bucketSize;
    return values[last] + slope * (balance - grid[last]);
  }

  const lowerIndex = Math.floor((balance - grid[0]) / bucketSize);
  const fraction = (balance - grid[lowerIndex]) / bucketSize;
  return values[lowerIndex] * (1 - fraction) + values[lowerIndex + 1] * fraction;
}

// ─── Baseline trajectory (non-traditional state fields) ─────────────────────────

/**
 * Mirrors the eligibility-tracking logic in simulate.ts/greedy.ts: locks in
 * the SS claim once `ssClaimAge` is reached and recomputes Rule-of-55
 * eligibility for the current age.
 *
 * SIMPLIFICATION (matches simulate.ts): assumes separation from employer at
 * assumptions.currentAge.
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

/**
 * Builds the per-age "baseline" YearState trajectory (length numYears + 1)
 * via a zero-conversion forward pass. Only the non-traditional fields
 * (roth, taxable, SS status, filing status, ruleOf55Applies, age, year) are
 * used by the DP — `traditional` is overridden with each grid bucket value.
 */
function buildBaselineStates(assumptions: Assumptions, ssClaimAge: number): readonly YearState[] {
  const numYears = assumptions.horizonAge - assumptions.currentAge;
  const states: YearState[] = [advanceEligibility(initialState(assumptions, ssClaimAge), ssClaimAge, assumptions)];

  for (let simulationYear = 0; simulationYear < numYears; simulationYear++) {
    const { nextState } = computeYear(states[simulationYear], ZERO_CONVERSION_DECISION, assumptions, simulationYear);
    states.push(advanceEligibility(nextState, ssClaimAge, assumptions));
  }

  return states;
}

// ─── stepCostWithIrmaaAttribution ────────────────────────────────────────────────

/**
 * Computes the per-year DP step cost — critically, with IRMAA attributed to
 * the year that CAUSED it (this year's MAGI) rather than the year it is paid.
 *
 * Formula: stepCost = federalIncomeTax + stateTax + niit + penalty + waCapGainsTax
 *                    + discount²(irmaaAttributed)
 *
 * `record.irmaa` (driven by magiHistory) is intentionally excluded — it
 * couples non-adjacent years and is replaced by the forward-attributed value,
 * which depends only on this year's (age, balance, decision).
 *
 * @example
 * stepCostWithIrmaaAttribution(state, 50_000, assumptions, 5)
 */
export function stepCostWithIrmaaAttribution(
  state: YearState,
  conversionAmount: number,
  assumptions: Assumptions,
  simulationYear: number,
): number {
  const decision: YearDecision = { conversionAmount, withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER };
  const { record } = computeYear(state, decision, assumptions, simulationYear);
  const discountedIrmaa =
    record.irmaaAttributed * discountFactor(IRMAA_ATTRIBUTION_LAG_YEARS, assumptions.discountRate);

  return record.federalIncomeTax + record.stateTax + record.niit + record.penalty + record.waCapGainsTax + discountedIrmaa;
}

// ─── Backward recursion helpers ─────────────────────────────────────────────────

/** Clamps a projected balance into the modeled range [0, MAX_BALANCE]. */
function clampBalance(balance: number): number {
  return Math.min(MAX_BALANCE, Math.max(0, balance));
}

/**
 * Evaluates a single (balance, conversion-candidate) pair: this year's
 * attributed step cost plus the discounted, interpolated value of next
 * year's state after RMD, spending withdrawals, conversion, and growth.
 *
 * Calls computeYear directly (rather than via stepCostWithIrmaaAttribution +
 * an approximate `(B - rmd - c) * (1 + r)` formula) so the next-balance used
 * here exactly matches what reconstructStrategy's forward replay will see —
 * including any additional traditional withdrawals needed to cover spending
 * beyond RMD + SS. This keeps dpCostAtStart consistent with the forward
 * simulation's totalCost.
 */
function evaluateCandidate(
  stateAtBalance: YearState,
  conversionAmount: number,
  assumptions: Assumptions,
  ageOffset: number,
  grid: readonly number[],
  nextValues: readonly number[],
): number {
  const decision: YearDecision = { conversionAmount, withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER };
  const { record, nextState } = computeYear(stateAtBalance, decision, assumptions, ageOffset);
  const discountedIrmaa =
    record.irmaaAttributed * discountFactor(IRMAA_ATTRIBUTION_LAG_YEARS, assumptions.discountRate);
  const stepCost = record.federalIncomeTax + record.stateTax + record.niit + record.penalty + record.waCapGainsTax + discountedIrmaa;

  const nextBalance = clampBalance(nextState.traditional);
  const future = interpolateValue(nextBalance, grid, nextValues);
  return stepCost + discountFactor(1, assumptions.discountRate) * future;
}

/**
 * Finds the cost-minimizing conversion amount (and its cost) for a single
 * balance bucket at a given age, evaluated against next year's value function.
 */
function evaluateBucket(
  balance: number,
  baseState: YearState,
  assumptions: Assumptions,
  ageOffset: number,
  grid: readonly number[],
  nextValues: readonly number[],
): { value: number; conversion: number } {
  const stateAtBalance: YearState = { ...baseState, traditional: balance };
  const candidates = candidateConversionAmounts(stateAtBalance, ageOffset, assumptions);

  let bestValue = Infinity;
  let bestConversion = 0;
  for (const conversionAmount of candidates) {
    const total = evaluateCandidate(stateAtBalance, conversionAmount, assumptions, ageOffset, grid, nextValues);
    if (total < bestValue) {
      bestValue = total;
      bestConversion = conversionAmount;
    }
  }
  return { value: bestValue, conversion: bestConversion };
}

/** Solves V(ageOffset, ·) and policy(ageOffset, ·) given next year's value function. */
function solveAgeStep(
  grid: readonly number[],
  baseState: YearState,
  assumptions: Assumptions,
  ageOffset: number,
  nextValues: readonly number[],
): { values: readonly number[]; policy: readonly number[] } {
  const values: number[] = [];
  const policy: number[] = [];

  for (const balance of grid) {
    const { value, conversion } = evaluateBucket(balance, baseState, assumptions, ageOffset, grid, nextValues);
    values.push(value);
    policy.push(conversion);
  }

  return { values, policy };
}

// ─── solveDP ──────────────────────────────────────────────────────────────────────

/**
 * Solves the backward DP for a given SS claim age: the value function
 * V[ageOffset][bucketIndex] (minimum remaining cost from that age/balance)
 * and the optimal conversion policy at each (age, balance) pair.
 *
 * Terminal condition: V[numYears][b] = computeEstateCost(balance = grid[b]).
 * For earlier ages, V[age][b] = min over conversion candidates of
 * (this year's attributed cost + discounted V[age+1][nextBalanceBucket]).
 *
 * @param bucketSize - Grid granularity (DOCUMENTED ADDITION beyond the spec
 *   signature, defaulting to BUCKET_SIZE_INITIAL) — lets callers run grid
 *   convergence checks without mutating Assumptions.
 * @example
 * const { valueFunction, policy, grid } = solveDP(assumptions, 67);
 */
export function solveDP(
  assumptions: Assumptions,
  ssClaimAge: number,
  bucketSize: number = BUCKET_SIZE_INITIAL,
): {
  valueFunction: readonly (readonly number[])[];
  policy: readonly (readonly number[])[];
  grid: readonly number[];
} {
  const numYears = assumptions.horizonAge - assumptions.currentAge;
  const grid = buildBalanceGrid(bucketSize);
  const baseline = buildBaselineStates(assumptions, ssClaimAge);

  const valueFunction: (readonly number[])[] = new Array(numYears + 1);
  const policy: (readonly number[])[] = new Array(numYears);

  // Terminal condition: whatever traditional balance remains triggers the estate/heir cost.
  valueFunction[numYears] = grid.map((balance) =>
    computeEstateCost({ ...baseline[numYears], traditional: balance }, assumptions),
  );

  for (let ageOffset = numYears - 1; ageOffset >= 0; ageOffset--) {
    const { values, policy: agePolicy } = solveAgeStep(grid, baseline[ageOffset], assumptions, ageOffset, valueFunction[ageOffset + 1]);
    valueFunction[ageOffset] = values;
    policy[ageOffset] = agePolicy;
  }

  return { valueFunction, policy, grid };
}

// ─── reconstructStrategy ────────────────────────────────────────────────────────

/** Clamps a (possibly interpolated) policy conversion to [0, balance - RMD]. */
function clampToAvailable(conversionAmount: number, state: YearState, assumptions: Assumptions): number {
  const rmd = computeRmd(state.traditional, state.age, assumptions.birthYear);
  const available = Math.max(0, state.traditional - rmd);
  return Math.min(Math.max(0, conversionAmount), available);
}

/**
 * Replays the DP solution forward from the actual starting traditional
 * balance, following `policy[age][bucket]` (interpolated between buckets) at
 * each step to recover the full year-by-year conversion schedule.
 *
 * @returns A fully-specified Strategy with `perYear` decisions populated
 * @example
 * const strategy = reconstructStrategy(solveDP(assumptions, 67), assumptions, 67);
 */
export function reconstructStrategy(
  dpSolution: ReturnType<typeof solveDP>,
  assumptions: Assumptions,
  ssClaimAge: number,
): Strategy {
  const { policy, grid } = dpSolution;
  const numYears = assumptions.horizonAge - assumptions.currentAge;
  const baseline = buildBaselineStates(assumptions, ssClaimAge);
  const perYear: YearDecision[] = [];
  let balance = assumptions.traditional;

  for (let ageOffset = 0; ageOffset < numYears; ageOffset++) {
    const stateAtBalance: YearState = { ...baseline[ageOffset], traditional: balance };
    const interpolated = interpolateValue(balance, grid, policy[ageOffset]);
    const conversionAmount = clampToAvailable(interpolated, stateAtBalance, assumptions);
    const decision: YearDecision = { conversionAmount, withdrawalOrder: DEFAULT_WITHDRAWAL_ORDER };

    perYear.push(decision);
    balance = computeYear(stateAtBalance, decision, assumptions, ageOffset).nextState.traditional;
  }

  return { ssClaimAge, perYear };
}

// ─── dpOptimize ─────────────────────────────────────────────────────────────────

/**
 * Runs the full DP optimization: solves the DP for each SS claim age
 * (62-70), reconstructs and forward-simulates the resulting strategy, and
 * returns the cheapest one. The forward `simulate()` call is an independent
 * correctness check — `dpCostAtStart` (the DP's own V[0][startBucket]) should
 * closely match `result.totalCost`.
 *
 * @param bucketSize - Grid granularity (DOCUMENTED ADDITION beyond the spec
 *   signature, defaulting to BUCKET_SIZE_INITIAL) — used for grid convergence checks.
 * @example
 * const { strategy, result, dpCostAtStart } = dpOptimize(assumptions);
 */
export function dpOptimize(
  assumptions: Assumptions,
  bucketSize: number = BUCKET_SIZE_INITIAL,
): { strategy: Strategy; result: SimResult; dpCostAtStart: number } {
  let best: { strategy: Strategy; result: SimResult; dpCostAtStart: number } | null = null;

  for (let ssClaimAge = MIN_SS_CLAIM_AGE; ssClaimAge <= MAX_SS_CLAIM_AGE; ssClaimAge++) {
    const dpSolution = solveDP(assumptions, ssClaimAge, bucketSize);
    const strategy = reconstructStrategy(dpSolution, assumptions, ssClaimAge);
    const result = simulate(strategy, assumptions);
    const dpCostAtStart = interpolateValue(assumptions.traditional, dpSolution.grid, dpSolution.valueFunction[0]);

    if (best === null || result.totalCost < best.result.totalCost) {
      best = { strategy, result, dpCostAtStart };
    }
  }

  // MIN_SS_CLAIM_AGE..MAX_SS_CLAIM_AGE always yields at least one candidate.
  return best as { strategy: Strategy; result: SimResult; dpCostAtStart: number };
}
