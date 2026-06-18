/**
 * Federal income tax brackets and LTCG rate lookups.
 * Base year: 2026. Bracket edges inflated annually at CPI_RATE.
 */

/** Filing status type used across all table lookups. */
export type FilingStatus = 'single' | 'mfj';

const CPI_RATE = 0.025;

/** 2026 ordinary income bracket edges (lower bound of each band) and rates. */
const ORDINARY_BRACKETS_2026: Record<FilingStatus, Array<{ min: number; rate: number }>> = {
  single: [
    { min: 0, rate: 0.10 },
    { min: 11_925, rate: 0.12 },
    { min: 48_475, rate: 0.22 },
    { min: 103_350, rate: 0.24 },
    { min: 197_300, rate: 0.32 },
    { min: 250_525, rate: 0.35 },
    { min: 626_350, rate: 0.37 },
  ],
  mfj: [
    { min: 0, rate: 0.10 },
    { min: 23_850, rate: 0.12 },
    { min: 96_950, rate: 0.22 },
    { min: 206_700, rate: 0.24 },
    { min: 394_600, rate: 0.32 },
    { min: 501_050, rate: 0.35 },
    { min: 751_600, rate: 0.37 },
  ],
};

/** 2026 LTCG bracket edges (lower bound where each rate begins). */
const LTCG_BRACKETS_2026: Record<FilingStatus, Array<{ min: number; rate: number }>> = {
  single: [
    { min: 0, rate: 0.00 },
    { min: 48_350, rate: 0.15 },
    { min: 533_400, rate: 0.20 },
  ],
  mfj: [
    { min: 0, rate: 0.00 },
    { min: 96_700, rate: 0.15 },
    { min: 600_050, rate: 0.20 },
  ],
};

/** 2026 standard deduction base amounts. */
const STANDARD_DEDUCTION_2026: Record<FilingStatus, number> = {
  single: 15_000,
  mfj: 30_000,
};

/** Additional standard deduction per qualifying person over 65 (2026). */
const OVER_65_ADDITIONAL_2026: Record<FilingStatus, number> = {
  single: 2_000,
  mfj: 1_600, // per spouse; caller must pass correct age for each spouse
};

/** Inflates a 2026 dollar amount to the given year using CPI_RATE. */
function inflate(amount2026: number, year: number): number {
  return amount2026 * Math.pow(1 + CPI_RATE, year - 2026);
}

/** Projects 2026 bracket table to the given year by inflating all edges. */
function projectBrackets(
  brackets2026: Array<{ min: number; rate: number }>,
  year: number,
): Array<{ min: number; rate: number }> {
  return brackets2026.map((b) => ({ min: inflate(b.min, year), rate: b.rate }));
}

/**
 * Returns the projected ordinary income bracket edges (lower bound of each band)
 * and rates for the given year and filing status. Used by the optimizer to find
 * "headroom" to the top of the current bracket.
 * @example
 * ordinaryBracketEdges(2026, 'single')[2] // { min: 48_475, rate: 0.22 }
 */
export function ordinaryBracketEdges(
  year: number,
  filingStatus: FilingStatus,
): readonly { readonly min: number; readonly rate: number }[] {
  return projectBrackets(ORDINARY_BRACKETS_2026[filingStatus], year);
}

/**
 * Returns the projected LTCG bracket edges (lower bound of each rate band)
 * for the given year and filing status. Used by the optimizer to find the
 * "headroom" to the top of the 0% LTCG zone.
 * @example
 * ltcgBracketEdges(2026, 'mfj')[1] // { min: 96_700, rate: 0.15 }
 */
export function ltcgBracketEdges(
  year: number,
  filingStatus: FilingStatus,
): readonly { readonly min: number; readonly rate: number }[] {
  return projectBrackets(LTCG_BRACKETS_2026[filingStatus], year);
}

/**
 * Returns the federal ordinary income tax owed on `taxableIncome`
 * for the given year and filing status.
 * Applies graduated brackets — only the income within each band is taxed at that rate.
 * @example
 * federalOrdinaryTax(50_000, 2026, 'single') // ~$5,990 using 2026 brackets
 */
export function federalOrdinaryTax(
  taxableIncome: number,
  year: number,
  filingStatus: FilingStatus,
): number {
  if (taxableIncome <= 0) return 0;
  const brackets = projectBrackets(ORDINARY_BRACKETS_2026[filingStatus], year);
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const bandBottom = brackets[i].min;
    const bandTop = i + 1 < brackets.length ? brackets[i + 1].min : Infinity;
    const taxable = Math.min(taxableIncome, bandTop) - bandBottom;
    if (taxable <= 0) break;
    tax += taxable * brackets[i].rate;
  }
  return tax;
}

/**
 * Returns the federal long-term capital gains tax on `ltcg`,
 * stacked on top of `ordinaryIncomeBelowLtcg` to determine the applicable rate (0/15/20%).
 * The rate depends on where (ordinary + ltcg) lands, NOT on ltcg alone.
 * @example
 * federalLtcgTax(20_000, 40_000, 2026, 'mfj') // $0 — still in the 0% zone
 * federalLtcgTax(20_000, 90_000, 2026, 'mfj') // $3,000 — 15% applies
 */
export function federalLtcgTax(
  ltcg: number,
  ordinaryIncomeBelowLtcg: number,
  year: number,
  filingStatus: FilingStatus,
): number {
  if (ltcg <= 0) return 0;
  const brackets = projectBrackets(LTCG_BRACKETS_2026[filingStatus], year);
  const stackedBottom = ordinaryIncomeBelowLtcg;
  const stackedTop = ordinaryIncomeBelowLtcg + ltcg;
  let tax = 0;
  for (let i = 0; i < brackets.length; i++) {
    const bandBottom = brackets[i].min;
    const bandTop = i + 1 < brackets.length ? brackets[i + 1].min : Infinity;
    // Portion of LTCG that falls within this band
    const overlapBottom = Math.max(stackedBottom, bandBottom);
    const overlapTop = Math.min(stackedTop, bandTop);
    const taxable = overlapTop - overlapBottom;
    if (taxable > 0) {
      tax += taxable * brackets[i].rate;
    }
  }
  return tax;
}

/**
 * Returns the standard deduction for the given year, filing status, and age.
 * Adds the over-65 additional deduction if age >= 65.
 * For MFJ, assumes both spouses are the same age (caller should pass the older spouse's age
 * and this function adds the per-spouse add-on for each spouse over 65).
 */
export function standardDeduction(year: number, filingStatus: FilingStatus, age: number): number {
  const base = inflate(STANDARD_DEDUCTION_2026[filingStatus], year);
  const addOn = inflate(OVER_65_ADDITIONAL_2026[filingStatus], year);
  // For MFJ, the add-on is per qualifying spouse; assume both spouses qualify if age >= 65
  const over65Count = age >= 65 ? (filingStatus === 'mfj' ? 2 : 1) : 0;
  return base + addOn * over65Count;
}
