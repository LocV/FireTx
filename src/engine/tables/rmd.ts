/**
 * IRS Uniform Lifetime Table factors for Required Minimum Distribution calculations.
 * SECURE 2.0 Act: RMD start age depends on birth year.
 */

/**
 * IRS Uniform Lifetime Table (2022 update, effective from 2022 onward).
 * Keys are ages 72–120; values are the distribution period (divisor).
 */
const UNIFORM_LIFETIME_TABLE: Record<number, number> = {
  72: 27.4, 73: 26.5, 74: 25.5, 75: 24.6, 76: 23.7,
  77: 22.9, 78: 22.0, 79: 21.1, 80: 20.2, 81: 19.4,
  82: 18.5, 83: 17.7, 84: 16.8, 85: 16.0, 86: 15.2,
  87: 14.4, 88: 13.7, 89: 12.9, 90: 12.2, 91: 11.5,
  92: 10.8, 93: 10.1, 94: 9.5, 95: 8.9, 96: 8.4,
  97: 7.8, 98: 7.3, 99: 6.8, 100: 6.4, 101: 6.0,
  102: 5.6, 103: 5.2, 104: 4.9, 105: 4.6, 106: 4.3,
  107: 4.1, 108: 3.9, 109: 3.7, 110: 3.5, 111: 3.4,
  112: 3.3, 113: 3.1, 114: 3.0, 115: 2.9, 116: 2.8,
  117: 2.7, 118: 2.5, 119: 2.3, 120: 2.0,
};

const MIN_TABLE_AGE = Math.min(...Object.keys(UNIFORM_LIFETIME_TABLE).map(Number));
const MAX_TABLE_AGE = Math.max(...Object.keys(UNIFORM_LIFETIME_TABLE).map(Number));

/**
 * Returns the RMD start age for a person born in `birthYear`.
 * SECURE 2.0: born 1960+ → age 75. Born 1951–1959 → age 73. Born ≤1950 → age 72.
 * @example
 * rmdStartAge(1960) // 75
 * rmdStartAge(1955) // 73
 * rmdStartAge(1948) // 72
 */
export function rmdStartAge(birthYear: number): number {
  if (birthYear >= 1960) return 75;
  if (birthYear >= 1951) return 73;
  return 72;
}

/**
 * Returns the IRS Uniform Lifetime Table factor for the given age.
 * RMD = priorYearEndBalance / uniformLifetimeFactor(age)
 * Factor decreases with age (higher % withdrawn each year).
 * Clamps to table bounds for ages outside the published range.
 * @example
 * uniformLifetimeFactor(75) // 24.6
 * uniformLifetimeFactor(80) // 20.2
 * uniformLifetimeFactor(85) // 16.0
 */
export function uniformLifetimeFactor(age: number): number {
  const clampedAge = Math.max(MIN_TABLE_AGE, Math.min(MAX_TABLE_AGE, Math.floor(age)));
  return UNIFORM_LIFETIME_TABLE[clampedAge];
}

/**
 * Returns the required minimum distribution for the given balance and age.
 * Returns 0 if age < rmdStartAge(birthYear).
 * @example
 * computeRmd(1_000_000, 75, 1960) // ~40,650 (1M / 24.6)
 */
export function computeRmd(
  priorYearEndBalance: number,
  age: number,
  birthYear: number,
): number {
  if (age < rmdStartAge(birthYear)) return 0;
  const factor = uniformLifetimeFactor(age);
  return priorYearEndBalance / factor;
}
