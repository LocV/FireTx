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

/** A single labeled numeric input rendered in DM Mono. */
interface NumberFieldProps {
  label: string;
  tip: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
  error?: string;
  isCurrency?: boolean;
}

/** A single labeled numeric input rendered in DM Mono. */
function NumberField(props: NumberFieldProps) {
  const { label, tip, value, onChange, min, step, error, isCurrency } = props;

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
      <span>{label}<InfoTip text={tip} /></span>
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
        <NumberField
          label="Birth year"
          tip="Your year of birth. Used to calculate your age in each simulation year and determine Social Security eligibility."
          value={assumptions.birthYear}
          onChange={(v) => update('birthYear', v)}
        />
        <NumberField
          label="Current age"
          tip="Your age today. The simulation starts here and runs forward to the horizon age."
          value={assumptions.currentAge}
          onChange={(v) => update('currentAge', v)}
          error={ageError}
        />
        <label className="flex flex-col gap-1 text-sm text-text-muted">
          <span>Filing status<InfoTip text="Single or Married Filing Jointly. Affects tax bracket widths, IRMAA tiers, and the standard deduction." /></span>
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
          <span>State<InfoTip text="Two-letter state code (e.g. WA). Currently affects Washington State capital gains tax (7–9.9%) and estate tax calculations." /></span>
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
          tip="Current pre-tax 401(k) / IRA balance. Withdrawals and Roth conversions from this account are taxed as ordinary income."
          value={assumptions.traditional}
          onChange={(v) => update('traditional', v)}
          min={0}
          step={1000}
          error={traditionalError}
          isCurrency
        />
        <NumberField
          label="Roth balance"
          tip="Current after-tax Roth IRA / Roth 401(k) balance. Qualified withdrawals are tax-free and not counted as MAGI."
          value={assumptions.roth}
          onChange={(v) => update('roth', v)}
          min={0}
          step={1000}
          error={rothError}
          isCurrency
        />
        <NumberField
          label="Taxable value"
          tip="Current market value of your taxable brokerage account. Gains above cost basis are subject to long-term capital gains tax and NIIT."
          value={assumptions.taxable.value}
          onChange={(v) => update('taxable', { ...assumptions.taxable, value: v })}
          min={0}
          step={1000}
          error={taxableValueError}
          isCurrency
        />
        <NumberField
          label="Taxable cost basis"
          tip="Your original purchase cost in the taxable account. Only the amount above this basis is taxable when shares are sold."
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
          tip="How much you spend per year in today's dollars. The simulator draws from your accounts each year to cover spending after SS income."
          value={assumptions.annualSpending}
          onChange={(v) => update('annualSpending', v)}
          min={0}
          step={1000}
          isCurrency
        />
        <NumberField
          label="Est. monthly SS benefit at FRA"
          tip="Your estimated Social Security benefit at Full Retirement Age (FRA), per the SSA statement. Claiming earlier reduces it; delaying to 70 increases it."
          value={assumptions.ssMonthlyBenefitAtFRA}
          onChange={(v) => update('ssMonthlyBenefitAtFRA', v)}
          min={0}
          step={50}
          isCurrency
        />
        <NumberField
          label="Expected annual return"
          tip="Assumed pre-tax nominal annual return on all accounts (e.g. 0.06 = 6%). Used to grow balances forward each year."
          value={assumptions.expectedReturn}
          onChange={(v) => update('expectedReturn', v)}
          step={0.005}
        />
      </Section>

      <Section title="Estate">
        <NumberField
          label="Horizon age"
          tip="The age at which the simulation ends. Remaining balances are taxed as if inherited at your heir's marginal rate. Set to your life expectancy or beyond."
          value={assumptions.horizonAge}
          onChange={(v) => update('horizonAge', v)}
          error={horizonError}
        />
        <NumberField
          label="Heir marginal rate"
          tip="The income tax rate your heirs will pay on inherited pre-tax balances (e.g. 0.32 = 32%). Used to compute the after-estate cost of any remaining traditional balance."
          value={assumptions.heirMarginalRate}
          onChange={(v) => update('heirMarginalRate', v)}
          step={0.01}
        />
        <NumberField
          label="Discount rate"
          tip="Annual rate used to discount future taxes to today's dollars (e.g. 0.02 = 2%). Set to 0 to compare raw undiscounted lifetime tax totals."
          value={assumptions.discountRate}
          onChange={(v) => update('discountRate', v)}
          step={0.005}
        />
      </Section>
    </div>
  );
}
