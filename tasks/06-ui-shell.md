# Task 06 — React UI Shell

## Goal
Build the full single-page React UI: assumption inputs, phase strategy controls,
results panel, and year-by-year cost breakdown chart. Wire to the greedy optimizer
from task 05 for live results.

## Reference
`docs/01-tax-phases.md` — phase descriptions for labeling  
`CLAUDE.md` — UI aesthetic direction (dark theme, DM Sans/DM Mono, Cowork style)

## Pre-conditions
Tasks 01–05 complete.

## Files to Create
```
src/ui/App.tsx
src/ui/main.tsx
src/ui/components/inputs/AssumptionsPanel.tsx
src/ui/components/inputs/StrategyPanel.tsx
src/ui/components/charts/LifetimeCostChart.tsx
src/ui/components/charts/CostBreakdownChart.tsx
src/ui/components/results/ResultsSummary.tsx
src/ui/components/results/YearTable.tsx
src/ui/hooks/useOptimizer.ts
index.html
```

---

## Aesthetic & Design Requirements

**Theme:** Dark, data-dense, professional — consistent with the Cowork platform.
- Background: `#0d1117` (near-black)
- Surface cards: `#161b22` with a `1px` border of `#30363d`
- Primary accent: `#58a6ff` (bright blue) for the main cost number and key values
- Warning accent: `#f85149` (red) for IRMAA cliff crossings and cost spikes
- Text: `#c9d1d9` (primary), `#8b949e` (muted)
- **All numerical values use DM Mono**; all other text uses DM Sans
- Smooth transitions (150ms ease) on input changes

**Charts (Recharts):**
- Dark backgrounds with subtle grid lines (`#21262d`)
- Colored area stacks per cost component (income tax, IRMAA, NIIT, estate)
- Reference lines at IRMAA tier crossings (red, dashed)
- Tooltips on hover showing year, age, and each cost component
- No chart borders, minimal chrome

---

## Component Specifications

### `AssumptionsPanel`
Collects all fields from `Assumptions`. Group fields into sections:
- **You**: birth year, current age, filing status, state
- **Accounts**: traditional balance, Roth balance, taxable value + basis
- **Spending**: annual spending, expected return
- **Estate**: horizon age, heir marginal rate, discount rate

All numeric inputs use DM Mono. Validate: balances ≥ 0, ages in sensible ranges.
Show a subtle inline error if validation fails (do not block submission).

### `StrategyPanel`
Two modes toggled by a switch: **Manual** and **Phase Templates**.

**Phase Templates mode** (default):
- One row per phase with the phase name and description
- A 3-way segmented control per phase: Conservative / Moderate / Aggressive
- Tooltip on each control explaining what that level means for that phase
- SS claim age slider: 62–70, with the estimated monthly benefit shown

**Manual mode:**
- Per-year conversion amount input (a table of ~40 rows)
- Import/export as JSON
- Disable this mode for now; show a "Coming soon" placeholder

### `useOptimizer` (custom hook)
```ts
/**
 * Debounces assumption and strategy changes, runs greedyOptimize() on the
 * engine in a Web Worker (to avoid blocking the UI thread), and returns
 * the latest SimResult.
 *
 * Returns { result, isComputing, error }.
 * While computing, isComputing is true — show a subtle spinner on the results panel.
 */
export function useOptimizer(
  assumptions: Assumptions,
  strategy: Strategy,
): { result: SimResult | null; isComputing: boolean; error: string | null }
```

Use a Web Worker to run `simulate()` so the UI never freezes during computation.
Debounce the trigger: re-compute 300ms after the last input change.

### `ResultsSummary`
Displays the headline numbers at the top of the results panel:
- **Total lifetime tax cost** — large, DM Mono, accent color
- **Breakdown ring chart** or large numbers: income tax / IRMAA / NIIT / estate (each %)
- Optimal SS claim age with estimated impact vs claiming at 62
- A one-line status: "IRMAA crossed in [N] years" or "Clear of all IRMAA tiers"

### `LifetimeCostChart`
Stacked area chart over the simulation years showing annual cost components:
- Areas (bottom to top): federal income tax, IRMAA, NIIT, WA cap gains, penalty, estate (final bar)
- X-axis: age. Y-axis: annual cost in dollars.
- Dashed vertical reference lines at phase transitions (55, 59½, 65, 75)
- Red reference line in any year IRMAA is non-zero
- Recharts `ResponsiveContainer` for full width

### `CostBreakdownChart`
Bar chart comparing total cost across three scenarios:
- No conversions (worst case)
- Greedy optimizer result (current)
- Placeholder for DP optimizer (task 07, shown as "Deep optimize — coming soon")

### `YearTable`
Scrollable table showing one row per simulation year:
Columns: Age | Year | Conversion | Ordinary Income | MAGI | Fed Tax | IRMAA | NIIT | WA CGT | Year Cost | Trad Balance | Roth Balance

- Numbers formatted with commas and 0 decimal places (DM Mono)
- Highlight rows where IRMAA > 0 with a subtle red left border
- Highlight rows where RMD kicks in (age 75) with a subtle yellow marker
- Virtualized if > 50 rows (use a simple windowed render — no library required)

---

## Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Header: "Lifetime Tax Optimizer"                 [Settings] [?]        │
├───────────────────────┬─────────────────────────────────────────────────┤
│  AssumptionsPanel     │  ResultsSummary (headline numbers)              │
│  StrategyPanel        ├─────────────────────────────────────────────────┤
│                       │  LifetimeCostChart (stacked area)               │
│                       ├─────────────────────────────────────────────────┤
│                       │  CostBreakdownChart (3-scenario bar)            │
│                       ├─────────────────────────────────────────────────┤
│                       │  YearTable (scrollable)                         │
└───────────────────────┴─────────────────────────────────────────────────┘
```

Left panel: fixed width ~380px; right panel: fills remaining width.
On narrow screens (< 900px): stack vertically, inputs first.

---

## Tests Required

### `useOptimizer`
- Returns `isComputing: true` immediately after an input change
- Returns a valid `SimResult` within a reasonable timeout
- Does not re-compute if inputs are unchanged

### `AssumptionsPanel`
- Renders all required fields
- Shows validation error for negative balance input
- Calls `onChange` with updated `Assumptions` when a field changes

### `YearTable`
- Renders the correct number of rows matching `result.trace.length`
- IRMAA rows are visually distinguished (check className or aria-label)

## Acceptance Criteria
- [ ] UI renders with default assumptions and shows a result without interaction
- [ ] Changing any assumption or strategy updates results within ~500ms
- [ ] `LifetimeCostChart` shows stacked areas with phase reference lines
- [ ] `YearTable` highlights IRMAA years and RMD start year
- [ ] No tax math in any UI component — all numbers come from `useOptimizer`
- [ ] `npm run typecheck` and `npm run test` pass
