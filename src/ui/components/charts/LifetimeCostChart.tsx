/**
 * Stacked area chart of annual cost components over the simulation horizon,
 * with dashed reference lines at the major life-phase transitions and a red
 * reference line at the first year IRMAA becomes non-zero.
 *
 * NOTE: the one-time estate cost doesn't fit naturally on a per-year x-axis
 * and is surfaced separately in ResultsSummary; it is not plotted here.
 */

import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { rmdStartAge } from '../../../engine/tables/index.ts';
import type { YearRecord } from '../../../engine/types.ts';

interface LifetimeCostChartProps {
  readonly trace: readonly YearRecord[];
  readonly birthYear: number;
}

/** Ages at which a person transitions between tax-planning phases. */
const RULE_OF_55_AGE = 55;
const PENALTY_FREE_AGE = 59.5;
const MEDICARE_AGE = 65;

const GRID_COLOR = '#21262d';
const COMPONENT_COLORS = {
  federalIncomeTax: '#58a6ff',
  irmaa: '#f85149',
  niit: '#d2a8ff',
  waCapGainsTax: '#3fb950',
  penalty: '#e3b341',
};

export function LifetimeCostChart({ trace, birthYear }: LifetimeCostChartProps) {
  const rmdAge = rmdStartAge(birthYear);
  const irmaaAges = [...new Set(trace.filter((r) => r.irmaa > 0).map((r) => r.age))];

  return (
    <div className="rounded border border-border bg-surface p-4">
      <div className="mb-2 text-sm text-text-muted">Annual cost breakdown</div>
      <ResponsiveContainer width="100%" height={300}>
        <AreaChart data={[...trace]} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid stroke={GRID_COLOR} strokeDasharray="3 3" />
          <XAxis dataKey="age" stroke="#8b949e" fontFamily="DM Mono" fontSize={12} />
          <YAxis stroke="#8b949e" fontFamily="DM Mono" fontSize={12} tickFormatter={(v: number) => `$${v / 1000}k`} />
          <Tooltip
            contentStyle={{ background: '#161b22', border: '1px solid #30363d', fontFamily: 'DM Mono' }}
            labelFormatter={(label) => `Age ${String(label)}`}
            formatter={(value: number, name: string) => [`$${value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`, name]}
          />
          <Area type="monotone" dataKey="federalIncomeTax" stackId="cost" name="Federal income tax" stroke={COMPONENT_COLORS.federalIncomeTax} fill={COMPONENT_COLORS.federalIncomeTax} fillOpacity={0.5} />
          <Area type="monotone" dataKey="irmaa" stackId="cost" name="IRMAA" stroke={COMPONENT_COLORS.irmaa} fill={COMPONENT_COLORS.irmaa} fillOpacity={0.5} />
          <Area type="monotone" dataKey="niit" stackId="cost" name="NIIT" stroke={COMPONENT_COLORS.niit} fill={COMPONENT_COLORS.niit} fillOpacity={0.5} />
          <Area type="monotone" dataKey="waCapGainsTax" stackId="cost" name="WA cap gains" stroke={COMPONENT_COLORS.waCapGainsTax} fill={COMPONENT_COLORS.waCapGainsTax} fillOpacity={0.5} />
          <Area type="monotone" dataKey="penalty" stackId="cost" name="Penalty" stroke={COMPONENT_COLORS.penalty} fill={COMPONENT_COLORS.penalty} fillOpacity={0.5} />

          <ReferenceLine x={RULE_OF_55_AGE} stroke="#8b949e" strokeDasharray="4 4" />
          <ReferenceLine x={PENALTY_FREE_AGE} stroke="#8b949e" strokeDasharray="4 4" />
          <ReferenceLine x={MEDICARE_AGE} stroke="#8b949e" strokeDasharray="4 4" />
          <ReferenceLine x={rmdAge} stroke="#8b949e" strokeDasharray="4 4" />
          {irmaaAges.map((age) => (
            <ReferenceLine key={age} x={age} stroke={COMPONENT_COLORS.irmaa} strokeDasharray="2 2" />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
