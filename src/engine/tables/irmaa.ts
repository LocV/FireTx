/**
 * IRMAA (Income-Related Monthly Adjustment Amount) Medicare surcharge lookup.
 * IRMAA is a step function — crossing a tier boundary triggers the full tier surcharge.
 * Base year: 2026. Thresholds projected forward by CPI.
 */

import type { FilingStatus } from './brackets.ts';

const CPI_RATE = 0.025;

/**
 * 2026 IRMAA tier thresholds (MAGI from 2 years prior).
 * Each entry is the *lower bound* of the tier — crossing it triggers that surcharge.
 */
const IRMAA_THRESHOLDS_2026: Record<FilingStatus, number[]> = {
  // Tier 1–5 lower bounds; Tier 0 = below first threshold ($0 surcharge)
  single: [106_000, 133_000, 167_000, 200_000, 500_000],
  mfj: [212_000, 266_000, 334_000, 400_000, 750_000],
};

/**
 * Annual per-person IRMAA surcharges (Part B + Part D combined, approximate 2026 values).
 * Index 0 = base (no surcharge); index 1–5 = tiers 1–5.
 */
const IRMAA_SURCHARGES_2026: number[] = [0, 850, 2_000, 3_200, 4_000, 4_800];

function inflate(amount2026: number, year: number): number {
  return amount2026 * Math.pow(1 + CPI_RATE, year - 2026);
}

/**
 * Returns the projected IRMAA tier lower-bound thresholds (MAGI from 2 years prior)
 * for the given year and filing status. Used by the optimizer to find the next
 * tier boundary worth converting up to.
 * @example
 * irmaaTierThresholds(2026, 'single')[0] // 106_000
 */
export function irmaaTierThresholds(year: number, filingStatus: FilingStatus): readonly number[] {
  return IRMAA_THRESHOLDS_2026[filingStatus].map((t) => inflate(t, year));
}

/**
 * Returns the total annual IRMAA surcharge (Part B + Part D combined)
 * for ONE person, given MAGI from two years prior.
 * For MFJ, call this once per spouse.
 *
 * CRITICAL: `magi` must be the MAGI from year (currentYear - 2), not the current year.
 * The caller is responsible for passing the correct lookback value.
 *
 * @example
 * annualIrmaaSurcharge(150_000, 2026, 'single') // ~$2,000 — second tier
 * annualIrmaaSurcharge(211_000, 2026, 'mfj')    // $0 — below first MFJ threshold
 * annualIrmaaSurcharge(213_000, 2026, 'mfj')    // ~$850 — crossed first MFJ tier
 */
export function annualIrmaaSurcharge(
  magi: number,
  year: number,
  filingStatus: FilingStatus,
): number {
  const thresholds = IRMAA_THRESHOLDS_2026[filingStatus].map((t) => inflate(t, year));

  // Find the highest tier the MAGI crosses (step function — last threshold exceeded wins)
  let tier = 0;
  for (let i = 0; i < thresholds.length; i++) {
    if (magi >= thresholds[i]) {
      tier = i + 1;
    }
  }

  // Inflate the surcharge itself by CPI as well
  return inflate(IRMAA_SURCHARGES_2026[tier], year);
}
