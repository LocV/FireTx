# Task 07 — Backward Dynamic Programming Optimizer

## Goal
Implement the backward DP optimizer that finds the globally optimal Roth
conversion schedule. This is the rigorous solver — use it to validate the
greedy optimizer and as the "Deep Optimize" mode in the UI.

## Reference
`docs/03-optimization.md` — §4 "Recommended solver", §5 "The hard part: IRMAA Markov fix"

## Pre-conditions
Tasks 01–06 complete. The greedy optimizer (task 05) must be passing its
tests and producing sensible results. The DP result should always be ≤ greedy.

## Files to Create
```
src/engine/optimizer/dp.ts
src/engine/optimizer/dp.test.ts
src/engine/optimizer/coordinate.ts      ← phase-template coordinate search (used by DP)
src/engine/optimizer/coordinate.test.ts
src/engine/optimizer/fixedPoint.ts      ← fixed-point iteration wrapper
src/engine/optimizer/fixedPoint.test.ts
```

---

## Part A: `coordinate.ts` — Coordinate Search on Phase Templates

### `optimizeCoordinate`
```ts
/**
 * Optimizes a Strategy by cycling through phases one at a time,
 * testing all three intensity levels, and keeping improvements.
 * Continues until a full sweep produces no improvement (local optimum).
 *
 * Algorithm:
 *   1. Start from defaultPhaseTemplates (all 'moderate')
 *   2. For each phase in PHASES:
 *        For each level in ['conservative', 'moderate', 'aggressive']:
 *          trial = { ...best, phaseTemplates: { ...best.phaseTemplates, [phase]: level } }
 *          if simulate(trial).totalCost < simulate(best).totalCost: best = trial
 *   3. Repeat until no improvement
 *   4. Try all SS claim ages (62–70) on the best template found; keep the cheapest
 *
 * Transparent: the returned strategy shows exactly which phase is
 * driving the savings and how much each phase contributes.
 *
 * @returns Strategy that is a local optimum in template × SS-claim-age space
 */
export function optimizeCoordinate(assumptions: Assumptions): {
  strategy: Strategy;
  result: SimResult;
  iterations: number;
}
```

---

## Part B: `fixedPoint.ts` — Fixed-Point Iteration

### `optimizeFixedPoint`
```ts
/**
 * Resolves the circular dependency between early-phase conversions and late-phase RMDs
 * by iterating to a self-consistent terminal balance.
 *
 * Algorithm:
 *   1. Guess B_target = initial traditional balance × 0.5
 *   2. Run optimizeCoordinate() with an added constraint to target B_target by age 75
 *   3. Observe B_actual from the resulting simulation
 *   4. If |B_actual - B_target| < TOLERANCE: return the strategy (converged)
 *   5. Update: B_target = 0.6 × B_target + 0.4 × B_actual  (damped to prevent oscillation)
 *   6. Repeat up to MAX_ITERATIONS (30); fall back to optimizeCoordinate if no convergence
 *
 * Typically converges in 5–10 iterations.
 */
export function optimizeFixedPoint(assumptions: Assumptions): {
  strategy: Strategy;
  result: SimResult;
  converged: boolean;
  iterations: number;
}
```

---

## Part C: `dp.ts` — Backward Dynamic Programming

### Constants (at the top of the file)
```ts
/** Granularity of the traditional-balance state grid. Coarser = faster; finer = more accurate. */
const BUCKET_SIZE_INITIAL = 25_000;   // start here
const BUCKET_SIZE_REFINED  = 5_000;   // refine sensitive regions after first pass

/** Maximum traditional balance to model (beyond this: linear extrapolation). */
const MAX_BALANCE = 5_000_000;

const CONVERGENCE_TOLERANCE = 5_000;  // fixed-point convergence in dollars
```

### `buildBalanceGrid`
```ts
/**
 * Returns an array of balance grid points from 0 to MAX_BALANCE in steps of bucketSize.
 * These are the state-space nodes the DP evaluates.
 */
export function buildBalanceGrid(bucketSize: number): readonly number[]
```

### `interpolateValue`
```ts
/**
 * Linear interpolation of the value function V(balance) between two adjacent grid points.
 * Used to evaluate V at balances that don't land exactly on the grid.
 * @param balance - The actual balance (may be between grid points)
 * @param grid - Sorted array of grid points
 * @param values - V(grid[i]) for each grid point i
 */
export function interpolateValue(
  balance: number,
  grid: readonly number[],
  values: readonly number[],
): number
```

### `stepCostWithIrmaaAttribution`
```ts
/**
 * Computes the per-year cost for the DP — critically, with IRMAA attributed
 * to the year that CAUSED it (this year's MAGI) rather than the year it is paid.
 *
 * ⚠️ THE MARKOV FIX: Standard computeYear uses MAGI from 2 years ago for IRMAA.
 * That couples non-adjacent years and breaks DP's Markov requirement.
 * This function instead includes the IRMAA that THIS YEAR'S MAGI will trigger
 * two years from now (discounted 2 years forward). This restores the Markov
 * property: cost depends only on (age, balance, decision), not on history.
 *
 * Formula:
 *   stepCost = incomeTax + niit + penalty + waCapGainsTax
 *            + discount²(irmaa(magi_thisYear))   ← attributed forward
 *   (Note: irmaa is 0 if age + 2 < 65 — Medicare not yet active)
 *
 * @param state - State at start of year (traditional balance = the DP state variable)
 * @param conversionAmount - The decision being evaluated
 * @param assumptions - Simulation assumptions
 */
export function stepCostWithIrmaaAttribution(
  state: YearState,
  conversionAmount: number,
  assumptions: Assumptions,
  simulationYear: number,
): number
```

