/**
 * Collects every field of `Assumptions`, grouped into labeled sections.
 * Performs lightweight client-side validation (non-blocking — invalid
 * values still propagate via onChange so the engine can be inspected,
 * but an inline warning is shown).
 */

import type { ChangeEvent, ReactNode } from 'react';
import type { Assumptions, FilingStatus } from '../../../engine/types.ts';

interface AssumptionsPanelProps {
  readonly assumptions: Assumptions;
  readonly onChange: (next: Assumptions) => void;
}

/** A single labeled numeric input rendered in DM Mono. */
interface NumberFieldProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  error?: string;
  isCurrency?: boolean;
}

/** A single labeled numeric input rendered in DM Mono. */
function NumberField(props: NumberFieldProps) {
  const { label, value, onChange, min, step, error, isCurrency } = props;

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (isCurrency) {
      const sanitized = event.target.value.replace(/[^0-9.-]/g, '');
      const num = parseFloat(sanitized);
      if (!isNaN(num)) {
        onChange(num);
      }
    } else {
      onChange(Number(event.target.value));
    }
  };

  const displayValue = isCurrency 
    ? value.toLocaleString('en-US', { maximumFractionDigits: 2 }) 
    : value;

  return (
    <label className="flex flex-col gap-1 text-sm text-text-muted">
      {label}
      <input
        type={isCurrency ? 'text' : 'number'}
        className="rounded border border-border bg-bg px-2 py-1 font-mono text-sm text-text focus:border-accent focus:outline-none"
        value={isCurrency ? (value === 0 ? '' : displayValue) : value}
        min={min}
        step={step ?? 1}
        onChange={handleChange}
      />
      {error && <span className="text-xs text-warning">{error}</span>}
    </label>
  );
}

/** A collapsible-looking section wrapper with a heading. */
function Section(props: { title: string; children: ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3 rounded border border-border bg-surface p-3">
      <legend className="px-1 text-sm font-medium text-text">{props.title}</legend>
      {props.children}
    </fieldset>
  );
}

const MAX_SENSIBLE_AGE = 120;

export function AssumptionsPanel({ assumptions, onChange }: AssumptionsPanelProps) {
  const update = <K extends keyof Assumptions>(key: K, value: Assumptions[K]) => {
    onChange({ ...assumptions, [key]: value });
  };

  const ageError =
    assumptions.currentAge < 0 || assumptions.currentAge > MAX_SENSIBLE_AGE
      ? 'Age should be between 0 and 120'
      : undefined;
  const horizonError =
    assumptions.horizonAge <= assumptions.currentAge ? 'Horizon must be after current age' : undefined;
  const traditionalError = assumptions.traditional < 0 ? 'Balance cannot be negative' : undefined;
  const rothError = assumptions.roth < 0 ? 'Balance cannot be negative' : undefined;
  const taxableValueError = assumptions.taxable.value < 0 ? 'Balance cannot be negative' : undefined;
  const taxableBasisError = assumptions.taxable.basis < 0 ? 'Basis cannot be negative' : undefined;

  return (
    <div className="flex flex-col gap-3">
      <Section title="You">
        <NumberField label="Birth year" value={assumptions.birthYear} onChange={(v) => update('birthYear', v)} />
        <NumberField
          label="Current age"
          value={assumptions.currentAge}
          onChange={(v) => update('currentAge', v)}
          error={ageError}
        />
        <label className="flex flex-col gap-1 text-sm text-text-muted">
          Filing status
          <select
            className="rounded border border-border bg-bg px-2 py-1 text-sm text-text focus:border-accent focus:outline-none"
            value={assumptions.filingStatus}
            onChange={(event) => update('filingStatus', event.target.value as FilingStatus)}
          >
            <option value="single">Single</option>
            <option value="mfj">Married filing jointly</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm text-text-muted">
          State
          <input
            type="text"
            className="rounded border border-border bg-bg px-2 py-1 font-mono text-sm text-text focus:border-accent focus:outline-none"
            value={assumptions.state}
            onChange={(event) => update('state', event.target.value)}
          />
        </label>
      </Section>

      <Section title="Accounts">
        <NumberField
          label="Traditional balance"
          value={assumptions.traditional}
          onChange={(v) => update('traditional', v)}
          min={0}
          step={1000}
          error={traditionalError}
          isCurrency
        />
        <NumberField
          label="Roth balance"
          value={assumptions.roth}
          onChange={(v) => update('roth', v)}
          min={0}
          step={1000}
          error={rothError}
          isCurrency
        />
        <NumberField
          label="Taxable value"
          value={assumptions.taxable.value}
          onChange={(v) => update('taxable', { ...assumptions.taxable, value: v })}
          min={0}
          step={1000}
          error={taxableValueError}
          isCurrency
        />
        <NumberField
          label="Taxable cost basis"
          value={assumptions.taxable.basis}
          onChange={(v) => update('taxable', { ...assumptions.taxable, basis: v })}
          min={0}
          step={1000}
          error={taxableBasisError}
          isCurrency
        />
      </Section>

      <Section title="Spending">
        <NumberField
          label="Annual spending"
          value={assumptions.annualSpending}
          onChange={(v) => update('annualSpending', v)}
          min={0}
          step={1000}
          isCurrency
        />
        <NumberField
          label="Est. monthly SS benefit at FRA"
          value={assumptions.ssMonthlyBenefitAtFRA}
          onChange={(v) => update('ssMonthlyBenefitAtFRA', v)}
          min={0}
          step={50}
          isCurrency
        />
        <NumberField
          label="Expected annual return"
          value={assumptions.expectedReturn}
          onChange={(v) => update('expectedReturn', v)}
          step={0.005}
        />
      </Section>

      <Section title="Estate">
        <NumberField
          label="Horizon age"
          value={assumptions.horizonAge}
          onChange={(v) => update('horizonAge', v)}
          error={horizonError}
        />
        <NumberField
          label="Heir marginal rate"
          value={assumptions.heirMarginalRate}
          onChange={(v) => update('heirMarginalRate', v)}
          step={0.01}
        />
        <NumberField
          label="Discount rate"
          value={assumptions.discountRate}
          onChange={(v) => update('discountRate', v)}
          step={0.005}
        />
      </Section>
    </div>
  );
}
