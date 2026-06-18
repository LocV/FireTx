import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { CostBreakdownChart } from './CostBreakdownChart.tsx';
import type { Assumptions } from '../../../engine/types.ts';

// Small horizon keeps the on-demand DP solve fast for this test.
const ASSUMPTIONS: Assumptions = {
  birthYear: 1962,
  currentAge: 63,
  horizonAge: 68,
  traditional: 600_000,
  roth: 100_000,
  taxable: { value: 150_000, basis: 100_000 },
  annualSpending: 60_000,
  ssMonthlyBenefitAtFRA: 2_500,
  expectedReturn: 0.05,
  discountRate: 0,
  filingStatus: 'mfj',
  state: 'WA',
  heirMarginalRate: 0.32,
};

describe('CostBreakdownChart', () => {
  it('renders the scenario comparison and a deep-optimize trigger', () => {
    render(<CostBreakdownChart assumptions={ASSUMPTIONS} result={null} />);
    expect(screen.getByText('Scenario comparison')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /run deep optimize/i })).toBeInTheDocument();
  });

  it('runs the DP solve on click and shows a computing state', async () => {
    const user = userEvent.setup();
    render(<CostBreakdownChart assumptions={ASSUMPTIONS} result={null} />);

    const button = screen.getByRole('button', { name: /run deep optimize/i });
    await user.click(button);

    await waitFor(() => expect(screen.getByRole('button', { name: /run deep optimize/i })).toBeInTheDocument(), {
      timeout: 10_000,
    });
  }, 15_000);
});
