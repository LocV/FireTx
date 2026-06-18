# Task 01 — Tax Lookup Tables

## Goal
Build all tax data lookup functions that the rest of the engine will call.
Everything here is **data + a lookup interface** — no tax logic, just organized tables.

## Reference
`docs/01-tax-phases.md` — data tables section  
`docs/02-simulator-algorithm.md` — §7 "Data tables required"

## Pre-conditions
None. This is the first task.

## Files to Create
```
src/engine/tables/brackets.ts
src/engine/tables/irmaa.ts
src/engine/tables/rmd.ts
src/engine/tables/estate.ts
src/engine/tables/capitalGains.ts
src/engine/tables/index.ts       ← barrel export for all table modules
```
Plus co-located test files for each.

---

## `brackets.ts` — Federal Income Tax Brackets

Provide bracket tables for a base year (2026) and a `project(year)` function that
inflates the bracket edges using an assumed 2.5% annual CPI. Bracket edges are dollar
amounts; rates are fixed percentages.

```ts
/** Filing status type used across all table lookups. */
export type FilingStatus = 'single' | 'mfj';

/**
 * Returns the federal ordinary income tax owed on `taxableIncome`
 * for the given year and filing status.
 * Applies graduated brackets — only the income within each band is taxed at that rate.
 * @example
 * federalOrdinaryTax(50_000, 2026, 'single') // ~$5,990 using 2026 brackets
 */
export function federalOrdinaryTax(
  taxableIncome: number,
  year: number,
  filingStatus: FilingStatus,
): number

/**
 * Returns the federal long-term capital gains tax on `ltcg`,
 * stacked on top of `ordinaryIncomeBelowLtcg` to determine the applicable rate (0/15/20%).
 * The rate depends on where (ordinary + ltcg) lands, NOT on ltcg alone.
 * @example
 * federalLtcgTax(20_000, 40_000, 2026, 'mfj') // $0 — still in the 0% zone
 * federalLtcgTax(20_000, 90_000, 2026, 'mfj') // $3,000 — 15% applies
 */
export function federalLtcgTax(
  ltcg: number,
  ordinaryIncomeBelowLtcg: number,
  year: number,
  filingStatus: FilingStatus,
): number

/**
 * Returns the standard deduction for the given year, filing status, and age.
 * Adds the over-65 additional deduction if age >= 65.
 */
export function standardDeduction(year: number, filingStatus: FilingStatus, age: number): number
```

---

## `irmaa.ts` — IRMAA Medicare Surcharges

IRMAA is a **step function** (cliff, not ramp). The full tier surcharge is owed once
MAGI exceeds the tier boundary — not just the marginal excess. Provide 2026 base
values and project forward by CPI.

```ts
/**
 * Returns the total annual IRMAA surcharge (Part B + Part D combined)
 * for ONE person, given MAGI from two years prior.
 * For MFJ, call this once per spouse.
 *
 * CRITICAL: `magi` must be the MAGI from year (currentYear - 2), not the current year.
 * The caller is responsible for passing the correct lookback value.
 *
 * @example
 * annualIrmaaSurcharge(150_000, 2026, 'single') // ~$1,860 — second tier
 * annualIrmaaSurcharge(211_000, 2026, 'mfj')    // $0 — below first MFJ threshold
 * annualIrmaaSurcharge(213_000, 2026, 'mfj')    // ~$744 — crossed first MFJ tier
 */
export function annualIrmaaSurcharge(
  magi: number,
  year: number,
  filingStatus: FilingStatus,
): number
```

**2026 approximate tier boundaries (load into a table constant, not inline):**
- Single: $106k / $133k / $167k / $200k / $500k
- MFJ:    $212k / $266k / $334k / $400k / $750k

Per-person annual surcharges (Part B + Part D combined, approximate):
- Tier 0: $0, Tier 1: ~$850, Tier 2: ~$2,000, Tier 3: ~$3,200, Tier 4: ~$4,000, Tier 5: ~$4,800

---

## `rmd.ts` — Required Minimum Distributions

