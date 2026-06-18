# Lifetime Tax Total — Algorithm Specification

Companion to `early-retirement-tax-phases.md`. This defines *how to compute* total lifetime cost for a given strategy, and how to *search* for the best strategy.

---

## 0. The key structural insight

The "chicken-and-egg" problem (deplete early → Phase 5 is trivial; preserve → Phase 5 tax bomb) is **not a property of the calculation**. It's a property of the *search*.

- **Forward simulation** of a *fully specified* strategy is a clean, totally-ordered pass: year 1 → year N, no circular reference. Given the decisions, the answer is deterministic.
- The circular dependency lives **only in the optimizer**, which is choosing the decisions. That's where iteration / DP belongs.

So split the system into two layers:

```
Layer 1 — simulate(strategy)  -> lifetimeCost      (deterministic, no circularity)
Layer 2 — optimize()          -> best strategy      (search; here the dependency lives)
```

Build Layer 1 first and get it exactly right. Layer 2 just calls it many times.

---

## 1. State (carried year to year)

```ts
interface YearState {
  age: number;                                // current age; drives which RMD table, IRMAA, SS, and penalty rules apply
  filingStatus: 'single' | 'mfj';            // affects every bracket threshold and IRMAA tier; can flip on widowing

  // ── Account balances ──────────────────────────────────────────────────────────
  // Three fundamentally different tax treatments — the entire strategy is about
  // managing which bucket holds money and when you pull from each.
  traditional: number;                        // 401(k) + trad IRA; every dollar withdrawn is ordinary income
  roth: number;                               // already-taxed dollars; grows AND withdraws completely tax-free; no RMDs ever
  taxable: { value: number; basis: number };  // brokerage account; only the GAIN (value − basis) is taxable on withdrawal

  // ── Social Security ───────────────────────────────────────────────────────────
  ssClaimed: boolean;                         // once claimed, the annual benefit is locked (plus inflation adjustments)
  ssClaimAge: number | null;                  // claiming at 62 = smaller benefit forever; delaying to 70 = largest benefit
  ssAnnualBenefit: number;                    // gross annual amount; up to 85% becomes taxable income depending on MAGI

  // ── IRMAA lookback ────────────────────────────────────────────────────────────
  // CRITICAL: IRMAA (Medicare surcharge) in year Y is driven by MAGI from year Y−2.
  // A Roth conversion you do at 67 determines your Medicare premium at 69.
  // This rolling history MUST live in state — it cannot be recomputed locally.
  magiHistory: number[];                       // magiHistory[currentYear - 2] is what drives THIS year's IRMAA
}
```

The `magiHistory` is the piece most implementations get wrong. IRMAA in year *Y* is driven by MAGI from year *Y−2*, so non-adjacent years are coupled. It must be in the state, not recomputed locally.

---

## 2. Decision variables (the strategy)

```ts
interface YearDecision {
  // PRIMARY LEVER: how many dollars to move from traditional (pre-tax) → Roth (post-tax) this year.
  // Pay tax now at a known rate to shrink the traditional balance that will become forced RMDs later.
  // The optimizer's job is to find the conversion amount that minimizes LIFETIME tax, not just this year's.
  conversionAmount: number;

  // When you need cash to live on, which accounts do you tap first?
  // The sequence matters: e.g. draining taxable first leaves tax-deferred growth intact;
  // draining traditional first keeps future balances (and therefore future RMDs) smaller.
  withdrawalOrder: ('taxable' | 'traditional' | 'roth')[];
}

interface Strategy {
  ssClaimAge: number;            // 62..70 — claiming earlier = smaller benefit forever; 70 = maximum
  perYear: YearDecision[];       // one fully-specified decision per simulated year

  // Alternative to perYear: assign a coarse intensity level per phase and let
  // resolveDecision() translate it into a concrete dollar amount each year.
  // Useful for the coordinate-search optimizer in §6A.
  phaseTemplates?: Record<Phase, 'conservative' | 'moderate' | 'aggressive'>;
}
```

