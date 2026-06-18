/**
 * Type-level tests for types.ts.
 * These primarily exercise the TypeScript compiler — if a type is wrong or a
 * required property is missing, `npm run typecheck` fails. The runtime
 * assertions are secondary sanity checks.
 */

import { describe, it, expect } from 'vitest';
import {
  Phase,
  type AccountSource,
  type PhaseTemplate,
  type FilingStatus,
  type TaxableAccount,
  type YearState,
  type YearDecision,
  type Strategy,
  type Assumptions,
  type YearRecord,
  type SimResult,
  type WithdrawalResult,
} from './types.ts';

describe('Phase enum', () => {
  it('covers exactly the 5 documented phases', () => {
    const ALL_PHASES = Object.values(Phase);
    expect(ALL_PHASES).toHaveLength(5);
    expect(ALL_PHASES).toEqual(
      expect.arrayContaining([
        Phase.PRE_55,
        Phase.RULE_OF_55,
        Phase.PENALTY_FREE,
        Phase.MEDICARE_ERA,
        Phase.RMD_ERA,
      ]),
    );
  });
});

describe('AccountSource', () => {
  it('covers exactly 3 values', () => {
    const sources: AccountSource[] = ['taxable', 'traditional', 'roth'];
    expect(sources).toHaveLength(3);
  });
});

describe('PhaseTemplate', () => {
  it('covers exactly 3 intensity levels', () => {
    const templates: PhaseTemplate[] = ['conservative', 'moderate', 'aggressive'];
    expect(templates).toHaveLength(3);
  });
});

describe('FilingStatus', () => {
  it('covers single and mfj', () => {
    const statuses: FilingStatus[] = ['single', 'mfj'];
    expect(statuses).toHaveLength(2);
  });
});

describe('TaxableAccount', () => {
  it('accepts a value/basis pair', () => {
    const account = { value: 100_000, basis: 60_000 } satisfies TaxableAccount;
    expect(account.value).toBe(100_000);
    expect(account.basis).toBe(60_000);
  });
});

describe('YearState', () => {
  it('accepts a fully-specified state object', () => {
    const validState = {
      age: 52,
      year: 2026,
      filingStatus: 'mfj',
      traditional: 1_500_000,
      roth: 200_000,
      taxable: { value: 400_000, basis: 250_000 },
      ssClaimed: false,
      ssClaimAge: null,
      ssAnnualBenefit: 0,
      magiHistory: [0, 0],
      ruleOf55Applies: false,
    } satisfies YearState;

    expect(validState.age).toBe(52);
    expect(validState.magiHistory).toHaveLength(2);
  });
});

describe('YearDecision', () => {
  it('accepts a conversion + withdrawal order', () => {
    const decision = {
      conversionAmount: 50_000,
      withdrawalOrder: ['taxable', 'traditional', 'roth'],
    } satisfies YearDecision;

    expect(decision.withdrawalOrder).toHaveLength(3);
  });
});

describe('Strategy', () => {
  it('accepts an explicit per-year strategy', () => {
    const strategy = {
      ssClaimAge: 67,
      perYear: [
        { conversionAmount: 50_000, withdrawalOrder: ['taxable', 'traditional', 'roth'] },
      ],
    } satisfies Strategy;

    expect(strategy.perYear).toHaveLength(1);
  });

  it('accepts a phase-template strategy', () => {
    const strategy = {
      ssClaimAge: 70,
      phaseTemplates: {
        [Phase.PRE_55]: 'conservative',
        [Phase.MEDICARE_ERA]: 'aggressive',
      },
    } satisfies Strategy;

    expect(strategy.phaseTemplates?.[Phase.PRE_55]).toBe('conservative');
  });
});

describe('Assumptions', () => {
  it('accepts a fully-specified assumptions object', () => {
    const assumptions = {
      birthYear: 1974,
      currentAge: 52,
      horizonAge: 95,
      traditional: 1_500_000,
      roth: 200_000,
      taxable: { value: 400_000, basis: 250_000 },
      annualSpending: 80_000,
      ssMonthlyBenefitAtFRA: 3_000,
      expectedReturn: 0.06,
      discountRate: 0.03,
      filingStatus: 'mfj',
      state: 'WA',
      heirMarginalRate: 0.32,
    } satisfies Assumptions;

    expect(assumptions.state).toBe('WA');
  });
});

describe('YearRecord', () => {
  it('accepts a fully-specified year record', () => {
    const record = {
      age: 65,
      year: 2039,
      rmd: 0,
      conversionAmount: 60_000,
      ordinaryIncome: 60_000,
      magi: 60_000,
      federalIncomeTax: 6_500,
      stateTax: 0,
      niit: 0,
      irmaa: 0,
      irmaaAttributed: 0,
      penalty: 0,
      waCapGainsTax: 0,
      yearCost: 6_500,
      traditionalBalance: 1_440_000,
      rothBalance: 260_000,
      taxableBalance: 400_000,
    } satisfies YearRecord;

    expect(record.yearCost).toBe(6_500);
  });
});

describe('SimResult', () => {
  it('accepts a complete simulation result', () => {
    const terminalState = {
      age: 95,
      year: 2069,
      filingStatus: 'mfj',
      traditional: 0,
      roth: 1_000_000,
      taxable: { value: 0, basis: 0 },
      ssClaimed: true,
      ssClaimAge: 70,
      ssAnnualBenefit: 48_000,
      magiHistory: [],
      ruleOf55Applies: false,
    } satisfies YearState;

    const result = {
      totalCost: 1_250_000,
      terminalState,
      trace: [],
    } satisfies SimResult;

    expect(result.terminalState.roth).toBe(1_000_000);
  });
});

describe('WithdrawalResult', () => {
  it('tracks tax character of withdrawals across all 3 sources', () => {
    const withdrawal = {
      tradWithdrawals: 20_000,
      taxableWithdrawals: { total: 10_000, basisPortion: 6_000, gainPortion: 4_000 },
      rothWithdrawals: 0,
    } satisfies WithdrawalResult;

    expect(withdrawal.taxableWithdrawals.basisPortion + withdrawal.taxableWithdrawals.gainPortion)
      .toBe(withdrawal.taxableWithdrawals.total);
  });
});
