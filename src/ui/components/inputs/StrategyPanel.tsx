/**
 * Strategy controls. Defaults to "Phase Templates" mode: a 3-way
 * conservative/moderate/aggressive control per life phase, plus an SS
 * claim-age slider. "Manual" mode (per-year editing + JSON import/export)
 * is a placeholder for now.
 */

import { useState } from 'react';
import { ssBenefitMultiplier } from '../../../engine/simulate.ts';

/** Small ⓘ icon that shows a tooltip on hover. */
function InfoTip({ text }: { text: string }) {
  return (
    <span className="group relative ml-1 inline-block align-middle">
      <span className="cursor-default select-none rounded-full border border-border bg-surface px-1 font-mono text-xs text-text-muted">
        ⓘ
      </span>
      <span className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1 w-56 -translate-x-1/2 rounded border border-border bg-surface px-2 py-1 text-xs text-text opacity-0 shadow-lg transition-opacity group-hover:opacity-100">
        {text}
      </span>
    </span>
  );
}
import { Phase, type Assumptions, type PhaseTemplate, type Strategy } from '../../../engine/types.ts';

interface StrategyPanelProps {
  readonly assumptions: Assumptions;
  readonly strategy: Strategy;
  readonly onChange: (next: Strategy) => void;
}

const PHASE_ORDER: readonly Phase[] = [
  Phase.PRE_55,
  Phase.RULE_OF_55,
  Phase.PENALTY_FREE,
  Phase.MEDICARE_ERA,
  Phase.RMD_ERA,
];

const PHASE_INFO: Record<Phase, { label: string; description: string }> = {
  [Phase.PRE_55]: { label: 'Pre-55', description: 'Conversion-only window; 10% penalty on traditional withdrawals.' },
  [Phase.RULE_OF_55]: { label: 'Rule of 55', description: 'Penalty-free access to separation-year 401(k).' },
  [Phase.PENALTY_FREE]: { label: 'Penalty-free', description: 'Fully penalty-free; the prime conversion window.' },
  [Phase.MEDICARE_ERA]: { label: 'Medicare era', description: 'IRMAA cliffs dominate; last runway before RMDs.' },
  [Phase.RMD_ERA]: { label: 'RMD era', description: 'RMDs are mandatory; income floor is forced.' },
};

const TEMPLATE_LEVELS: readonly PhaseTemplate[] = ['conservative', 'moderate', 'aggressive'];

const TEMPLATE_TOOLTIPS: Record<PhaseTemplate, string> = {
  conservative: 'Convert only up to the top of the current ordinary income bracket.',
  moderate: 'Convert up to the next IRMAA tier boundary.',
  aggressive: 'Convert up to the top of the 24% bracket or the next IRMAA tier — whichever is lower.',
};

const SS_CLAIM_AGE_MIN = 62;
const SS_CLAIM_AGE_MAX = 70;

export function StrategyPanel({ assumptions, strategy, onChange }: StrategyPanelProps) {
  const [mode, setMode] = useState<'phase' | 'manual'>('phase');
  const phaseTemplates = strategy.phaseTemplates ?? {};

  const setTemplate = (phase: Phase, level: PhaseTemplate) => {
    onChange({ ...strategy, phaseTemplates: { ...phaseTemplates, [phase]: level } });
  };

  const setSsClaimAge = (age: number) => onChange({ ...strategy, ssClaimAge: age });

  const monthlyBenefit =
    assumptions.ssMonthlyBenefitAtFRA * ssBenefitMultiplier(strategy.ssClaimAge);

  return (
    <fieldset className="flex flex-col gap-3 rounded border border-border bg-surface p-3">
      <legend className="px-1 text-sm font-medium text-text">Strategy</legend>

      <div className="flex gap-2 text-sm">
        <button
          type="button"
          aria-pressed={mode === 'phase'}
          className={`flex-1 rounded border border-border px-2 py-1 ${mode === 'phase' ? 'bg-accent text-bg' : 'bg-bg text-text-muted'}`}
          onClick={() => setMode('phase')}
        >
          Phase templates
        </button>
        <button
          type="button"
          aria-pressed={mode === 'manual'}
          className={`flex-1 rounded border border-border px-2 py-1 ${mode === 'manual' ? 'bg-accent text-bg' : 'bg-bg text-text-muted'}`}
          onClick={() => setMode('manual')}
        >
          Manual
        </button>
      </div>

      {mode === 'manual' ? (
        <p className="text-sm text-text-muted">
          Manual per-year editing and JSON import/export are coming soon.
        </p>
      ) : (
        <>
          {PHASE_ORDER.map((phase) => {
            const selected = phaseTemplates[phase] ?? 'moderate';
            return (
              <div key={phase} className="flex flex-col gap-1">
                <div className="text-sm text-text">{PHASE_INFO[phase].label}</div>
                <div className="text-xs text-text-muted">{PHASE_INFO[phase].description}</div>
                <div role="group" aria-label={`${PHASE_INFO[phase].label} intensity`} className="flex gap-1">
                  {TEMPLATE_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      title={TEMPLATE_TOOLTIPS[level]}
                      aria-pressed={selected === level}
                      onClick={() => setTemplate(phase, level)}
                      className={`flex-1 rounded border border-border px-2 py-1 font-mono text-xs capitalize ${
                        selected === level ? 'bg-accent text-bg' : 'bg-bg text-text-muted'
                      }`}
                    >
                      {level}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          <label className="flex flex-col gap-1 text-sm text-text-muted">
            <span>
              SS claim age: <span className="font-mono text-text">{strategy.ssClaimAge}</span>{' '}
              (~<span className="font-mono text-text">${Math.round(monthlyBenefit).toLocaleString()}</span>/mo)
              <InfoTip text="Age at which you start Social Security. Claiming at 62 gives the smallest benefit; delaying to 70 gives the largest (roughly 8% more per year). Later claiming also shrinks the conversion window before IRMAA kicks in." />
            </span>
            <input
              type="range"
              min={SS_CLAIM_AGE_MIN}
              max={SS_CLAIM_AGE_MAX}
              step={1}
              value={strategy.ssClaimAge}
              onChange={(event) => setSsClaimAge(Number(event.target.value))}
            />
          </label>
        </>
      )}
    </fieldset>
  );
}
