import { describe, it, expect } from 'vitest';
import { rmdStartAge, uniformLifetimeFactor, computeRmd } from './rmd.ts';

describe('rmdStartAge', () => {
  it('born 1960+ → age 75', () => {
    expect(rmdStartAge(1960)).toBe(75);
    expect(rmdStartAge(1970)).toBe(75);
  });

  it('born 1951–1959 → age 73', () => {
    expect(rmdStartAge(1955)).toBe(73);
    expect(rmdStartAge(1951)).toBe(73);
    expect(rmdStartAge(1959)).toBe(73);
  });

  it('born ≤1950 → age 72', () => {
    expect(rmdStartAge(1950)).toBe(72);
    expect(rmdStartAge(1948)).toBe(72);
  });
});

describe('uniformLifetimeFactor', () => {
  it('returns correct factor for age 75', () => {
    expect(uniformLifetimeFactor(75)).toBe(24.6);
  });

  it('returns correct factor for age 80', () => {
    expect(uniformLifetimeFactor(80)).toBe(20.2);
  });

  it('returns correct factor for age 85', () => {
    expect(uniformLifetimeFactor(85)).toBe(16.0);
  });

  it('factor decreases with age', () => {
    expect(uniformLifetimeFactor(75)).toBeGreaterThan(uniformLifetimeFactor(80));
    expect(uniformLifetimeFactor(80)).toBeGreaterThan(uniformLifetimeFactor(90));
  });

  it('clamps for ages above the table', () => {
    expect(uniformLifetimeFactor(200)).toBe(uniformLifetimeFactor(120));
  });
});

describe('computeRmd', () => {
  it('returns ~$40,650 for $1M balance at age 75 (born 1960)', () => {
    expect(computeRmd(1_000_000, 75, 1960)).toBeCloseTo(1_000_000 / 24.6, 1);
  });

  it('returns 0 if age is below RMD start age', () => {
    expect(computeRmd(1_000_000, 74, 1960)).toBe(0);
  });

  it('returns 0 if balance is 0', () => {
    expect(computeRmd(0, 75, 1960)).toBe(0);
  });

  it('returns correct RMD for born-1955 person at age 73', () => {
    expect(computeRmd(500_000, 73, 1955)).toBeCloseTo(500_000 / 26.5, 1);
  });

  it('does not return RMD for born-1955 person at age 72', () => {
    expect(computeRmd(500_000, 72, 1955)).toBe(0);
  });
});
