/**
 * Top-level application shell: wires the assumptions/strategy inputs to the
 * simulation engine via useOptimizer and lays out the results panel.
 */

import { useState } from 'react';
import { AssumptionsPanel } from './components/inputs/AssumptionsPanel.tsx';
import { StrategyPanel } from './components/inputs/StrategyPanel.tsx';
import { LifetimeCostChart } from './components/charts/LifetimeCostChart.tsx';
import { CostBreakdownChart } from './components/charts/CostBreakdownChart.tsx';
import { ResultsSummary } from './components/results/ResultsSummary.tsx';
import { YearTable } from './components/results/YearTable.tsx';
import { useOptimizer } from './hooks/useOptimizer.ts';
import { Phase, type Assumptions, type Strategy } from '../engine/types.ts';

/** Reasonable starting point for an early retiree exploring conversions. */
export const DEFAULT_ASSUMPTIONS: Assumptions = {
  birthYear: 1974,
  currentAge: 52,
  horizonAge: 95,
  traditional: 1_000_000,
  roth: 200_000,
  taxable: { value: 400_000, basis: 250_000 },
  annualSpending: 80_000,
  ssMonthlyBenefitAtFRA: 3_000,
  expectedReturn: 0.06,
  discountRate: 0,
  filingStatus: 'mfj',
  state: 'WA',
  heirMarginalRate: 0.32,
};

/** Default strategy: moderate conversions in every phase, SS claimed at FRA. */
export const DEFAULT_STRATEGY: Strategy = {
  ssClaimAge: 67,
  phaseTemplates: {
    [Phase.PRE_55]: 'moderate',
    [Phase.RULE_OF_55]: 'moderate',
    [Phase.PENALTY_FREE]: 'moderate',
    [Phase.MEDICARE_ERA]: 'moderate',
    [Phase.RMD_ERA]: 'moderate',
  },
};

export function App() {
  const [assumptions, setAssumptions] = useState<Assumptions>(DEFAULT_ASSUMPTIONS);
  const [strategy, setStrategy] = useState<Strategy>(DEFAULT_STRATEGY);
  const { result, isComputing, error } = useOptimizer(assumptions, strategy);

  return (
    <div className="min-h-screen bg-bg font-sans text-text">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <h1 className="text-lg font-medium">Lifetime Tax Optimizer</h1>
        <div className="flex gap-3 text-sm text-text-muted">
          <button type="button" className="rounded border border-border px-2 py-1">
            Settings
          </button>
          <button type="button" className="rounded border border-border px-2 py-1" aria-label="Help">
            ?
          </button>
        </div>
      </header>

      <div className="flex flex-col gap-4 p-4 md:flex-row">
        <aside className="flex w-full flex-col gap-4 md:w-[380px] md:flex-shrink-0">
          <AssumptionsPanel assumptions={assumptions} onChange={setAssumptions} />
          <StrategyPanel assumptions={assumptions} strategy={strategy} onChange={setStrategy} />
        </aside>

        <main className="flex flex-1 flex-col gap-4">
          <ResultsSummary
            result={result}
            isComputing={isComputing}
            error={error}
            assumptions={assumptions}
            strategy={strategy}
          />
          <LifetimeCostChart trace={result?.trace ?? []} birthYear={assumptions.birthYear} />
          <CostBreakdownChart assumptions={assumptions} result={result} />
          <YearTable trace={result?.trace ?? []} birthYear={assumptions.birthYear} />
        </main>
      </div>
    </div>
  );
}

export default App;
