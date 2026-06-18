/**
 * Federal and Washington State estate tax schedules.
 * WA estate tax updated per SB 6347 (reverted to pre-2025 graduated rates, ~$3M frozen exemption).
 * Federal: flat 40% above the inflation-indexed exemption.
 */

import type { FilingStatus } from './brackets.ts';

const CPI_RATE = 0.025;

/** Federal estate tax exemption base values (2026, per person). */
const FEDERAL_EXEMPTION_2026_SINGLE = 15_000_000;

/** WA estate tax exemption: ~$3.076M through mid-2026, then frozen at $3M per SB 6347. */
const WA_EXEMPTION_FROZEN = 3_000_000;
const WA_EXEMPTION_PRE_FREEZE_2026 = 3_076_000;
// SB 6347 freezes the WA exemption at ~$3M starting July 2026
const WA_FREEZE_YEAR = 2026;

function inflate(amount2026: number, year: number): number {
  return amount2026 * Math.pow(1 + CPI_RATE, year - 2026);
}

/**
 * WA graduated rate schedule: 10 brackets from 10% to 20%.
 * Applied on the taxable estate *above* the WA exemption.
 * Reverted to pre-2025 rates by SB 6347.
 */
const WA_ESTATE_BRACKETS: Array<{ min: number; rate: number }> = [
  { min: 0, rate: 0.10 },
  { min: 1_000_000, rate: 0.14 },
  { min: 2_000_000, rate: 0.15 },
  { min: 3_000_000, rate: 0.155 },
  { min: 4_000_000, rate: 0.16 },
  { min: 6_000_000, rate: 0.165 },
  { min: 7_000_000, rate: 0.19 },
  { min: 8_000_000, rate: 0.195 },
  { min: 9_000_000, rate: 0.20 },
];

/**
 * Federal estate tax on the taxable estate (after deducting the exemption
 * and the state estate tax paid — see §2058 deduction).
 * Flat 40% rate above the exemption.
 * Caller is responsible for computing taxableEstateAfterDeductions correctly.
 * @example
 * federalEstateTax(0)           // 0
 * federalEstateTax(1_000_000)   // 400_000
 */
export function federalEstateTax(taxableEstateAfterDeductions: number): number {
  const FEDERAL_ESTATE_RATE = 0.40;
  if (taxableEstateAfterDeductions <= 0) return 0;
  return taxableEstateAfterDeductions * FEDERAL_ESTATE_RATE;
}

/**
 * Washington State estate tax on the taxable estate above the WA exemption.
 * NOT portable between spouses — each spouse has their own exemption.
 * Graduated 10–20% rate schedule (reverted to pre-2025 rates by SB 6347).
 * @example
 * waEstateTax(0)           // 0
 * waEstateTax(1_000_000)   // ~$100,000 (10% on first $1M above exemption)
 */
export function waEstateTax(taxableEstateAboveExemption: number): number {
  if (taxableEstateAboveExemption <= 0) return 0;
  let tax = 0;
  for (let i = 0; i < WA_ESTATE_BRACKETS.length; i++) {
    const bandBottom = WA_ESTATE_BRACKETS[i].min;
    const bandTop =
      i + 1 < WA_ESTATE_BRACKETS.length ? WA_ESTATE_BRACKETS[i + 1].min : Infinity;
    const taxable = Math.min(taxableEstateAboveExemption, bandTop) - bandBottom;
    if (taxable <= 0) break;
    tax += taxable * WA_ESTATE_BRACKETS[i].rate;
  }
  return tax;
}

/**
 * Returns the WA estate tax exemption for the given year.
 * Frozen at $3M for years >= 2026 (SB 6347); uses ~$3.076M for earlier years.
 */
export function waEstateExemption(year: number): number {
  return year >= WA_FREEZE_YEAR ? WA_EXEMPTION_FROZEN : WA_EXEMPTION_PRE_FREEZE_2026;
}

/**
 * Returns the federal estate tax exemption for the given year and filing status.
 * MFJ uses the portable combined exemption (2× single).
 * Indexed from the 2026 base by CPI.
 */
export function federalEstateExemption(year: number, filingStatus: FilingStatus): number {
  const singleExemption = inflate(FEDERAL_EXEMPTION_2026_SINGLE, year);
  return filingStatus === 'mfj' ? singleExemption * 2 : singleExemption;
}
