# Lifetime Tax Optimizer — Project Context

## What This Is
A client-side TypeScript/React web app that calculates and minimizes total lifetime tax
for early retirees executing Roth conversion strategies. The optimizer accounts for
federal income tax, IRMAA Medicare surcharges, NIIT, early-withdrawal penalties,
Washington State taxes, and estate/heir tax.

Full algorithm specs: `docs/02-simulator-algorithm.md` and `docs/03-optimization.md`
Tax phase reference:  `docs/01-tax-phases.md`
Current task:         `TASKS.md` → read this before starting any work session

---

## Tech Stack
- **Language:** TypeScript 5.x — strict mode, zero `any`
- **UI:** React 18 + Vite
- **Testing:** Vitest + React Testing Library
- **Charts:** Recharts
- **Styling:** Tailwind CSS + CSS variables
- **Fonts:** DM Sans (UI text), DM Mono (numbers/data)
- **No backend** — pure client-side; all computation runs in the browser

---

## Architecture: Two Layers, Strictly Separated

```
src/engine/   ← Pure TypeScript. No React, no DOM, no side effects.
              ← All tax math lives here. Fully testable without a browser.

src/ui/       ← React only. Calls engine functions. Does zero tax math.
```

**Rule:** Never import from `ui/` inside `engine/`. The engine is UI-agnostic.

---

## File Structure
```
src/
  engine/
    types.ts                  ← ALL TypeScript interfaces (single source of truth)
    tables/
      brackets.ts             ← Federal income tax brackets by year
      irmaa.ts                ← IRMAA step-function tiers by year
      rmd.ts                  ← IRS Uniform Lifetime Table + rmdStartAge()
      estate.ts               ← WA + federal estate tax schedules
      capitalGains.ts         ← WA state capital gains tax
    computeYear.ts            ← 13-step per-year cost function + helpers
    simulate.ts               ← Forward simulation loop
    optimizer/
      greedy.ts               ← Fill-to-cliff baseline (build first)
      coordinate.ts           ← Phase-template coordinate search
      fixedPoint.ts           ← Fixed-point iteration on terminal balance
      dp.ts                   ← Backward dynamic programming (build last)
  ui/
    components/
      inputs/                 ← Assumption + strategy input panels
      charts/                 ← Year-by-year breakdown charts
      results/                ← Cost summary and comparison panels
    App.tsx
    main.tsx
docs/
  01-tax-phases.md
  02-simulator-algorithm.md
  03-optimization.md
tasks/
  01-tax-tables.md
  02-types.md
  03-compute-year.md
  04-simulate.md
  05-greedy-optimizer.md
  06-ui-shell.md
  07-dp-optimizer.md
TASKS.md
```

---

## Coding Standards — Apply to Every File

### Function Design
- **Max 30 lines per function.** If it's longer, split it into named helpers.
- **One responsibility per function.** If you need "and" to describe it, split it.
- **Pure functions only in `engine/`.** No mutation, no side effects, no I/O, no Date.now().
- **Never mutate inputs.** `computeYear` returns a new `YearState`; it never modifies the one it received.

### Documentation
- **JSDoc on every exported function** — `@param`, `@returns`, and at least one `@example`.
- **Inline comments on non-obvious logic** — every tax cliff, formula derivation, and
  ordering dependency needs a comment explaining *why*, not just *what*.
- **Named constants for every magic number:**
  ```ts
  // ✗ Bad
  const niit = 0.038 * excess;

  // ✓ Good
  const NIIT_RATE = 0.038;
  const niit = NIIT_RATE * excess;
  ```

### TypeScript
- Strict mode. Zero `any`. Use `unknown` + type guards if the type is genuinely dynamic.
- Named exports everywhere — no default exports in `engine/`.
- Mark interface properties `readonly` unless mutation is intentional and documented.
- Use discriminated unions for variants. Use `satisfies` to catch table-shape errors.

### Testing
- **Co-locate tests:** `computeYear.test.ts` lives in the same folder as `computeYear.ts`.
- **Every exported function has at least one unit test.**
- **Cliff behavior must be explicitly tested:** one dollar under, at, and one dollar over
  each IRMAA tier, bracket edge, and NIIT threshold.
- **All tests pass before moving to the next task.**

### Naming
- Established domain abbreviations are fine: `magi`, `rmd`, `irmaa`, `ltcg`, `niit`, `ss`, `wa`.
- All other names are spelled out: `traditionalBalance` not `tBal`, `conversionAmount` not `conv`.
- Constants: `SCREAMING_SNAKE_CASE`. Types: `PascalCase`. Variables/functions: `camelCase`.

---

## Key Invariants — Do Not Revisit These Decisions

1. `simulate(strategy, assumptions)` is a **pure function**. Same inputs → same output, always.
2. `YearState` is **immutable**. Every year produces a new state object.
3. **IRMAA is attributed to the year that caused it** (2 years prior), not the year it is paid.
   This is the Markov reformulation — see `docs/03-optimization.md §5`. Do not change this.
4. **Tax table values come from `lookup(year)` functions** — never hardcoded in computation logic.
5. **`waCapGainsTax` is a separate line item** from `stateTax`. WA has no income tax but
   does have a capital gains tax (7–9.9%) and a separate estate tax. Keep them distinct.
6. **The engine never reads from the UI.** Data flows one way: UI → engine → UI.

---

## UI Aesthetic Direction
- **Theme:** Dark, data-dense, professional — consistent with the Cowork platform aesthetic.
- **Fonts:** DM Sans for all UI text; DM Mono for numerical values and data fields.
- **Color:** Dark background (#0f1117 or similar), muted surface cards, sharp accent for
  the primary cost number and cliff warnings.
- **Charts:** Clean Recharts line/area charts with minimal chrome. Highlight IRMAA tier
  crossings and bracket edges as reference lines.
- **Interactions:** Smooth transitions when strategy inputs change and results update.
  No jarring re-renders — debounce computation triggers.

---

## Running the Project
```bash
npm install
npm run dev        # Vite dev server
npm run test       # Vitest in watch mode
npm run typecheck  # tsc --noEmit
```
All three must pass cleanly before a task is considered done.
