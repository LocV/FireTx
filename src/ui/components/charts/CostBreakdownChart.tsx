/**
 * Bar chart comparing total lifetime cost across three scenarios:
 * doing nothing (no conversions), the greedy optimizer's result, and the
 * DP "deep optimize" result (task 07), computed on demand.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { dpOptimize } from '../../../engine/optimizer/dp.ts';
import { greedyOptimize } from '../../../engine/optimizer/greedy.ts';
import { simulate } from '../../../engine/simulate.ts';
import type { Assumptions, SimResult, YearDecision } from '../../../engine/types.ts';

interface CostBreakdownChartProps {
  readonly assumptions: Assumptions;
  readonly result: SimResult | null;
}

const GRID_COLOR = '#21262d';
const BAR_COLOR = '#58a6ff';
const DEFAULT_NO_CONVERSION_SS_CLAIM_AGE = 70;

export function CostBreakdownChart({ assumptions, result }: CostBreakdownChartProps) {
  const [deepCost, setDeepCost] = useState<number | null>(null);
  const [isOptimizing, setIsOptimizing] = useState(false);

  // The DP solve is only valid for the assumptions it was run against —
  // discard a stale result whenever the inputs change.
  useEffect(() => {
    setDeepCost(null);
  }, [assumptions]);

  // No Web Worker (see useOptimizer.ts) — the DP solve is synchronous and can
  // take a couple of seconds for long horizons, so it's user-triggered rather
  // than run on every input change. Deferred via setTimeout so "Computing..."
  // paints before the blocking solve runs.
  const runDeepOptimize = useCallback(() => {
    setIsOptimizing(true);
    setTimeout(() => {
      const { result: dpResult } = dpOptimize(assumptions);
      setDeepCost(dpResult.totalCost);
      setIsOptimizing(false);
    }, 0);
  }, [assumptions]);

  const data = useMemo(() => {
    const numYears = assumptions.horizonAge - assumptions.currentAge;
    const empty = [
      { scenario: 'No conversions', cost: 0 },
      { scenario: 'Greedy (current)', cost: 0 },
      { scenario: 'Deep optimize', cost: 0 },
    ];
    if (numYears <= 0) return empty;
    try {
      const zeroDecision: YearDecision = { conversionAmount: 0, withdrawalOrder: ['taxable', 'traditional', 'roth'] };
      const zeroResult = simulate(
        { ssClaimAge: DEFAULT_NO_CONVERSION_SS_CLAIM_AGE, perYear: new Array(numYears).fill(zeroDecision) },
        assumptions,
      );
      const { result: greedyResult } = greedyOptimize(assumptions);
      return [
        { scenario: 'No conversions', cost: zeroResult.totalCost },
        { scenario: 'Greedy (current)', cost: result?.totalCost ?? greedyResult.totalCost },
        { scenario: 'Deep optimize', cost: deepCost ?? 0 },
      ];
    } catch {
      return empty;
    }
  }, [assumptions, result, deepCost]);

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="mb-2 text-sm text-text-muted">Scenario comparison</div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
          <XAxis dataKey="scenario" stroke="#8b949e" fontFamily="DM Mono" fontSize={12} />
          <YAxis stroke="#8b949e" fontFamily="DM Mono" fontSize={12} tickFormatter={(v: number) => `$${v / 1000}k`} />
          <Tooltip contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontFamily: 'DM Mono' }} />
          <Bar dataKey="cost" fill={BAR_COLOR} />
        </BarChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-2 text-xs text-text-muted">
        <button
          type="button"
          onClick={runDeepOptimize}
          disabled={isOptimizing}
          className="rounded border border-border px-2 py-1 text-text disabled:opacity-50"
        >
          {isOptimizing ? 'Computing…' : 'Run deep optimize'}
        </button>
        {deepCost === null && !isOptimizing && (
          <span>"Deep optimize" runs the backward dynamic-programming solver for the global optimum.</span>
        )}
      </div>
    </div>
  );
}
