/**
 * Vitest setup file for UI tests — registers jest-dom matchers
 * (toBeInTheDocument, toHaveClass, etc.) for use with @testing-library/react,
 * and unmounts rendered components between tests.
 */
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

afterEach(() => {
  cleanup();
});