---

## 3. The per-year cost function (the core)

Order of operations **within a single year** matters because each step feeds the next:

```
── STEP 1: Required Minimum Distribution (forced income floor, age 75+) ────────
// Born 1960+: IRS mandates a minimum withdrawal from traditional accounts starting at 75.
// Formula: RMD = prior-year-end balance ÷ IRS Uniform Lifetime Table factor.
// The factor DECREASES with age, so RMDs grow as a % of the balance over time.
//
// Example factors from the IRS Uniform Lifetime Table:
//   age 75 → factor 24.6  → withdraw ~4.1% of balance
//   age 80 → factor 20.2  → withdraw ~5.0% of balance
//   age 85 → factor 16.0  → withdraw ~6.3% of balance
//   age 90 → factor 12.2  → withdraw ~8.2% of balance
//
// Concrete example: a $2M traditional balance at age 80 triggers a mandatory
// ~$99k distribution — stacked on top of Social Security, regardless of whether
// you need the cash. THIS is the "tax bomb" that Roth conversions in phases 1–4
// are designed to defuse.
//
// RMDs cannot be skipped, deferred, or reduced (except via QCDs — see §5).
// They are the hard income floor that the optimizer cannot go below.
rmd = (age >= rmdAge(birthYear))
      ? traditional / uniformLifetimeFactor(age)
      : 0

── STEP 2: Spending sourcing ────────────────────────────────────────────────────
// How much cash does the person need beyond what RMD + net Social Security provides?
// Pull from accounts in the order specified by withdrawalOrder.
// IMPORTANT: track the TAX CHARACTER of every dollar withdrawn.
//   - Traditional withdrawal → ordinary income (fully taxable)
//   - Taxable withdrawal → split: return-of-basis portion is NOT taxable,
//                                 gain portion IS taxable (at LTCG rates)
//   - Roth withdrawal → tax-free (after age 59½ and 5-year rule)
remainingNeed = spendingNeed - rmd - ssNet
withdraw(remainingNeed, withdrawalOrder)   // populates tradWithdrawals, taxableWithdrawals

── STEP 3: Roth conversion ──────────────────────────────────────────────────────
// Voluntarily shift conversionAmount from traditional to Roth.
// This is a TAX PREPAYMENT — you pay ordinary income tax now so future growth
// and withdrawals are tax-free and no RMDs are required on the Roth balance.
// The converted amount is added directly to this year's ordinary income (step 4).
traditional -= conversionAmount
roth        += conversionAmount
// Note: conversion raises MAGI, which affects IRMAA two years from now (step 8).

── STEP 4: Ordinary income assembly ─────────────────────────────────────────────
// Sum all income sources taxed at ORDINARY rates (not capital-gains rates).
ordIncome = tradWithdrawals    // includes the RMD from step 1
          + conversionAmount   // Roth conversion is taxed as ordinary income
          + taxableSS          // computed in step 4b below — depends on other income
          + interest           // bank/bond interest
          + nonQualDividends   // dividends that don't qualify for LTCG rates
          + STCG               // short-term capital gains (assets held < 1 year)

// ── Step 4b: Taxable Social Security ──────────────────────────────────────────
// Up to 85% of SS benefits become taxable, based on "provisional income" (PI).
// These thresholds are FROZEN — set in 1993, never inflation-adjusted.
// Inflation has steadily pushed more retirees into the taxable range every year.
//
// PI = AGI (before SS) + ½ × SS gross benefit + tax-exempt interest
//
// Taxability tiers (single / MFJ — FROZEN, never indexed):
//   PI < $25k   / $32k  →  0% of SS benefit is taxable
//   $25–34k     / $32–44k →  taxableSS = 50% × (PI − lower threshold)
//   PI > $34k   / $44k  →  taxableSS = min(0.85 × benefit,
//                                          0.85 × (PI − upper threshold)
//                                          + 0.50 × (upper − lower threshold))
//
// THE "TORPEDO" EFFECT — why this matters for the optimizer:
// Once PI exceeds the upper threshold, each additional $1 of income (including
// a Roth conversion) adds ~$0.85 to taxable income BEYOND the dollar itself.
// At a 22% bracket this makes the effective marginal rate ~22% × 1.85 = ~41%.
// At a 24% bracket: ~24% × 1.85 = ~44%. This is a hidden implicit marginal
// rate spike that the optimizer MUST navigate — a conversion that looks safe
// by bracket alone can be far more expensive once SS taxation is accounted for.
//
// This step MUST run AFTER you know other income because PI depends on ordIncome.
taxableSS = provisionalIncomeFormula(ordIncome, ssAnnualBenefit)   // implements tiers above
ordIncome += taxableSS   // fold back in — ordIncome is now complete for step 5 onward

── STEP 5: Long-term capital gains (the stacking trap) ──────────────────────────
// LTCG and qualified dividends are NOT taxed at ordinary rates (federal).
// They are stacked ON TOP of ordinary income when determining the 0/15/20% rate.
// The rate applied to LTCG depends on where (ordIncome + LTCG) lands in the stack —
// NOT on LTCG alone.
//
// DANGER — the conversion/LTCG interaction:
// A large Roth conversion raises ordinary income, which can push otherwise-0%
// capital gains into the 15% (or 15% → 20%) band. The 0% LTCG ceiling is one
// of the most valuable thresholds in early retirement; losing it to an oversized
// conversion costs 15 cents per dollar of gain. The optimizer must treat ordinary
// income and LTCG jointly, never independently.
//
// WASHINGTON STATE — separate capital gains tax (applies on top of federal):
// WA has a state capital gains tax on sales of stocks, bonds, and mutual funds.
// Real estate sales are EXEMPT. Traditional withdrawals and Roth conversions are
// also EXEMPT (those are income tax events, not capital gains).
// Rate structure: 7% on gains above the annual exemption (~$262k, inflation-adjusted);
//                 9.9% on gains above $1M (retroactive to Jan 1, 2025).
// For an HNW household selling large brokerage positions, this stacks on top of
// the federal 20% rate + 3.8% NIIT = up to ~33.7% effective combined state+federal
// rate on high-value stock sales. Factor into the withdrawal-order strategy.
realizedLTCG = taxableWithdrawals.gainPortion + qualifiedDividends
waCapGainsTax = waCapitalGainsTax(realizedLTCG, waAnnualExemption)  // state-level only; load from table

── STEP 6: Income tax ───────────────────────────────────────────────────────────
// Federal: standard deduction first, then graduated brackets on ordinary income,
// then LTCG stacked on top at 0/15/20% depending on where the stack lands.
taxableOrdinary = max(0, ordIncome - stdDeduction(age, filingStatus, year))
fedTax = ordinaryBrackets(taxableOrdinary, year, filingStatus)
       + capGainsTax(realizedLTCG, taxableOrdinary, year, filingStatus)  // stacked!

// State income tax — Washington residents pay $0 on income.
// See §5 for WA's separate estate tax, which is significant.
stateTax = stateIncomeTax(ordIncome, residenceState)

── STEP 7: NIIT — Net Investment Income Tax (3.8%) ──────────────────────────────
// Applies when MAGI exceeds $200k single / $250k MFJ (FROZEN — never inflation-adjusted).
// Because the threshold never moves, inflation slowly drags more and more people into it.
// Roth conversions raise MAGI and can pull investment income across this line.
// MAGI is broader than taxable income: AGI + tax-exempt interest.
nii  = interest + dividends + realizedLTCG + passiveIncome
MAGI = ordIncome + nii + taxExemptInterest   // store MAGI — needed for steps 8 and 13
niit = 0.038 * min(nii, max(0, MAGI - niitThreshold(filingStatus)))

── STEP 8: IRMAA — Medicare Part B + D surcharge ────────────────────────────────
// Applies starting at age 65. Uses MAGI from TWO YEARS AGO (2-year lookback).
// A conversion you do at 67 sets your Medicare premium at 69. Plan with the lag.
//
// irmaaSurcharge is a STEP FUNCTION — $1 over a tier triggers the FULL tier cost.
// For MFJ: each spouse pays the surcharge independently on their own Part B/D premium.
//
// Approximate 2026 annual Part B surcharge per person (above the base premium):
//   MAGI single ≤ $106k  / MFJ ≤ $212k    → +$0      (base premium only, ~$185/mo)
//   $106k–133k   / $212k–266k              → +~$62/mo  (+~$744/yr per person)
//   $133k–167k   / $266k–334k              → +~$155/mo (+~$1,860/yr per person)
//   $167k–200k   / $334k–400k              → +~$248/mo (+~$2,976/yr per person)
//   $200k–500k   / $400k–750k              → +~$310/mo (+~$3,720/yr per person)
//   > $500k      / > $750k                 → +~$372/mo (+~$4,464/yr per person)
//   (Part D adds ~$13–$81/mo per person on top; both parts adjust annually)
//
// Concrete MFJ cliff example:
//   MAGI at 67 = $211k  → no IRMAA for either spouse at 69  ($0 extra)
//   MAGI at 67 = $213k  → BOTH spouses cross first tier at 69 → +~$1,488/yr
//   A $2k conversion caused $1,488/yr in Medicare surcharges — and that repeats
//   for every future year that MAGI from that conversion year exceeds the tier.
//
// LOAD THESE FROM THE DATA TABLE — they are indexed annually and will change
// meaningfully over the decades this simulation spans. Do not hardcode.
magi2yrAgo = state.magiHistory[currentYear - 2]
irmaa = (age >= 65) ? irmaaSurcharge(magi2yrAgo, filingStatus) : 0

── STEP 9: Early-withdrawal penalty ─────────────────────────────────────────────
// 10% penalty on traditional account distributions before age 59½.
// EXCEPTIONS: Rule of 55 (separated from employer in/after the year you turned 55)
//             waives the penalty for THAT employer's 401(k) only — not IRAs.
// Roth CONTRIBUTIONS are always penalty-free; Roth EARNINGS before 59½ are not.
penalty = (age < 59.5 && !ruleOf55Applies)
          ? 0.10 * earlyTradWithdrawals
          : 0

── STEP 10: Estate cost ─────────────────────────────────────────────────────────
// Estate tax is a one-time event at death — not a per-year cost.
// Applied to the terminal state after the simulation loop ends (see §4 and §5).

── STEP 11: Year cost total ─────────────────────────────────────────────────────
yearCost = fedTax + stateTax + niit + irmaa + penalty + waCapGainsTax
// fedTax        = ordinary income tax + federal LTCG tax (stacked, from step 6)
// stateTax      = $0 for WA residents (no state income tax)
// niit          = 3.8% on net investment income above frozen MAGI threshold (step 7)
// irmaa         = Medicare surcharge driven by MAGI from 2 years ago (step 8)
// penalty       = 10% early-withdrawal penalty if applicable (step 9)
// waCapGainsTax = WA state capital gains tax on taxable account sales over ~$262k (step 5)
// Estate cost is added separately in simulate() after the final year (see §5).

── STEP 12: Grow balances ───────────────────────────────────────────────────────
// Apply expected annual return to each account going into next year.
// Roth and traditional compound identically before withdrawal;
// the difference is entirely in what tax is owed when the money comes out.
traditional  *= (1 + expectedReturn)
roth         *= (1 + expectedReturn)
taxable.value *= (1 + expectedReturn)  // also adjust basis for any reinvested dividends

── STEP 13: Record MAGI for future IRMAA ────────────────────────────────────────
// Store this year's MAGI so that in two years, step 8 can retrieve it for IRMAA.
// This is the mechanism that couples this year's conversion to a premium two years out.
state.magiHistory[currentYear] = MAGI
```

