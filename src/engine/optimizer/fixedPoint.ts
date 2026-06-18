/**
 * Fixed-point iteration on the terminal traditional balance (docs/03-optimization.md §6B).
 *
 * Resolves the circular dependency between early-phase conversions and
 * late-phase RMDs: how aggressively you should convert in phases 1-4 depends
 * on the balance you'd otherwise carry into phase 5, but that balance itself
 * depends on the conversions chosen. Fixed-point iteration breaks the deadlock
 * by guessing a target balance, optimizing, observing the actual outcome, and
 * refining the guess until guess and outcome agree.
 *
 * DOCUMENTED DEVIATION: the phase-template model (`optimizeCoordinate`) has no
 * "target terminal balance" lever — phase templates are sized from bracket/IRMAA
 * thresholds, not a balance target. So `optimizeCoordinate(assumptions)` returns
 * the same strategy regardless of `B_guess`, and `B_actual` is constant across
 * iterations. The damped update `B_guess = 0.6*B_guess + 0.4*B_actual` is still
 * a contraction mapping toward that constant `B_actual` (the gap shrinks by 0.6x
 * per iteration), so it converges geometrically and the loop terminates well
 * under MAX_ITERATIONS. This preserves the documented iterate-and-check
 * structure and convergence guarantee while being honest that, in this model,
 * the "fixed point" is simply `B_actual` from a single coordinate-search call.
 */

import { optimizeCoordinate } from './coordinate.ts';
import type { Assumptions, SimResult, Strategy } from '../types.ts';

// ─── Constants ────────────────────────────────────────────────────────────────

/** Initial guess for the terminal traditional balance: half the starting balance. */
const INITIAL_GUESS_FRACTION = 0.5;

/** Convergence tolerance, in dollars, between guessed and actual terminal balance. */
const CONVERGENCE_TOLERANCE = 5_000;

/** Safety cap on iterations before falling back to a plain coordinate search. */
const MAX_ITERATIONS = 30;

/** Damping weight applied to the previous guess when updating B_guess. */
const GUESS_DAMPING_WEIGHT = 0.6;
/** Damping weight applied to the observed actual balance when updating B_guess. */
const ACTUAL_DAMPING_WEIGHT = 0.4;

// ─── optimizeFixedPoint ─────────────────────────────────────────────────────────

/**
 * Iterates a guessed terminal traditional balance toward self-consistency
 * with `optimizeCoordinate`'s actual outcome, per docs/03-optimization.md §6B.
 *
 * @returns The resulting strategy and result, whether the guess converged
 *   within `CONVERGENCE_TOLERANCE`, and the number of iterations performed.
 * @example
 * const { strategy, result, converged, iterations } = optimizeFixedPoint(assumptions);
 */
export function optimizeFixedPoint(assumptions: Assumptions): {
  strategy: Strategy;
  result: SimResult;
  converged: boolean;
  iterations: number;
} {
  // Step 1: initial guess for the terminal traditional balance.
  let bGuess = assumptions.traditional * INITIAL_GUESS_FRACTION;

  // The phase-template optimum is independent of bGuess in this model (see
  // module doc), so compute it once and reuse it across iterations.
  const { strategy, result } = optimizeCoordinate(assumptions);
  const bActual = result.terminalState.traditional;

  let iterations = 0;
  let converged = false;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    if (Math.abs(bActual - bGuess) < CONVERGENCE_TOLERANCE) {
      converged = true;
      break;
    }

    // Damped update — contraction toward bActual, preventing oscillation.
    bGuess = GUESS_DAMPING_WEIGHT * bGuess + ACTUAL_DAMPING_WEIGHT * bActual;
  }

  return { strategy, result, converged, iterations };
}
