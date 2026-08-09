import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.property.ts'],
    exclude: ['node_modules/**'],
    // Use forks pool for better memory isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        // Run tests in separate processes for memory isolation
        singleFork: true,
        isolate: true,
        // Increase memory limit for worker processes (8GB)
        execArgv: ['--max-old-space-size=8192'],
      }
    },
    // Increase test timeout for property tests
    testTimeout: 60000,
    // Disable file parallelism to reduce memory usage
    fileParallelism: false,
    // Sequence tests to run smaller files first
    sequence: {
      shuffle: false,
    },
    coverage: {
      provider: 'v8',
      // json-summary feeds scripts/coverage-badge.mjs.
      reporter: ['text', 'json', 'json-summary', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      // These go directly under `thresholds`. They used to be nested in a
      // `global: { ... }` object, which Vitest does not treat as a special
      // key -- unrecognised keys here are glob patterns for per-file
      // thresholds, so `global` matched no files and enforced nothing. The
      // gate had been silently inert: the declared floor was 61% lines
      // while actual coverage sat at 53%, and `test:coverage` passed
      // regardless.
      //
      // Set just under the current real numbers so the gate is honest and
      // ratchets against regression. Raise them as coverage improves --
      // the old 61/75/71 were aspirations, not measurements.
      thresholds: {
        statements: 52,
        branches: 49,
        functions: 53,
        lines: 52
      }
    }
  }
});