**Subtleties to encode:**
- **Capital-gains stacking:** LTCG is taxed in 0/15/20 brackets *based on where it sits on top of ordinary income*. A conversion that raises ordinary income can push otherwise-0% gains into the 15% band — model them jointly, not independently.
- **Taxable SS:** up to 85% of benefits become taxable via the provisional-income formula; this is itself a function of other income, so it must be computed *after* you know ordinary + half-SS.
- **IRMAA is a cliff:** `irmaaSurcharge` is a step function — `$1` over a tier triggers the full tier. Per-person for MFJ.
- **MAGI ≠ taxable income:** IRMAA's MAGI = AGI + tax-exempt interest. Keep MAGI and taxable income as separate computed values.

---

## 4. The forward simulator (Layer 1)

```ts
function simulate(strategy: Strategy, assumptions: Assumptions): SimResult {
  // Build the starting YearState from the person's current balances, age,
  // filing status, and the SS claim age that this strategy specifies.
  let state = initialState(assumptions, strategy.ssClaimAge);
  let totalCost = 0;
  const trace: YearRecord[] = [];   // full year-by-year breakdown — for debugging and UI charts

  for (let y = 0; y < assumptions.horizonYears; y++) {
    // If the strategy uses high-level phase templates ('conservative' etc.),
    // translate them into a concrete conversionAmount + withdrawalOrder for this year.
    // If perYear decisions are already specified, use them directly.
    const decision = resolveDecision(strategy, state, y);

    // Run all 13 steps from §3 for this year.
    // Returns: this year's tax cost, the updated state (new balances, recorded MAGI),
    // and a record for the trace.
    const { yearCost, nextState, record } = computeYear(state, decision, assumptions, y);

    // Accumulate the cost. discountRate=0 means nominal sum; any positive rate
    // converts to net present value so future dollars are worth less than today's.
    totalCost += discount(yearCost, y, assumptions.discountRate);

    trace.push(record);
    state = nextState;   // pass updated balances and MAGI history into the next year
  }

  // One-time terminal cost: estate tax + heir income tax on inherited traditional balances.
  // Applied AFTER the loop because it only triggers at death, not annually.
  // See §5 for the full corrected formula (federal and state are NOT independent).
  const estateCost = estateTaxEffect(state, assumptions);
  totalCost += discount(estateCost, assumptions.horizonYears, assumptions.discountRate);

  return { totalCost, terminalState: state, trace };
  // totalCost is the number the optimizer in Layer 2 minimizes.
  // trace is what the UI shows so the user can see WHY a year cost what it did.
}
```

