# Task 04 — Forward Simulator (simulate)

## Goal
Implement the outer simulation loop that runs `computeYear` across all years,
accumulates cost, and produces a `SimResult`. This is Layer 1 — deterministic,
no search, no optimization.

## Reference
`docs/02-simulator-algorithm.md` — §4 "The forward simulator" and §5 "Estate cost"

## Pre-conditions
Tasks 01, 02, and 03 complete.

## Files to Create
```
src/engine/simulate.ts
src/engine/simulate.test.ts
```

---

## Functions to Implement

### `initialState`
```ts
/**
 * Builds the starting YearState from user-supplied assumptions and a chosen SS claim age.
 * Determines whether Rule of 55 applies based on separation age vs. current age.
 * Pre-populates magiHistory with placeholder zeros so IRMAA lookback doesn't throw
 * on the first two simulation years.
 */
export function initialState(assumptions: Assumptions, ssClaimAge: number): YearState
```

### `resolveDecision`
```ts
/**
 * Translates a Strategy into a concrete YearDecision for the given year.
 *
 * If strategy.perYear is provided: returns strategy.perYear[simulationYear] directly.
 *
 * If strategy.phaseTemplates is provided: determines the current Phase from state.age,
 * looks up the template intensity for that phase, and converts it to a dollar amount:
 *   - 'conservative' → convert to top of current bracket only
 *   - 'moderate'     → convert to next IRMAA tier boundary (2-yr lookback adjusted)
 *   - 'aggressive'   → convert to top of the 24% bracket or next IRMAA tier, whichever is lower
 *
 * Falls back to a zero-conversion decision if neither is specified.
 */
export function resolveDecision(
  strategy: Strategy,
  state: YearState,
  simulationYear: number,
  assumptions: Assumptions,
): YearDecision
```

### `computeEstateCost`
```ts
/**
 * One-time terminal cost applied at the end of the simulation horizon.
 * Accounts for:
 *   1. WA state estate tax (own exemption, own rate schedule)
 *   2. Federal estate tax AFTER §2058 deduction of state tax paid
 *   3. Heir's income tax on inherited traditional balance (10-year rule)
 *   4. Step-up in basis benefit (unrealized taxable gains disappear at death)
 *
 * ⚠️ State and federal estate taxes are NOT independently additive.
 *    Federal is computed on a base reduced by state tax paid (IRC §2058).
 *    Combined marginal rate ≈ stateRate + federalRate × (1 − stateRate) ≈ 52%
 *    at current WA + federal top rates, NOT 60%.
 */
export function computeEstateCost(
  terminalState: YearState,
  assumptions: Assumptions,
): number
```

### `discountFactor`
```ts
/**
 * Returns the present-value discount factor for a cost incurred `yearsFromNow` years out.
 * discountFactor(0, 0.03) → 1.0   (cost today is worth face value)
 * discountFactor(10, 0.03) → ~0.744
 * discountFactor(n, 0) → 1.0      (no discounting — nominal sum mode)
 */
export function discountFactor(yearsFromNow: number, discountRate: number): number
```

### `currentPhase`
```ts
/**
 * Returns the Phase the person is in for the given age.
 * Used by resolveDecision() to select the right phase template.
 *   age < 55              → Phase.PRE_55
 *   55 ≤ age < 59.5       → Phase.RULE_OF_55
 *   59.5 ≤ age < 65       → Phase.PENALTY_FREE
 *   65 ≤ age < rmdStart   → Phase.MEDICARE_ERA
 *   age ≥ rmdStart        → Phase.RMD_ERA
 */
export function currentPhase(age: number, birthYear: number): Phase
```

### `simulate` — The Main Entry Point
```ts
/**
 * Runs the full forward simulation for the given strategy and assumptions.
 * Deterministic and pure: same inputs always produce the same output.
 * No side effects, no mutation of inputs.
 *
 * Execution flow:
 *   1. Build initial state from assumptions + ssClaimAge
 *   2. For each year until horizonAge:
 *        a. Resolve the year's decision from the strategy
 *        b. Run computeYear (13 steps)
 *        c. Accumulate discounted yearCost
 *        d. Push YearRecord to trace
 *        e. Advance to nextState
 *   3. Compute estate cost on terminal state
 *   4. Return { totalCost, terminalState, trace }
 *
 * @returns SimResult — the totalCost is the value the optimizer minimizes
 */
export function simulate(strategy: Strategy, assumptions: Assumptions): SimResult
```

---

## Tests Required

### Pure function contract
```ts
// Same inputs → identical output every time
const result1 = simulate(strategy, assumptions);
const result2 = simulate(strategy, assumptions);
expect(result1.totalCost).toBe(result2.totalCost);
expect(result1.trace).toEqual(result2.trace);
```

### Trace length
```ts
// Trace must have exactly (horizonAge - currentAge) records
const result = simulate(strategy, { ...assumptions, currentAge: 52, horizonAge: 90 });
expect(result.trace).toHaveLength(38);
```

### Zero conversion baseline
```ts
// With zero conversions and no spending, traditional balance grows at expectedReturn.
// After N years: traditional ≈ initial × (1 + rate)^N
// This validates that growBalances is compounding correctly.
```

### Estate §2058 deduction
```ts
// With a $5M estate and WA residency:
// WA estate tax is computed first (on estate - waExemption)
// Federal taxable estate = $5M - federalExemption - waEstateTax (NOT $5M - federalExemption alone)
// Total < waEstateTax + 0.40 × (5M - federalExemption)
```

### Phase transitions
```ts
currentPhase(54, 1972) // → Phase.PRE_55
currentPhase(55, 1972) // → Phase.RULE_OF_55
currentPhase(60, 1972) // → Phase.PENALTY_FREE
currentPhase(66, 1972) // → Phase.MEDICARE_ERA
currentPhase(75, 1972) // → Phase.RMD_ERA
```

## Acceptance Criteria
- [ ] `simulate` is a pure function (verified by duplicate-call test)
- [ ] Trace length exactly matches simulation horizon
- [ ] `computeEstateCost` uses §2058 deduction (state tax reduces federal base)
- [ ] `resolveDecision` handles both `perYear` and `phaseTemplates` strategy formats
- [ ] All tests pass; `npm run typecheck` clean
