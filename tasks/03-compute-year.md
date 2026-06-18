# Task 03 — Per-Year Cost Function (computeYear)

## Goal
Implement `computeYear` and all its helper functions. This is the core of the
simulator — every tax dollar flows through these functions.

## Reference
`docs/02-simulator-algorithm.md` — §3 "The per-year cost function"

## Pre-conditions
Tasks 01 and 02 complete.

## Files to Create
```
src/engine/computeYear.ts
src/engine/computeYear.test.ts
```

---

## Design Rule: One Helper Per Step

`computeYear` is the **orchestrator only** — it calls helpers and assembles results.
It does no tax math itself. Each of the helpers below is a pure function, ≤ 30 lines,
with its own JSDoc and tests.

---

## Helper Functions

Implement each helper as a named export. Then implement `computeYear` as a named export
that calls them in the exact order below.

### `computeWithdrawal`
```ts
/**
 * Determines how much to draw from each account to meet the spending need
 * (after RMD and net Social Security have already covered part of it).
 * Draws accounts in the order specified by withdrawalOrder.
 * Tracks the basis/gain split for taxable account withdrawals.
 *
 * @param need - Remaining cash needed after RMD and SS income
 * @param state - Current account balances
 * @param order - Account priority sequence
 * @returns Breakdown of withdrawals with tax character per account
 */
export function computeWithdrawal(
  need: number,
  state: YearState,
  order: readonly AccountSource[],
): WithdrawalResult
```

### `computeTaxableSocialSecurity`
```ts
/**
 * Returns the portion of the gross SS benefit that is subject to income tax,
 * based on provisional income (PI = AGI before SS + ½ × gross benefit + tax-exempt interest).
 *
 * Tiers (FROZEN thresholds — never inflation-adjusted):
 *   PI < $25k single / $32k MFJ      → 0% taxable
 *   $25–34k single / $32–44k MFJ     → 50% of excess above lower threshold
 *   Above $34k single / $44k MFJ     → 85% of benefit (maximum)
 *
 * ⚠️ THE TORPEDO EFFECT: above the upper threshold, each $1 of additional income
 * (including conversions) adds ~$0.85 to the tax base — a hidden marginal rate spike.
 * MUST be computed AFTER other income is assembled.
 */
export function computeTaxableSocialSecurity(
  ordinaryIncomeBeforeSS: number,
  ssGrossBenefit: number,
  filingStatus: FilingStatus,
): number
```

### `computeMagi`
```ts
/**
 * Modified Adjusted Gross Income = AGI + tax-exempt interest.
 * MAGI is used for IRMAA (not taxable income). Keep separate from taxableOrdinary.
 * Tax-exempt interest (e.g. muni bonds) is included in MAGI even though not taxable.
 */
export function computeMagi(
  agi: number,
  taxExemptInterest: number,
): number
```

### `computeFederalIncomeTax`
```ts
/**
 * Total federal income tax = ordinary tax (on taxableOrdinary) + LTCG tax (stacked).
 * LTCG rates (0/15/20%) are determined by where (taxableOrdinary + ltcg) lands,
 * NOT by ltcg alone. This is the "stacking trap" — a conversion that fills ordinary
 * income can push otherwise-0% gains into the 15% zone.
 *
 * @param taxableOrdinary - Ordinary income after standard deduction
 * @param ltcg - Long-term capital gains + qualified dividends
 * @param year - Calendar year for bracket lookup
 */
export function computeFederalIncomeTax(
  taxableOrdinary: number,
  ltcg: number,
  year: number,
  filingStatus: FilingStatus,
): number
```

### `computeNiit`
```ts
/**
 * Net Investment Income Tax: 3.8% on the lesser of NII or the amount by which
 * MAGI exceeds the threshold.
 *
 * ⚠️ FROZEN THRESHOLDS (never inflation-adjusted): $200k single / $250k MFJ.
 * Inflation slowly drags more households across this line every year.
 *
 * @param nii - Net investment income (interest + dividends + realized LTCG + passive)
 * @param magi - Full MAGI including NII
 */
export function computeNiit(
  nii: number,
  magi: number,
  filingStatus: FilingStatus,
): number
```