This function is pure and deterministic. **No circular dependency** — that's the whole point of Layer 1.

---

## 5. Estate / heir cost (the HNW extension)

Lifetime *income* tax alone undervalues Roth conversions for a high-net-worth household. Add a terminal term:

```
── STEP 1: Washington State Estate Tax ─────────────────────────────────────────
// WA has its own estate tax, completely separate from federal, with a MUCH lower exemption.
// Exemption: ~$3.076M per individual (2026); NOT portable between spouses —
//   a couple does NOT automatically get a combined $6M.
// Rate schedule: graduated 10%–20% above the $3M exemption (top rate reverted to 20%
//   by SB 6347, effective July 1 2026; the 2025 law had briefly raised it to 35%).
// Applies to WA residents AND non-residents who own WA real property.
stateEstateTax = waEstateTax(
  max(0, estateValue - waExemption),   // waExemption ≈ $3.076M per person (2026); frozen ~$3M after July 2026
  filingStatus
)

── STEP 2: Federal Estate Tax — computed AFTER deducting state tax (IRC §2058) ──
// Federal and state estate taxes are SEPARATE regimes with DIFFERENT exemptions.
// They are NOT independently additive. Under IRC §2058, state estate tax paid is
// DEDUCTIBLE from the federal taxable estate — the federal tax is computed on a
// base already reduced by the state tax.
//
// Why this matters — combined marginal rate formula:
//   naive (wrong):   stateRate + fedRate          = 20% + 40% = 60%
//   correct:         stateRate + fedRate×(1−state) = 20% + 40%×0.80 = 52%
//
// Also note: exemptions are wildly different.
//   WA exemption: ~$3M   →  many HNW estates owe WA tax but ZERO federal
//   Federal exemption: ~$15M single / ~$30M MFJ (2026, post-OBBBA, indexed)
//   Federal tax only applies to the slice above $15M — after deducting state tax paid.
federalTaxableEstate = max(0,
  estateValue
  - federalExemption      // ~$15M single / ~$30M MFJ; much higher than WA's $3M
  - stateEstateTax        // §2058 deduction: state tax paid reduces the federal base
)
federalEstateTax = 0.40 * federalTaxableEstate

── STEP 3: Heir's income tax on inherited traditional accounts ───────────────────
// Under the SECURE Act 10-year rule, non-spouse heirs must fully drain inherited
// traditional IRAs and 401(k)s within 10 years of your death.
// Every dollar they withdraw is ordinary income at THEIR marginal rate —
// often 32–37% because heirs are typically in their own peak earning years.
// This is the hidden cost of leaving a large traditional balance at death.
// Roth balances, by contrast, pass to heirs completely tax-free with no RMD requirement.
// This is what makes Roth conversions valuable BEYOND your own lifetime.
heirTax = heirIncomeTaxOnInheritedTraditional(
  traditional,                       // remaining traditional balance at death
  assumptions.heirMarginalRate       // assumption input — typically 32–37%
)

── STEP 4: Step-up in basis on taxable (brokerage) accounts ─────────────────────
// Appreciated taxable assets get a basis RESET to fair market value at death.
// Heirs inherit at the date-of-death value — the pre-death unrealized gain disappears.
// This argues AGAINST spending down or realizing gains in the taxable account late in life:
// unrealized gain in taxable evaporates at death; traditional account balances do not.
// This also affects the ordering of which account to draw down vs. preserve.
stepUpBenefit = (taxable.value - taxable.basis) * heritableCapGainsRate

── STEP 5: Total estate and legacy cost ─────────────────────────────────────────
// The two tax amounts are summed — but federal was computed on a §2058-reduced base,
// so this is NOT the same as adding them independently.
estateCost = stateEstateTax
           + federalEstateTax      // already reflects the §2058 deduction
           + heirTax               // heir's income tax on inherited traditional account
           - stepUpBenefit         // unrealized taxable gains that disappear at death (a savings)
```

