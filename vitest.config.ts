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
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        global: {
          statements: 61,
          branches: 75,
          functions: 71,
          lines: 61
        }
      }
    }
  }
});
