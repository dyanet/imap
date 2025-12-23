import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts', 'tests/**/*.property.ts'],
    // Exclude problematic test file that causes memory issues on Windows
    exclude: ['tests/unit/rfc3501-protocol.test.ts', 'tests/unit/condstore-qresync.test.ts', 'node_modules/**'],
    // Use threads pool with single thread to reduce memory issues
    pool: 'threads',
    poolOptions: {
      threads: {
        // Run all tests in a single thread
        singleThread: true,
        // Isolate test files
        isolate: true,
      }
    },
    // Increase test timeout for property tests
    testTimeout: 30000,
    // Disable file parallelism to reduce memory usage
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
      thresholds: {
        global: {
          // Set thresholds slightly below actual coverage to allow flexibility
          statements: 60,
          branches: 68,
          functions: 73,
          lines: 60
        }
      }
    }
  }
});