The `heirIncomeTaxOnInheritedTraditional` term is what makes early Roth conversions pay off beyond your own lifetime: traditional balances force heirs to drain within 10 years, often in *their* peak-earning years; Roth passes tax-free. Treat the heir's marginal rate as an assumption input.

---

## 6. The optimizer (Layer 2) — where the dependency lives

Three approaches, in increasing rigor. Start with (A), validate with (C).

### A. Hybrid per-phase templates + coordinate search (recommended first build)
Your own approach. Assign each phase a `conservative | moderate | aggressive` conversion template, simulate, then sweep one phase at a time:

```ts
function optimizeCoordinate(): Strategy {
  // Start from a sensible default — moderate conversion intensity in all phases.
  let best = defaultTemplates();
  let improved = true;

  // Coordinate descent: cycle through phases one at a time, testing all three levels.
  // Each pass keeps any improvement it finds and re-scans until nothing changes.
  // NOT guaranteed to find the global optimum (can get stuck in local optima),
  // but it's transparent, fast, and results are human-readable — you can see exactly
  // which phase is doing the work and why it changed.
  while (improved) {
    improved = false;

    for (const phase of PHASES) {
      // Hold all other phases fixed; try each intensity level for just this phase.
      for (const level of ['conservative', 'moderate', 'aggressive'] as const) {
        const trial = { ...best, [phase]: level };

        // simulate() is the Layer 1 oracle — runs the full 13-step year-by-year cost.
        // Calling it twice here is fine; it's cheap compared to the DP in §6C.
        if (simulate(trial).totalCost < simulate(best).totalCost) {
          best = trial;       // accept the improvement
          improved = true;    // flag that we made progress — start the outer loop again
        }
      }
    }
    // Loop exits when a full pass through all phases produces zero improvement.
    // At that point 'best' is a local optimum in the space of phase-template combinations.
  }

  return best;
}
```
Transparent, fast, easy to reason about. Converges to a local optimum.