### `solveDP`
```ts
/**
 * Solves the backward DP for a given SS claim age.
 * Returns the value function V[age][balanceBucketIndex] and the optimal
 * conversion policy policy[age][balanceBucketIndex].
 *
 * Backward recursion:
 *   Terminal condition (age = horizonAge):
 *     V[horizonAge][b] = computeEstateCost(stateWithBalance(b), assumptions)
 *
 *   For age = horizonAge-1 down to currentAge:
 *     For each balance bucket B in balanceGrid:
 *       For each c in candidateConversionAmounts(stateAt(age, B), ...):
 *         nextBalance = (B - rmd(B, age) - c) × (1 + expectedReturn)   // approx
 *         cost = stepCostWithIrmaaAttribution(age, B, c) + discount × interpolateValue(nextBalance)
 *       V[age][B] = min cost found; policy[age][B] = argmin c
 *
 * @returns { valueFunction, policy, grid }
 */
export function solveDP(
  assumptions: Assumptions,
  ssClaimAge: number,
): {
  valueFunction: readonly (readonly number[])[];  // [age_offset][bucket_index]
  policy: readonly (readonly number[])[];          // optimal conversion at each (age, bucket)
  grid: readonly number[];
}
```

### `reconstructStrategy`
```ts
/**
 * Replays the DP solution forward from the actual starting balance to
 * recover the full year-by-year conversion schedule.
 * The DP gives us policy[age][bucket] — this function follows the policy
 * starting from the real initial balance, interpolating between buckets at each step.
 *
 * @returns A fully-specified Strategy with perYear decisions
 */
export function reconstructStrategy(
  dpSolution: ReturnType<typeof solveDP>,
  assumptions: Assumptions,
  ssClaimAge: number,
): Strategy
```

### `dpOptimize` — Main Entry Point
```ts
/**
 * Runs the full DP optimization:
 *   1. Solve the DP for each SS claim age (62–70) in parallel if Workers available
 *   2. Reconstruct the optimal strategy for each
 *   3. Simulate each reconstructed strategy with simulate() for a final cost
 *   4. Return the SS claim age + strategy with the lowest simulated totalCost
 *
 * The final simulate() call serves as an independent correctness check —
 * if the simulated cost disagrees significantly with the DP's V[0][startBucket],
 * it indicates a bug in the interpolation or Markov attribution.
 */
export function dpOptimize(assumptions: Assumptions): {
  strategy: Strategy;
  result: SimResult;
  dpCostAtStart: number;   // V[0][startBucket] — should ≈ result.totalCost
}
```

---

## Tests Required

### Markov attribution correctness
```ts
// The total IRMAA from forward replay must equal the sum of attributed IRMAA
// computed by stepCostWithIrmaaAttribution across all years (within rounding).
// This proves the Markov reformulation is correct.
const { result, strategy } = dpOptimize(assumptions);
const attributedIrmaaTotal = result.trace
  .map(r => r.irmaaAttributed)  // requires YearRecord to carry this field
  .reduce((a, b) => a + b, 0);
const paidIrmaaTotal = result.trace
  .map(r => r.irmaa)
  .reduce((a, b) => a + b, 0);
expect(Math.abs(attributedIrmaaTotal - paidIrmaaTotal)).toBeLessThan(1_000);
```

### DP ≤ greedy (the key invariant)
```ts
const { result: dpResult } = dpOptimize(assumptions);
const { result: greedyResult } = greedyOptimize(assumptions);
expect(dpResult.totalCost).toBeLessThanOrEqual(greedyResult.totalCost * 1.001); // allow 0.1% rounding
```

### Grid convergence
```ts
// Halving BUCKET_SIZE should change totalCost by less than 1%
const coarseResult = dpOptimize({ ...assumptions, _bucketSize: 50_000 });
const fineResult   = dpOptimize({ ...assumptions, _bucketSize: 25_000 });
const delta = Math.abs(coarseResult.result.totalCost - fineResult.result.totalCost);
expect(delta / fineResult.result.totalCost).toBeLessThan(0.01);
```

### Flat-tax sanity check
```ts
// With a flat 20% tax on all income and no IRMAA/NIIT/estate,
// the DP optimum should be analytically derivable (or very close to the greedy).
// If these disagree by more than 2%, suspect the interpolation or attribution.
```

### Fixed-point convergence
```ts
const { converged, iterations } = optimizeFixedPoint(assumptions);
expect(converged).toBe(true);
expect(iterations).toBeLessThan(20);
```

## Acceptance Criteria
- [ ] `dpOptimize` result ≤ `greedyOptimize` result (DP invariant test passes)
- [ ] Markov attribution test: attributed IRMAA ≈ paid IRMAA
- [ ] Grid convergence test passes (halving bucket size changes result < 1%)
- [ ] `dpCostAtStart` ≈ `result.totalCost` (DP and forward simulation agree)
- [ ] Fixed-point converges in < 20 iterations on standard inputs
- [ ] Coordinate search `iterations` is logged on the returned object
- [ ] All tests pass; `npm run typecheck` clean