```ts
/**
 * Returns the RMD start age for a person born in `birthYear`.
 * SECURE 2.0: born 1960+ → age 75. Born 1951–1959 → age 73. Born ≤1950 → age 72.
 */
export function rmdStartAge(birthYear: number): number

/**
 * Returns the IRS Uniform Lifetime Table factor for the given age.
 * RMD = priorYearEndBalance / uniformLifetimeFactor(age)
 * Factor decreases with age (higher % withdrawn each year).
 * @example
 * uniformLifetimeFactor(75) // 24.6
 * uniformLifetimeFactor(80) // 20.2
 * uniformLifetimeFactor(85) // 16.0
 */
export function uniformLifetimeFactor(age: number): number

/**
 * Returns the required minimum distribution for the given balance and age.
 * Returns 0 if age < rmdStartAge(birthYear).
 */
export function computeRmd(
  priorYearEndBalance: number,
  age: number,
  birthYear: number,
): number
```

---

## `estate.ts` — Estate Tax Schedules

```ts
/**
 * Federal estate tax on the taxable estate (after deducting the exemption
 * and the state estate tax paid — see §2058 deduction).
 * Flat 40% rate above the exemption. Exemption: ~$15M single / $30M MFJ (2026, indexed).
 */
export function federalEstateTax(taxableEstateAfterDeductions: number): number

/**
 * Washington State estate tax on the taxable estate (above the WA exemption).
 * WA exemption: ~$3.076M (2026); ~$3M and frozen after July 2026 (SB 6347).
 * NOT portable between spouses — each spouse has their own exemption.
 * Graduated 10–20% rate schedule (reverted to pre-2025 rates by SB 6347).
 * @example
 * waEstateTax(0) // 0
 * waEstateTax(1_000_000) // ~$100,000 (10% on first $1M above exemption)
 */
export function waEstateTax(taxableEstateAboveExemption: number): number

/** Returns the WA estate tax exemption for the given year. */
export function waEstateExemption(year: number): number

/** Returns the federal estate tax exemption for the given year and filing status. */
export function federalEstateExemption(year: number, filingStatus: FilingStatus): number
```

---

## `capitalGains.ts` — Washington State Capital Gains Tax

**Important scope:** Applies to sales of stocks, bonds, and mutual funds in the
**taxable brokerage account** only. Roth conversions, RMDs, and traditional
withdrawals are income events — NOT capital gains — and are EXEMPT.

```ts
/**
 * Washington State capital gains tax on long-term gains realized in the taxable account.
 * Annual exemption: ~$262k (inflation-adjusted). Rate: 7% up to $1M gain; 9.9% above $1M.
 * Returns 0 if realizedGain <= annualExemption.
 * @example
 * waCapitalGainsTax(100_000, 2026) // 0 — below exemption
 * waCapitalGainsTax(500_000, 2026) // ~$16,660 — 7% on (500k - 262k)
 * waCapitalGainsTax(1_500_000, 2026) // ~$101,640 — 7% up to $1M, 9.9% above
 */
export function waCapitalGainsTax(realizedLtcg: number, year: number): number
```

---

## Tests Required

### Cliff tests (most important)
- `annualIrmaaSurcharge`: one dollar under, at, and one dollar over each 2026 tier boundary
- `federalOrdinaryTax`: verify the correct bracket applies at the boundary (e.g., 22% vs 24%)
- `federalLtcgTax`: verify 0% applies when stacked total stays below the threshold; 15% when it crosses
- `waCapitalGainsTax`: verify $0 at exemption, correct amounts at $1M boundary

### Correctness tests
- `computeRmd(1_000_000, 75, 1960)` → ~$40,650 (1M / 24.6)
- `rmdStartAge(1960)` → 75; `rmdStartAge(1955)` → 73; `rmdStartAge(1948)` → 72
- `standardDeduction(2026, 'mfj', 66)` → base MFJ deduction + over-65 add-on for both spouses

## Acceptance Criteria
- [ ] All 5 table files created with exported functions matching the signatures above
- [ ] All cliff boundary tests pass
- [ ] `npm run typecheck` passes with zero errors
- [ ] All tests pass: `npm run test`
