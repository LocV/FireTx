import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useOptimizer } from './useOptimizer.ts';
import { Phase, type Assumptions, type Strategy } from '../../engine/types.ts';

const ASSUMPTIONS: Assumptions = {
  birthYear: 1974,
  currentAge: 60,
  horizonAge: 65,
  traditional: 1_000_000,
  roth: 200_000,
  taxable: { value: 400_000, basis: 250_000 },
  annualSpending: 60_000,
  ssMonthlyBenefitAtFRA: 3_000,
  expectedReturn: 0.06,
  discountRate: 0,
  filingStatus: 'mfj',
  state: 'WA',
  heirMarginalRate: 0.32,
};

const STRATEGY: Strategy = {
  ssClaimAge: 67,
  phaseTemplates: { [Phase.PENALTY_FREE]: 'moderate' },
};

describe('useOptimizer', () => {
  it('reports isComputing immediately and resolves a SimResult', async () => {
    const { result } = renderHook(() => useOptimizer(ASSUMPTIONS, STRATEGY));

    expect(result.current.isComputing).toBe(true);
    expect(result.current.result).toBeNull();

    await waitFor(() => expect(result.current.isComputing).toBe(false));

    expect(result.current.result).not.toBeNull();
    expect(result.current.result?.trace).toHaveLength(ASSUMPTIONS.horizonAge - ASSUMPTIONS.currentAge);
    expect(result.current.error).toBeNull();
  });

  it('does not recompute when inputs are referentially unchanged', async () => {
    const { result, rerender } = renderHook(() => useOptimizer(ASSUMPTIONS, STRATEGY));

    await waitFor(() => expect(result.current.isComputing).toBe(false));
    const firstResult = result.current.result;

    rerender();

    // Same object references → effect deps unchanged → no new computation triggered.
    expect(result.current.isComputing).toBe(false);
    expect(result.current.result).toBe(firstResult);
  });
});
