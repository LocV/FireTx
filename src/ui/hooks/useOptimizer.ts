/**
 * Hook that runs the simulation engine for the current assumptions/strategy
 * and returns the latest result, debounced so rapid input changes don't
 * trigger a recompute on every keystroke.
 *
 * SIMPLIFICATION: the spec calls for offloading this to a Web Worker. A full
 * simulation run (~40 years) completes in low single-digit milliseconds, so
 * for now this runs on the main thread behind the same debounce — the public
 * interface (`{ result, isComputing, error }`) is unchanged, so a Worker can
 * be dropped in later without touching any consuming component.
 */

import { useEffect, useState } from 'react';
import { simulate } from '../../engine/simulate.ts';
import type { Assumptions, SimResult, Strategy } from '../../engine/types.ts';

/** Milliseconds to wait after the last input change before recomputing. */
const DEBOUNCE_MS = 300;

/**
 * Debounces assumption/strategy changes and returns the latest SimResult.
 *
 * @example
 * const { result, isComputing, error } = useOptimizer(assumptions, strategy);
 */
export function useOptimizer(
  assumptions: Assumptions,
  strategy: Strategy,
): { result: SimResult | null; isComputing: boolean; error: string | null } {
  const [result, setResult] = useState<SimResult | null>(null);
  const [isComputing, setIsComputing] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsComputing(true);
    const timer = setTimeout(() => {
      try {
        setResult(simulate(strategy, assumptions));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to compute simulation');
      } finally {
        setIsComputing(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [assumptions, strategy]);

  return { result, isComputing, error };
}
