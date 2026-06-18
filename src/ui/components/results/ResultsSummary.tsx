/**
 * Headline numbers shown at the top of the results panel: total lifetime
 * cost, a cost-component breakdown, the chosen SS claim age vs. claiming at
 * 62, and a one-line IRMAA status. All figures are derived from `result` —
 * this component performs no tax math of its own.
 */

import { useMemo } from 'react';
import { simulate } from '../../../engine/simulate.ts';
import type { Assumptions, SimResult, Strategy, YearRecord } from '../../../engine/types.ts';

interface ResultsSummaryProps {
  readonly result: SimResult | null;
  readonly isComputing: boolean;
  readonly error: string | null;
  readonly assumptions: Assumptions;
  readonly strategy: Strategy;
}

const EARLIEST_SS_CLAIM_AGE = 62;
const CURRENCY_FORMATTER = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
});

/** Sums one numeric field across the year-by-year trace. */
function sumField(trace: readonly YearRecord[], field: keyof YearRecord): number {
  return trace.reduce((total, record) => total + (record[field] as number), 0);
}

/** Returns "N years" describing how soon IRMAA first applies, or null if never. */
function findFirstIrmaaYear(trace: readonly YearRecord[]): number | null {
  const index = trace.findIndex((record) => record.irmaa > 0);
  return index === -1 ? null : index + 1;
}

export function ResultsSummary({ result, isComputing, error, assumptions, strategy }: ResultsSummaryProps) {
  const claimAt62Cost = useMemo(() => {
    if (strategy.ssClaimAge === EARLIEST_SS_CLAIM_AGE) return null;
    return simulate({ ...strategy, ssClaimAge: EARLIEST_SS_CLAIM_AGE }, assumptions).totalCost;
  }, [assumptions, strategy]);

  if (error) {
    return (
      <div className="rounded border border-warning bg-surface p-4 text-warning">
        Error computing results: {error}
      </div>
    );
  }

  if (!result) {
    return <div className="rounded border border-border bg-surface p-4 text-text-muted">Computing…</div>;
  }

  const { trace, totalCost } = result;
  const incomeTax = sumField(trace, 'federalIncomeTax');
  const irmaa = sumField(trace, 'irmaa');
  const niit = sumField(trace, 'niit');
  const waCapGains = sumField(trace, 'waCapGainsTax');
  const penalty = sumField(trace, 'penalty');
  const yearCostTotal = incomeTax + irmaa + niit + waCapGains + penalty;
  const estateShare = Math.max(0, totalCost - yearCostTotal);

  const components: Array<{ label: string; value: number }> = [
    { label: 'Income tax', value: incomeTax },
    { label: 'IRMAA', value: irmaa },
    { label: 'NIIT', value: niit },
    { label: 'WA cap gains', value: waCapGains },
    { label: 'Penalty', value: penalty },
    { label: 'Estate', value: estateShare },
  ];

  const firstIrmaaYear = findFirstIrmaaYear(trace);
  const irmaaStatus =
    firstIrmaaYear === null
      ? 'Clear of all IRMAA tiers'
      : `IRMAA crossed in ${firstIrmaaYear} year${firstIrmaaYear === 1 ? '' : 's'}`;

  const impactVs62 = claimAt62Cost === null ? null : claimAt62Cost - totalCost;

  return (
    <div className={`rounded border border-border bg-surface p-4 ${isComputing ? 'opacity-70' : ''}`}>
      <div className="text-sm text-text-muted">Total lifetime tax cost</div>
      <div className="font-mono text-3xl font-medium text-accent" data-testid="total-cost">
        {CURRENCY_FORMATTER.format(totalCost)}
        {isComputing && <span className="ml-2 align-middle text-sm text-text-muted">recomputing…</span>}
      </div>

      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
        {components.map(({ label, value }) => (
          <div key={label} className="flex justify-between gap-2">
            <span className="text-text-muted">{label}</span>
            <span className="font-mono text-text">
              {totalCost > 0 ? `${Math.round((value / totalCost) * 100)}%` : '0%'}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-3 text-sm text-text-muted">
        SS claim age: <span className="font-mono text-text">{strategy.ssClaimAge}</span>
        {impactVs62 !== null && (
          <span>
            {' '}
            ({impactVs62 >= 0 ? 'saves' : 'costs'} {CURRENCY_FORMATTER.format(Math.abs(impactVs62))} vs. claiming at{' '}
            {EARLIEST_SS_CLAIM_AGE})
          </span>
        )}
      </div>

      <div className={`mt-2 text-sm ${firstIrmaaYear === null ? 'text-text-muted' : 'text-warning'}`}>
        {irmaaStatus}
      </div>
    </div>
  );
}
