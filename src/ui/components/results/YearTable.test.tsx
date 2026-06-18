import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { YearTable } from './YearTable.tsx';
import type { YearRecord } from '../../../engine/types.ts';

function makeRecord(overrides: Partial<YearRecord>): YearRecord {
  return {
    age: 52,
    year: 2026,
    rmd: 0,
    conversionAmount: 0,
    ordinaryIncome: 0,
    magi: 0,
    federalIncomeTax: 0,
    stateTax: 0,
    niit: 0,
    irmaa: 0,
    irmaaAttributed: 0,
    penalty: 0,
    waCapGainsTax: 0,
    yearCost: 0,
    traditionalBalance: 1_000_000,
    rothBalance: 200_000,
    taxableBalance: 400_000,
    ...overrides,
  };
}

describe('YearTable', () => {
  it('renders one row per trace entry', () => {
    const trace: YearRecord[] = [
      makeRecord({ age: 52, year: 2026 }),
      makeRecord({ age: 53, year: 2027 }),
      makeRecord({ age: 54, year: 2028 }),
    ];

    render(<YearTable trace={trace} birthYear={1974} />);

    // header row + 3 data rows
    expect(screen.getAllByRole('row')).toHaveLength(4);
  });

  it('marks rows where IRMAA > 0 with an aria-label', () => {
    const trace: YearRecord[] = [
      makeRecord({ age: 65, year: 2039, irmaa: 0 }),
      makeRecord({ age: 66, year: 2040, irmaa: 850 }),
    ];

    render(<YearTable trace={trace} birthYear={1974} />);

    expect(screen.getByLabelText('IRMAA year')).toBeInTheDocument();
  });
});
