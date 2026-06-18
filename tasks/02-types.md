# Task 02 — TypeScript Interfaces (types.ts)

## Goal
Define every TypeScript interface and type used across the engine in a single
file. This is the **contract** the rest of the codebase depends on. Get it right;
changing it later breaks everything downstream.

## Reference
`docs/02-simulator-algorithm.md` — §1 (State), §2 (Decision variables), §4 (SimResult)

## Pre-conditions
Task 01 complete. Import `FilingStatus` from `tables/index.ts`.

## Files to Create
```
src/engine/types.ts
src/engine/types.test.ts   ← type-level tests (compile-time guards, not runtime)
```

---

## Complete Interface Definitions

Implement all of the following in `src/engine/types.ts`. Every property is `readonly`.
Add JSDoc to each interface and each property.

```ts
// ─── Primitive domain types ──────────────────────────────────────────────────

export { FilingStatus } from './tables/index';

/** Which account a withdrawal is drawn from. Determines tax character. */
export type AccountSource = 'taxable' | 'traditional' | 'roth';

/** Coarse strategy intensity for a phase. Used by the coordinate-search optimizer. */
export type PhaseTemplate = 'conservative' | 'moderate' | 'aggressive';

// ─── Life phases ─────────────────────────────────────────────────────────────

/**
 * The five tax-planning phases of early retirement.
 * Each phase has distinct account-access rules and dominant tax constraints.
 * See docs/01-tax-phases.md for full description of each phase.
 */
export enum Phase {
  /** Now → age 55. Conversion-only; 10% penalty on traditional withdrawals. */
  PRE_55 = 'PRE_55',
  /** Age 55 → 59½. Rule of 55 unlocks penalty-free access to separation-year 401(k). */
  RULE_OF_55 = 'RULE_OF_55',
  /** Age 59½ → 65. Fully penalty-free; prime conversion window; ACA subsidies in play. */
  PENALTY_FREE = 'PENALTY_FREE',
  /** Age 65 → 75. Medicare begins; IRMAA cliffs dominate; last conversion runway before RMDs. */
  MEDICARE_ERA = 'MEDICARE_ERA',
  /** Age 75+. RMDs mandatory; forced income floor; estate/heir costs crystalize. */
  RMD_ERA = 'RMD_ERA',
}

// ─── Account balances ────────────────────────────────────────────────────────

/**
 * A taxable brokerage account with cost-basis tracking.
 * Only the gain (value − basis) is taxable on withdrawal.
 */
export interface TaxableAccount {
  /** Current fair market value of the account. */
  readonly value: number;
  /**
   * Aggregate cost basis. Gain = value − basis.
   * Basis resets to fair market value at death (step-up), eliminating the embedded gain.
   */
  readonly basis: number;
}

// ─── Year state ──────────────────────────────────────────────────────────────

/**
 * The complete state of the simulation at the START of a given year.
 * Immutable — computeYear() returns a new YearState; never mutates this one.
 */
export interface YearState {
  /** Person's age at the start of this year. */
  readonly age: number;
  /** Calendar year — used to look up that year's tax tables. */
  readonly year: number;
  readonly filingStatus: FilingStatus;

  /** Traditional 401(k) + IRA balance. Every dollar withdrawn is ordinary income. */
  readonly traditional: number;
  /** Roth IRA/401(k) balance. Grows and withdraws tax-free. No RMDs ever. */
  readonly roth: number;
  /** Taxable brokerage account. Only gains are taxable; basis portion is tax-free. */
  readonly taxable: TaxableAccount;

  /** True once Social Security has been claimed. Benefit is locked at claim age. */
  readonly ssClaimed: boolean;
  /** Age at which SS was claimed (62–70), or null if not yet claimed. */
  readonly ssClaimAge: number | null;
  /**
   * Gross annual Social Security benefit in today's dollars.
   * Up to 85% becomes taxable depending on provisional income (see computeYear step 4b).
   */
  readonly ssAnnualBenefit: number;

  /**
   * Rolling history of MAGI values indexed by simulation year (0-based).
   * IRMAA in year Y uses magiHistory[Y - 2].
   * CRITICAL: this must be carried in state — it cannot be recomputed locally.
   */
  readonly magiHistory: readonly number[];

  /** True if Rule of 55 applies this year (penalty-free 401k withdrawals). */
  readonly ruleOf55Applies: boolean;
}

// ─── Strategy ────────────────────────────────────────────────────────────────

/**
 * The decision made for a single simulation year.
 * Determines how much to convert and which accounts to tap for spending.
 */
export interface YearDecision {
  /**
   * Dollars moved from traditional → Roth this year.
   * Taxed as ordinary income in the year of conversion.
   * Must be >= 0 and <= traditionalBalance.
   */
  readonly conversionAmount: number;
  /**
   * Order in which accounts are drawn down to meet spending needs.
   * Tax character of the withdrawal depends on which account it comes from.
   */
  readonly withdrawalOrder: readonly AccountSource[];
}

/**
 * A complete strategy specification covering all simulation years.
 * The optimizer's output. The simulator's input.
 */
export interface Strategy {
  /**
   * Age at which to claim Social Security (62–70).
   * Claiming at 62 = permanently reduced benefit. Delaying to 70 = maximum benefit.
   */
  readonly ssClaimAge: number;
  /**
   * Explicit per-year decisions. If provided, phaseTemplates is ignored.
   * Length must equal the simulation horizon in years.
   */
  readonly perYear?: readonly YearDecision[];
  /**
   * Coarse intensity per phase. Used by the coordinate-search optimizer (task 05).
   * resolveDecision() translates these into concrete dollar amounts each year.
   */
  readonly phaseTemplates?: Partial<Record<Phase, PhaseTemplate>>;
}

// ─── Assumptions ─────────────────────────────────────────────────────────────

/**
 * All user-supplied inputs to the simulation.
 * Treated as constant throughout the simulation run.
 */
export interface Assumptions {
  readonly birthYear: number;
  readonly currentAge: number;
  /** Age at which the simulation ends and estate costs are tallied. Typically 90–95. */
  readonly horizonAge: number;
  readonly traditional: number;
  readonly roth: number;
  readonly taxable: TaxableAccount;
  /** Annual spending in today's dollars (real, not nominal). */
  readonly annualSpending: number;
  /** Expected nominal annual return applied equally to all accounts (e.g., 0.06). */
  readonly expectedReturn: number;
  /**
   * Discount rate for NPV conversion. Set to 0 for a nominal lifetime sum.
   * Set to ~0.03 for inflation-adjusted present value comparison.
   */
  readonly discountRate: number;
  readonly filingStatus: FilingStatus;
  /** Residency state. Currently only 'WA' has custom logic; others use federal-only. */
  readonly state: 'WA' | string;
  /**
   * Assumed marginal federal income tax rate of the heir(s) who will inherit
   * the traditional balance. Used to compute the 10-year-rule drawdown cost.
   * Typically 0.32–0.37 for heirs in their peak earning years.
   */
  readonly heirMarginalRate: number;
}

// ─── Simulation output ───────────────────────────────────────────────────────

/**
 * Per-year record stored in the simulation trace.
 * Drives the year-by-year breakdown chart in the UI.
 * Every cost component is broken out separately for transparency.
 */
export interface YearRecord {
  readonly age: number;
  readonly year: number;
  readonly rmd: number;
  readonly conversionAmount: number;
  readonly ordinaryIncome: number;
  readonly magi: number;
  readonly federalIncomeTax: number;
  readonly stateTax: number;           // $0 for WA residents
  readonly niit: number;               // 3.8% on NII above frozen threshold
  readonly irmaa: number;              // attributed to this year's MAGI (paid in year+2)
  readonly penalty: number;            // 10% early-withdrawal if applicable
  readonly waCapGainsTax: number;      // WA state capital gains on taxable sales
  readonly yearCost: number;           // sum of all above
  readonly traditionalBalance: number; // end-of-year balance after growth
  readonly rothBalance: number;
  readonly taxableBalance: number;
}

/**
 * The complete output of simulate().
 * totalCost is the number the optimizer minimizes.
 */
export interface SimResult {
  /** Sum of all year costs + discounted estate cost. The optimization target. */
  readonly totalCost: number;
  /** Account balances and MAGI history at the end of the simulation horizon. */
  readonly terminalState: YearState;
  /** Full year-by-year breakdown for UI display and debugging. */
  readonly trace: readonly YearRecord[];
}

// ─── Internal helpers (engine-use only, not exported to UI) ──────────────────

/**
 * Result of the withdrawal sourcing step (computeYear step 2).
 * Tracks the tax character of every dollar withdrawn.
 */
export interface WithdrawalResult {
  /** Dollars withdrawn from the traditional account (each dollar is ordinary income). */
  readonly tradWithdrawals: number;
  /**
   * Dollars withdrawn from the taxable account.
   * Split into basis portion (tax-free) and gain portion (taxable at LTCG rates).
   */
  readonly taxableWithdrawals: {
    readonly total: number;
    readonly basisPortion: number;
    readonly gainPortion: number;
  };
  /** Dollars withdrawn from the Roth account (tax-free after age 59½). */
  readonly rothWithdrawals: number;
}
```

---

## Tests Required

`types.test.ts` uses TypeScript's type system as its test harness. Use `satisfies` and
assignment checks to verify structural correctness at compile time.

```ts
// Verify Phase covers all 5 phases
const ALL_PHASES: Phase[] = Object.values(Phase);
expect(ALL_PHASES).toHaveLength(5);

// Verify a valid YearState passes type checking (catches missing/wrong-typed fields)
const validState = { age: 52, year: 2026, ... } satisfies YearState;

// Verify AccountSource covers exactly 3 values
const sources: AccountSource[] = ['taxable', 'traditional', 'roth'];
```

## Acceptance Criteria
- [ ] `src/engine/types.ts` created with all interfaces above
- [ ] Every interface and every property has JSDoc
- [ ] Zero `any` types
- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
