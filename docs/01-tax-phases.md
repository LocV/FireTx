# Early-Retirement Tax Phases: Considerations for the Roth Conversion Simulator

**Purpose:** Reference map of the tax rules that govern each life phase, so the simulator's per-year cost function knows *which levers and cliffs exist when*. Optimization goal: minimize **total lifetime cost** = federal income tax + state income tax + IRMAA surcharges + early-withdrawal penalties + (for HNW) projected estate/transfer tax.

> **Figures are 2026 values.** Brackets, the 0% LTCG ceiling, standard deduction, and IRMAA tiers are **indexed annually**. The estate exemption indexes from a 2025 base. **NIIT thresholds are frozen** (never indexed). Build these as a lookup table by year + projected inflation, not as hardcoded constants. Always verify current figures before relying on them.

> **Two corrections from our discussion baked in below:** (1) For anyone born 1960 or later, **RMDs now begin at age 75**, not 72 (SECURE 2.0). (2) The phase split that matters most in the back half is **age 65** (Medicare/IRMAA start; ACA subsidies end), not 62. Social Security claiming (62–70) is treated as a cross-cutting decision, not a phase boundary.

---

## Phase 1 — Now (early 50s) → Age 55 :: Pre-55 / Conversion-only

**Account access:** No penalty-free access to 401(k)/traditional IRA. Roth conversions are allowed (they aren't withdrawals) but the *tax* on the converted amount must be paid from outside funds to be efficient. Roth contribution *basis* is always accessible; earnings are not.

**Pertinent rules:**
- **Ordinary income tax brackets** — conversions stack on top of any remaining earned income. Watch the top of whatever bracket you want to stay in.
- **10% early-withdrawal penalty (IRC §72(t))** — applies to any actual distribution before 59½ unless an exception applies. Discourages tapping tax-deferred accounts this phase; favors living off taxable/brokerage assets.
- **72(t) / SEPP exception** — substantially equal periodic payments can unlock penalty-free withdrawals early, but lock you into a rigid schedule. Worth modeling as an *option*, not a default.
- **0% / 15% / 20% long-term capital gains brackets** — if you're living off a brokerage account, realized LTCG may sit in the **0% bracket** to the extent total taxable income stays under the ceiling (**2026: ~$49,450 single / ~$98,900 MFJ**, after the standard deduction). This bracket and conversions *compete* for the same low-income headroom — a core tradeoff for the optimizer.
- **3.8% NIIT** — kicks in on net investment income once MAGI exceeds **$200k single / $250k MFJ (frozen)**. Conversions raise MAGI and can drag investment income into NIIT.
- **ACA Premium Tax Credits** — if buying marketplace health insurance pre-65, MAGI drives subsidy size. *Aggressive conversions can erase subsidies.* (Subsidy structure was in flux after 2025 — verify the current rules; this can be a four/five-figure swing per year.)
- **Estate/gift:** annual gift exclusion (~$19k/donor/recipient, 2026 indexed) and the **$15M lifetime exemption** are in play if early gifting is part of the HNW strategy.

---

## Phase 2 — Age 55 → 59½ :: Rule of 55 Window

**Account access:** **Rule of 55** — penalty-free withdrawals from the **401(k) of the employer you separated from in or after the year you turn 55**. Does *not* apply to IRAs, and does *not* apply to old 401(k)s from prior employers (roll those in *before* separating if you want access). Withdrawals are still **ordinary-income taxable** — only the penalty is waived.

**Pertinent rules:**
- Everything from Phase 1 still applies (brackets, NIIT, LTCG, ACA).
- **Rule of 55 strategic note:** this is the first window where you can pull 401(k) dollars *and* convert in the same low-income environment. Don't roll the separation-year 401(k) into an IRA if you want to preserve this access.
- **Penalty-free ≠ tax-free** — the optimizer should treat Rule-of-55 distributions and Roth conversions as both adding to ordinary income; the only difference vs. Phase 1 is the removed 10% penalty.
- **ACA cliff still live** (pre-65) — same subsidy sensitivity as Phase 1.

---

## Phase 3 — Age 59½ → 65 :: Penalty-Free, Pre-Medicare

**Account access:** Full penalty-free access to all retirement accounts (59½ clears §72(t) entirely). **No RMDs yet.** This is typically the **prime conversion window** — maximum flexibility, no forced income.

**Pertinent rules:**
- **Ordinary brackets** — the main conversion lever. With no wages and no RMDs, you control taxable income almost entirely.
- **0% LTCG harvesting** still available — same competition with conversions for low-bracket space.
- **Roth 5-year rules** — each *conversion* has its own 5-year clock for penalty-free access to converted principal before 59½ (mostly moot after 59½, but the *account's* 5-year clock for tax-free *earnings* still matters if the Roth is young).
- **3.8% NIIT** — same frozen thresholds.
- **ACA Premium Tax Credits** — **last phase they apply** (Medicare starts at 65). The tension between "convert aggressively now" vs. "keep MAGI low for subsidies" is sharpest here.
- **Social Security interaction** — if claimed early (62+), benefits add to income and up to 85% becomes taxable; this shrinks conversion headroom. Generally favors *delaying* SS to keep this window clean for conversions.

---

## Phase 4 — Age 65 → 75 :: Medicare Era / IRMAA-Sensitive Conversions

**Account access:** Full access, still **no RMDs** (until 75). This is the **last conversion runway before forced distributions** — and the most cliff-laden phase.

**Pertinent rules:**
- **IRMAA (Medicare Part B & D surcharges)** — the defining constraint of this phase.
  - **Two-year lookback:** your MAGI *today* sets your premium *two years later*. So conversions at 65 affect premiums at 67. The simulator must model this lag explicitly.
  - **Cliff, not a ramp:** $1 over a tier triggers the *full* surcharge for that tier. 2026 first tier begins at **$109k single / $218k MFJ**; tiers escalate to **$500k single / $750k MFJ**.
  - **Per-person:** a married couple pays the surcharge on each spouse's premium.
  - Annual cost of crossing a tier ranges from ~$1,000 to ~$5,000+ per couple per tier — recurring every year you stay over.
- **Social Security** — full retirement age is 67; delaying to 70 maximizes the benefit. Once claimed, taxation of benefits (up to 85%) and the MAGI bump interact with both brackets and IRMAA. The **62–70 claiming decision lives inside Phases 3–4** and is itself an optimization variable.
- **Ordinary brackets** — still the conversion lever, now constrained by IRMAA tiers sitting *below* some bracket edges.
- **The Phase 4 ↔ Phase 5 tradeoff is the heart of the model:** every dollar *not* converted here grows and becomes a *forced* RMD at 75+, potentially at a higher bracket. Every dollar converted here may trip an IRMAA cliff. This is the circular dependency — solve by iterating to a stable end-of-Phase-4 balance.
- **3.8% NIIT** — same.

---

## Phase 5 — Age 75+ :: RMD Era

**Account access:** **Required Minimum Distributions begin at 75** (born 1960+). RMD = prior-year-end balance ÷ IRS Uniform Lifetime factor; the factor shrinks with age, so RMDs *rise* over time even on a flat balance.

**Pertinent rules:**
- **RMDs are mandatory ordinary income** — non-optional, and they stack on Social Security and any other income. This is the "tax bomb" the earlier phases exist to defuse.
- **25% excise penalty** for missing an RMD (reduced to 10% if corrected promptly). The simulator should treat RMDs as a hard floor on taxable income.
- **Roth has no RMDs** — every dollar moved to Roth in Phases 1–4 reduces this floor. That's the entire payoff of early conversions.
- **IRMAA still applies** — RMDs can re-trigger cliffs; the two-year lookback means late-Phase-4 conversions and early RMDs can compound.
- **QCDs (Qualified Charitable Distributions)** — from age 70½, up to ~$108k/yr (2025, indexed) can satisfy RMDs *without* hitting MAGI. A real lever for IRMAA control and charitable HNW households — worth a toggle.
- **Estate tax (the HNW endgame):**
  - **$15M per person / $30M per couple** exemption (2026, permanent, indexed from 2025 base); **40% rate** on the excess.
  - **Step-up in basis at death** — appreciated *taxable* assets get a basis reset, so heirs avoid the embedded gain. This argues *against* spending down/realizing gains in taxable accounts late in life, and changes the Roth-vs-taxable-vs-traditional calculus for what you *leave behind*.
  - **Inherited IRA 10-year rule** — non-spouse heirs must drain inherited traditional IRAs within 10 years, often in their own peak-earning years (high brackets). Roth balances pass far more efficiently. This makes Roth conversions partly an *heir's* tax optimization, not just yours — the cost function should arguably extend past your death.

---

## Cross-Cutting Considerations (apply across all phases)

- **State income tax** — varies enormously; some states don't tax retirement income or have no income tax. Relocation timing (e.g., before a big conversion year) is a lever. WA has no income tax but does have its own estate tax with a lower exemption — relevant to your situation.
- **Social Security claiming age (62–70)** — a standalone optimization axis interacting with brackets, benefit taxation, and IRMAA across Phases 3–5.
- **NIIT thresholds are frozen** — inflation steadily drags more income into the 3.8% surtax; model this drift over a multi-decade horizon.
- **The two-year IRMAA lookback** is the single most under-modeled mechanic — it couples non-adjacent years and must be in the state, not just the current-year calc.
- **Filing status changes** (death of a spouse → single brackets + lower IRMAA thresholds) can cause a "widow's penalty" tax spike — worth modeling if relevant.

---

## Algorithm Implications (recap)

- **State variables per year:** age, balances by account type (traditional, Roth, taxable w/ basis), filing status, SS claimed?, **prior-2-years MAGI** (for IRMAA).
- **Decision variable per year:** conversion amount (+ withdrawal sourcing, + SS claim timing).
- **Per-year cost:** income tax + state tax + IRMAA (from 2-yr-prior MAGI) + penalties + marginal estate-tax effect.
- **The circular dependency** (deplete early → Phase 5 trivial; preserve → Phase 5 tax bomb) is best resolved by **fixed-point iteration**: guess an end-state balance, optimize Phases 1–4 against it, recompute Phase 5, repeat until the balance stabilizes — then layer the per-phase "conservative/moderate/aggressive" strategy templates on top for sensitivity exploration.

---

*Educational reference only — not tax or legal advice. Tax law and these figures change; verify current values and consult a CPA/estate attorney before acting, especially given the HNW estate-tax and state-tax dimensions.*