### B. Fixed-point iteration on terminal balance
Directly attacks the circular dependency: you can't fully optimize Phases 1–4 without knowing what Phase 5 will cost, and you can't know Phase 5 without knowing what balance you arrive with. Fixed-point iteration breaks the deadlock by guessing, forward-simulating, and refining until the guess and the outcome agree.

```ts
function optimizeFixedPoint(assumptions: Assumptions): Strategy {
  // Step 1: Make an initial guess for the traditional balance remaining at age 75
  // (the RMD start age). Anywhere between "fully depleted" and "no conversions"
  // is a valid starting point. 50% of current balance is a reasonable first guess.
  let B_guess = assumptions.traditional * 0.5;

  const TOLERANCE   = 5_000;   // stop when guess and actual agree within $5k
  const MAX_ITERS   = 30;      // safety cap — non-convergence usually signals
                                 // multiple local optima; fall back to coordinate search
  let iterations = 0;

  while (iterations < MAX_ITERS) {
    // Step 2: Optimize Phases 1–4 treating B_guess as the conversion target.
    // The inner optimizer (§6A coordinate search works well here) tries to
    // minimize total tax across phases 1–4 while targeting this ending balance.
    const strategy14 = optimizePhases1to4(assumptions, { targetBalance: B_guess });

    // Step 3: Run the forward simulation and see what balance we ACTUALLY land on.
    // This is the true Phase 5 entry balance under the optimized strategy.
    const B_actual = simulate(strategy14, assumptions).terminalState.traditional;

    // Step 4: Check convergence — did our guess match reality?
    if (Math.abs(B_actual - B_guess) < TOLERANCE) {
      // Self-consistent: the optimizer targets B and actually lands on B.
      // Neither side wants to change — this is the fixed point. Done.
      return strategy14;
    }

    // Step 5: Update the guess for the next iteration.
    // Naive update (B_guess = B_actual) can oscillate — the optimizer overshoots
    // in one direction, then the other. A weighted average damps this out.
    B_guess = 0.6 * B_guess + 0.4 * B_actual;   // damping factor; tune if slow to converge
    iterations++;
  }

  // Fallback: if we hit the iteration cap, the objective landscape likely has
  // multiple local optima and the fixed point isn't unique. Coordinate search
  // is more robust in that case.
  console.warn(`Fixed-point did not converge after ${MAX_ITERS} iterations — using coordinate search`);
  return optimizeCoordinate();
}
```
Typically converges in 5–10 iterations. Pairs well with §6A as the inner Phases 1–4 optimizer.

