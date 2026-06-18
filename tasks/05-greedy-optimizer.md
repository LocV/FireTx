# Task 05 — Greedy Fill-to-Cliff Optimizer

## Goal
Implement the "fill to the next cliff" baseline optimizer. This is the
reference sanity check — simple, fast, and typically within a few percent of
the true optimum. The UI in task 06 will use this optimizer initially.

## Reference
`docs/03-optimization.md` — §3 "The exploit" and §6 "Tiered build order"

## Pre-conditions
Tasks 01–04 complete.

## Files to Create
```
src/engine/optimizer/greedy.ts
src/engine/optimizer/greedy.test.ts
```

---

## How It Works

Each year, convert up to the most cost-effective nearby threshold:
1. Find all meaningful conversion ceilings for this year (bracket tops, IRMAA tier edges).
2. Pick the highest ceiling that doesn't cross into the next expensive cliff.
3. Cap at the available traditional balance and spending-adjusted income.

This is a single forward pass — no search, no iteration.

---

## Functions to Implement

### `candidateConversionAmounts`
```ts
/**
 * Returns the set of conversion amounts worth considering for the given year.
 * Optima almost always sit at a threshold edge, so we evaluate only these
 * meaningful breakpoints rather than scanning a continuous range.
 *
 * Candidates include (in ascending order):
 *   - 0 (no conversion)
 *   - Top of current ordinary bracket, minus baseOrdinaryIncome
 *   - Each IRMAA tier boundary minus 2-yr-lag adjustment and safety margin
 *   - NIIT threshold (frozen: $200k single / $250k MFJ)
 *   - 0% LTCG ceiling
 *   - Top of the 24% bracket (aggressive cap)
 *
 * All values are clamped to [0, state.traditional].
 *
 * @param state - Current year state (for baseOrdinaryIncome and balance)
 * @param simulationYear - Used to look up the correct IRMAA tier for year+2
 * @param assumptions - For filing status and projected table values
 */
export function candidateConversionAmounts(
  state: YearState,
  simulationYear: number,
  assumptions: Assumptions,
): readonly number[]
```

### `greedyConversionAmount`
```ts
/**
 * Selects the conversion amount that minimizes THIS YEAR'S total cost
 * from the candidate set. Evaluates each candidate with simulate() scoped
 * to a single year, picks the one with the lowest yearCost.
 *
 * Note: this is greedy (locally optimal) — it does not account for the
 * impact of this year's MAGI on next year's IRMAA (2-yr lag). That coupling
 * is handled by the DP optimizer in task 07.
 */
export function greedyConversionAmount(
  state: YearState,
  simulationYear: number,
  assumptions: Assumptions,
): number
```

### `buildGreedyStrategy`
```ts
/**
 * Runs a single forward pass from currentAge to horizonAge, selecting the
 * greedy-optimal conversion amount at each year.
 * Returns a fully-specified Strategy with perYear decisions populated.
 *
 * This strategy is the baseline. The DP optimizer (task 07) should always
 * produce a result at least as good as this.
 */
export function buildGreedyStrategy(assumptions: Assumptions): Strategy
```

### `greedyOptimize`
```ts
/**
 * Convenience wrapper: builds the greedy strategy for all SS claim ages (62–70),
 * simulates each, and returns the strategy + result with the lowest totalCost.
 *
 * @returns The best (strategy, SimResult) pair found across all SS claim ages
 */
export function greedyOptimize(
  assumptions: Assumptions,
): { strategy: Strategy; result: SimResult }
```

---

## Tests Required

### Candidate set properties
```ts
// Always includes 0
// Always sorted ascending
// Every value is in [0, state.traditional]
// Contains the IRMAA tier boundaries adjusted for 2-yr lag
const candidates = candidateConversionAmounts(state, year, assumptions);
expect(candidates[0]).toBe(0);
expect(candidates).toEqual([...candidates].sort((a, b) => a - b));
candidates.forEach(c => expect(c).toBeGreaterThanOrEqual(0));
candidates.forEach(c => expect(c).toBeLessThanOrEqual(state.traditional));
```

### Greedy never converts more than the traditional balance
```ts
const amount = greedyConversionAmount(state, year, assumptions);
expect(amount).toBeLessThanOrEqual(state.traditional);
expect(amount).toBeGreaterThanOrEqual(0);
```

### Strategy length matches horizon
```ts
const strategy = buildGreedyStrategy(assumptions);
expect(strategy.perYear).toHaveLength(assumptions.horizonAge - assumptions.currentAge);
```

### Greedy result is at least as good as zero-conversion strategy
```ts
const { result: greedyResult } = greedyOptimize(assumptions);
const zeroStrategy: Strategy = { ssClaimAge: 70, perYear: zeroes };
const zeroResult = simulate(zeroStrategy, assumptions);
expect(greedyResult.totalCost).toBeLessThanOrEqual(zeroResult.totalCost);
```

### SS claim age sweep
```ts
// greedyOptimize tries all 9 SS claim ages and returns the best
const { strategy } = greedyOptimize(assumptions);
expect(strategy.ssClaimAge).toBeGreaterThanOrEqual(62);
expect(strategy.ssClaimAge).toBeLessThanOrEqual(70);
```

## Acceptance Criteria
- [ ] `candidateConversionAmounts` returns threshold-edge values, not a uniform grid
- [ ] `buildGreedyStrategy` single forward pass — no recursive calls, no iteration
- [ ] `greedyOptimize` sweeps all 9 SS claim ages
- [ ] Greedy result ≤ zero-conversion result (test above passes)
- [ ] All tests pass; `npm run typecheck` clean