### `computeIrmaa`
```ts
/**
 * Annual IRMAA surcharge (Part B + Part D combined) for ONE person.
 * Returns 0 if age < 65 (Medicare not yet active).
 *
 * ⚠️ USES MAGI FROM TWO YEARS AGO. The caller must pass magi2YearsAgo
 * from state.magiHistory — NOT the current year's MAGI.
 * This is the Markov attribution reformulation. Do not change this.
 *
 * For MFJ: call once per spouse (both spouses owe the surcharge independently).
 */
export function computeIrmaa(
  magi2YearsAgo: number,
  age: number,
  filingStatus: FilingStatus,
  year: number,
): number
```

### `computeEarlyWithdrawalPenalty`
```ts
/**
 * 10% penalty on traditional account distributions before age 59½.
 * Exceptions:
 *   - Rule of 55: applies to separation-year 401(k) only, NOT IRAs.
 *   - Roth contributions are always penalty-free (only earnings are penalized).
 * Penalty applies only to the traditional withdrawal amount, not conversions.
 */
export function computeEarlyWithdrawalPenalty(
  traditionalWithdrawals: number,
  age: number,
  ruleOf55Applies: boolean,
): number
```

### `growBalances`
```ts
/**
 * Applies the expected annual return to all three accounts, producing
 * the balances for the START of the next year.
 * Also adjusts taxable basis for any reinvested dividends/distributions.
 * Returns only the balance fields — does not produce a full new YearState.
 */
export function growBalances(
  state: YearState,
  expectedReturn: number,
): Pick<YearState, 'traditional' | 'roth' | 'taxable'>
```

---

## `computeYear` — The Orchestrator

```ts
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
 */
export function computeYear(
  state: YearState,
  decision: YearDecision,
  assumptions: Assumptions,
  simulationYear: number,
): { yearCost: number; nextState: YearState; record: YearRecord }
```

---

## Tests Required

### The SS torpedo (step 4b)
```ts
// Below lower threshold — 0% taxable
computeTaxableSocialSecurity(20_000, 24_000, 'single') // → 0

// Above upper threshold — 85% taxable (max)
computeTaxableSocialSecurity(50_000, 24_000, 'single') // → ~$20,400 (85% of $24k)

// Each $1 of added income above the threshold adds $0.85 to the tax base
```

### IRMAA cliff (step 8)
```ts
// One dollar under the MFJ first tier — no surcharge
computeIrmaa(211_999, 67, 'mfj', 2028) // → $0

// One dollar over — full tier 1 surcharge for the filing
computeIrmaa(212_001, 67, 'mfj', 2028) // → ~$850 (per person; two spouses = ~$1,700)
```

### LTCG stacking (step 5/6)
```ts
// LTCG in the 0% zone — no tax
computeFederalIncomeTax(0, 50_000, 2026, 'mfj') // → $0 (both under 0% ceiling)

// Ordinary income fills the 0% zone — LTCG pushed into 15%
computeFederalIncomeTax(90_000, 20_000, 2026, 'mfj') // → LTCG taxed at 15%
```

### NIIT frozen threshold
```ts
computeNiit(50_000, 240_000, 'single') // → $0 — under $200k threshold
computeNiit(50_000, 210_000, 'single') // → 0.038 * min(50k, 10k) = $380
```

### RMD floor enforcement
A `computeYear` call where age >= 75 must include RMD in ordinary income
regardless of what conversionAmount is set to. The RMD cannot be converted away.

## Acceptance Criteria
- [ ] All helper functions created with signatures matching above
- [ ] `computeYear` calls helpers in the exact 13-step order specified
- [ ] No helper function exceeds 30 lines
- [ ] `computeYear` itself does not contain tax logic — only orchestration
- [ ] All specified tests pass
- [ ] `npm run typecheck` clean
