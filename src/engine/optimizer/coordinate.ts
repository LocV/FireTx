/**
 * Phase-template coordinate-search optimizer (docs/03-optimization.md §6A).
 *
 * Cycles through each life phase one at a time, testing all three intensity
 * levels ('conservative' | 'moderate' | 'aggressive') while holding the other
 * phases fixed, and keeps any improvement. Repeats full sweeps until a pass
 * produces no change (a local optimum), then sweeps SS claim ages.
 *
 * Transparent and fast: the returned strategy shows exactly which phase
 * template combination drives the lowest lifetime cost.
 */

import { simulate } from '../simulate.ts';
import { Phase, type Assumptions, type PhaseTemplate, type SimResult, type Strategy } from '../types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** All five life phases, in chronological order. */
const PHASES: readonly Phase[] = [
  Phase.PRE_55,
  Phase.RULE_OF_55,
  Phase.PENALTY_FREE,
  Phase.MEDICARE_ERA,
  Phase.RMD_ERA,
];

/** The three coarse conversion-intensity levels tried for each phase. */
const TEMPLATE_LEVELS: readonly PhaseTemplate[] = ['conservative', 'moderate', 'aggressive'];

/** Default phase-template intensity to start the coordinate search from. */
const DEFAULT_TEMPLATE: PhaseTemplate = 'moderate';

/** SS claim ages swept after the phase-template search converges. */
const MIN_SS_CLAIM_AGE = 62;
const MAX_SS_CLAIM_AGE = 70;

/** SS claim age used while searching phase templates (swept separately afterward). */
const SEARCH_SS_CLAIM_AGE = 67;

/**
 * Safety cap on the number of full coordinate-descent sweeps. Five phases ×
 * three levels converges in 1-3 sweeps in practice; this bounds pathological
 * oscillation.
 */
const MAX_SWEEPS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Builds a strategy with `level` applied to `phase`, all else from `templates`. */
function withPhaseLevel(
  templates: Partial<Record<Phase, PhaseTemplate>>,
  phase: Phase,
  level: PhaseTemplate,
  ssClaimAge: number,
): Strategy {
  return { ssClaimAge, phaseTemplates: { ...templates, [phase]: level } };
}

/**
 * Runs one full coordinate-descent sweep over all phases at a fixed SS claim
 * age, mutating `templates` in place toward lower-cost levels.
 *
 * @returns Whether any phase's level changed during this sweep.
 */
function runSweep(
  templates: Partial<Record<Phase, PhaseTemplate>>,
  bestCost: { value: number },
  ssClaimAge: number,
  assumptions: Assumptions,
): boolean {
  let improved = false;

  for (const phase of PHASES) {
    for (const level of TEMPLATE_LEVELS) {
      if (templates[phase] === level) continue;

      const trial = withPhaseLevel(templates, phase, level, ssClaimAge);
      const trialCost = simulate(trial, assumptions).totalCost;

      if (trialCost < bestCost.value) {
        templates[phase] = level;
        bestCost.value = trialCost;
        improved = true;
      }
    }
  }

  return improved;
}

/**
 * Sweeps SS claim ages 62-70 against a fixed set of phase templates and
 * returns the cheapest (claimAge, result) pair.
 */
function sweepClaimAges(
  templates: Partial<Record<Phase, PhaseTemplate>>,
  assumptions: Assumptions,
): { ssClaimAge: number; result: SimResult } {
  let best: { ssClaimAge: number; result: SimResult } | null = null;

  for (let ssClaimAge = MIN_SS_CLAIM_AGE; ssClaimAge <= MAX_SS_CLAIM_AGE; ssClaimAge++) {
    const result = simulate({ ssClaimAge, phaseTemplates: templates }, assumptions);
    if (best === null || result.totalCost < best.result.totalCost) {
      best = { ssClaimAge, result };
    }
  }

  // MIN_SS_CLAIM_AGE..MAX_SS_CLAIM_AGE always yields at least one candidate.
  return best as { ssClaimAge: number; result: SimResult };
}

// ─── optimizeCoordinate ─────────────────────────────────────────────────────────

/**
 * Optimizes a Strategy by cycling through phases one at a time, testing all
 * three intensity levels, and keeping improvements. Continues until a full
 * sweep produces no improvement (local optimum), then sweeps SS claim ages
 * 62-70 on the resulting templates.
 *
 * NOT guaranteed to find the global optimum (coordinate descent can get stuck
 * in local optima), but it is transparent, fast, and human-readable: the
 * returned `strategy.phaseTemplates` shows exactly which phase is driving
 * the savings.
 *
 * @returns The local-optimum strategy, its simulated result, and the number
 *   of full coordinate-descent sweeps performed before convergence.
 * @example
 * const { strategy, result, iterations } = optimizeCoordinate(assumptions);
 */
export function optimizeCoordinate(assumptions: Assumptions): {
  strategy: Strategy;
  result: SimResult;
  iterations: number;
} {
  // Step 1: start from 'moderate' in every phase.
  const templates: Partial<Record<Phase, PhaseTemplate>> = {};
  for (const phase of PHASES) templates[phase] = DEFAULT_TEMPLATE;

  const bestCost = { value: simulate({ ssClaimAge: SEARCH_SS_CLAIM_AGE, phaseTemplates: templates }, assumptions).totalCost };

  // Steps 2-3: coordinate descent until a full sweep finds no improvement.
  let iterations = 0;
  for (let sweep = 0; sweep < MAX_SWEEPS; sweep++) {
    iterations++;
    const improved = runSweep(templates, bestCost, SEARCH_SS_CLAIM_AGE, assumptions);
    if (!improved) break;
  }

  // Step 4: sweep SS claim ages on the converged templates.
  const { ssClaimAge, result } = sweepClaimAges(templates, assumptions);

  return {
    strategy: { ssClaimAge, phaseTemplates: templates },
    result,
    iterations,
  };
}