### C. Backward dynamic programming (rigorous, global optimum)
Discretize the traditional-balance axis into buckets. Define:

```
// V(age, B) = the minimum total tax cost from this age forward,
//             given a traditional account balance of B at this age.
//
// WHY BACKWARD? Because today's decision affects future costs through compounding
// and RMDs. By solving the last year FIRST, every earlier year already knows
// the exact future cost of every balance it could leave behind — no circular
// dependency, no fixed-point iteration needed.
//
// Terminal condition (e.g. age 95):
//   V(terminalAge, B) = estateTaxEffect(B)   ← whatever is left triggers estate/heir cost

V(age, balanceBucket) = min over c in candidateConversions(age, B) of [

    thisYearCost(balanceBucket, c)
    // ↑ Tax bill this year: income tax + NIIT + IRMAA (attributed per §2058 fix) + penalty
    //   for converting 'c' dollars given a starting balance of B.
    //   'c' is chosen from a small finite set of cliff-edge amounts, not a continuous scan.

  + V(age+1, nextBalanceBucket(B, c))
    // ↑ Future cost of the balance left behind after growth and conversion.
    //   nextBalanceBucket = (B - rmd - c) * (1 + expectedReturn)
    //   This value is ALREADY SOLVED because we computed age+1 before age.
    //   If nextBalance doesn't land on a grid point, interpolate linearly between
    //   the two nearest buckets.
]

// To recover the optimal conversion amounts (not just the min cost total):
//   After the backward pass, do a single FORWARD replay from the actual starting balance,
//   at each age choosing the 'c' that produced the stored minimum — this reconstructs
//   the full year-by-year conversion schedule.
```
Solve backward from the terminal age. Because each year's value depends only on the *next* year's already-solved value, there's no circularity — the backward order dissolves it. This is the "correct" solver; use it to check how close the cheap heuristics (A/B) get. Cost: O(ages × balanceBuckets × conversionChoices). Keep buckets coarse first (e.g., $25k) and refine.

