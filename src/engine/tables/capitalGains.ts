/**
 * Washington State capital gains tax on long-term gains in the taxable brokerage account.
 * Applies ONLY to stock/bond/mutual fund sales — NOT to Roth conversions, RMDs, or
 * traditional withdrawals (those are income events, exempt from WA cap gains tax).
 * Base year: 2026. Annual exemption is inflation-adjusted.
 */

const CPI_RATE = 0.025;

/** Annual WA capital gains exemption (2026 base, inflation-adjusted). */
const WA_CG_EXEMPTION_2026 = 262_000;

/** Rate on gains between the exemption and $1M above exemption. */
const WA_CG_RATE_LOWER = 0.07;

/** Rate on gains exceeding $1M above the exemption. */
const WA_CG_RATE_UPPER = 0.099;

/** The gain threshold at which the upper rate kicks in (above the exemption). */
const WA_CG_UPPER_THRESHOLD = 1_000_000;

function inflate(amount2026: number, year: number): number {
  return amount2026 * Math.pow(1 + CPI_RATE, year - 2026);
}

/**
 * Washington State capital gains tax on long-term gains realized in the taxable account.
 * Annual exemption: ~$262k (inflation-adjusted). Rate: 7% up to $1M gain; 9.9% above $1M.
 * Returns 0 if realizedLtcg <= annualExemption.
 * @example
 * waCapitalGainsTax(100_000, 2026)   // 0 — below exemption
 * waCapitalGainsTax(500_000, 2026)   // ~$16,660 — 7% on (500k - 262k)
 * waCapitalGainsTax(1_500_000, 2026) // ~$101,640 — 7% up to $1M, 9.9% above
 */
export function waCapitalGainsTax(realizedLtcg: number, year: number): number {
  const exemption = inflate(WA_CG_EXEMPTION_2026, year);
  const taxableGain = realizedLtcg - exemption;
  if (taxableGain <= 0) return 0;

  const lowerBandGain = Math.min(taxableGain, WA_CG_UPPER_THRESHOLD);
  const upperBandGain = Math.max(0, taxableGain - WA_CG_UPPER_THRESHOLD);

  return lowerBandGain * WA_CG_RATE_LOWER + upperBandGain * WA_CG_RATE_UPPER;
}
