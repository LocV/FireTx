import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { AssumptionsPanel } from './AssumptionsPanel.tsx';
import type { Assumptions } from '../../../engine/types.ts';

const ASSUMPTIONS: Assumptions = {
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

describe('AssumptionsPanel', () => {
  it('renders all required fields', () => {
    render(<AssumptionsPanel assumptions={ASSUMPTIONS} onChange={vi.fn()} />);

    expect(screen.getByLabelText(/Birth year/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Current age/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Filing status/)).toBeInTheDocument();
    expect(screen.getByLabelText(/^State/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Traditional balance/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Roth balance/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Taxable value/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Taxable cost basis/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Annual spending/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Horizon age/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Heir marginal rate/)).toBeInTheDocument();
    expect(screen.getByLabelText(/Discount rate/)).toBeInTheDocument();
  });

  it('shows a validation error for a negative traditional balance', () => {
    render(<AssumptionsPanel assumptions={{ ...ASSUMPTIONS, traditional: -1 }} onChange={vi.fn()} />);
    expect(screen.getByText(/Balance cannot be negative/)).toBeInTheDocument();
  });

  it('calls onChange with updated Assumptions when a field changes', async () => {
    const onChange = vi.fn();

    function Wrapper() {
      const [assumptions, setAssumptions] = useState(ASSUMPTIONS);
      return (
        <AssumptionsPanel
          assumptions={assumptions}
          onChange={(next) => {
            setAssumptions(next);
            onChange(next);
          }}
        />
      );
    }

    render(<Wrapper />);

    const annualSpending = screen.getByLabelText(/Annual spending/);
    await userEvent.clear(annualSpending);
    await userEvent.type(annualSpending, '90000');

    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)?.[0] as Assumptions;
    expect(lastCall.annualSpending).toBe(90000);
    expect(lastCall.traditional).toBe(ASSUMPTIONS.traditional);
  });
});