### Strong greedy baseline: "fill to the next cliff"
Each year, convert exactly up to the next meaningful threshold (top of current ordinary bracket, or the next IRMAA tier minus a safety margin given the 2-year lag). Often within a few percent of optimal and trivial to implement — build this as a sanity check before any search.

---

## 7. Data tables required (lookup by year, with inflation projection)

| Table | Indexed? | Notes |
|---|---|---|
| Ordinary income brackets | Annually | by filing status |
| Standard deduction | Annually | + age 65+ add-on |
| LTCG 0/15/20 thresholds | Annually | 0% ceiling is the prize in gap years |
| IRMAA tiers (Part B + D) | Annually | **cliff** step function, per person |
| NIIT threshold | **Frozen** | $200k single / $250k MFJ — never indexed |
| Estate exemption | Indexed from 2025 | $15M / $30M, 40% rate |
| Uniform Lifetime Table | Static | RMD divisors by age |
| RMD start age | — | **75** for born 1960+ |
| State income / estate tax | Varies | WA: **$0** income tax; separate estate tax with **~$3M exemption** (frozen, non-portable), top rate **20%** (reverted by SB 6347 July 2026; prior window was 35%) |
| WA capital gains tax | Annually (exemption) | Applies to stock/bond sales in taxable account. ~$262k annual exemption (inflation-adjusted); **7%** on gains above exemption; **9.9%** on gains above $1M. Real estate, retirement account withdrawals, and Roth conversions are **EXEMPT**. |

Model each as `lookup(year)` with a projected inflation rate, not constants. The frozen NIIT threshold must *not* inflate — that drift matters over decades.

---

## 8. Validation checklist

- [ ] Forward sim is deterministic and order-independent across runs.
- [ ] IRMAA uses `magiHistory[year-2]`, not current-year MAGI.
- [ ] LTCG stacks on top of ordinary income (joint bracket calc).
- [ ] Taxable-SS formula runs *after* other income is known.
- [ ] RMD floor enforced from age 75; can't convert below the forced distribution.
- [ ] Greedy "fill-to-cliff" baseline within a few % of DP optimum.
- [ ] Estate/heir term toggleable (income-only vs. legacy-inclusive objective).
- [ ] Filing-status switch (widowing) handled if in scope.

---

*Educational reference only — not tax or legal advice. Verify all figures against current IRS/CMS values before relying on output, and validate the model against a CPA for your specific situation.*
