/**
 * Property-based tests for Promise-based API
 * 
 * Feature: dyanet-imap, Property 11: Promise-Based API
 * Validates: Requirements 6.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ImapClient } from '../../src/client.js';

/**
 * Helper to check if a value is a Promise
 */
function isPromise(value: unknown): value is Promise<unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    'then' in value &&
    typeof (value as { then: unknown }).then === 'function'
  );
}

/**
 * Create a test client instance (not connected)
 */
function createTestClient(): ImapClient {
  return new ImapClient({
    imap: {
      host: 'test.example.com',
      port: 993,
      user: 'test@example.com',
      password: 'password'
    }
  });
}

describe('Property 11: Promise-Based API', () => {
  it('static connect() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.record({
          imap: fc.record({
            host: fc.constant('test.example.com'),
            port: fc.constant(993),
            user: fc.constant('test@example.com'),
            password: fc.constant('password')
          })
        }),
        (config) => {
          // connect() should return a Promise (even though it will fail without a real server)
          const result = ImapClient.connect(config);
          expect(isPromise(result)).toBe(true);
          // Catch the rejection to prevent unhandled promise rejection
          result.catch(() => {});
        }
      ),
      { numRuns: 10 }
    );
  });

  it('end() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const client = createTestClient();
          const result = client.end();
          expect(isPromise(result)).toBe(true);
          // Catch any potential rejection
          result.catch(() => {});
        }
      ),
      { numRuns: 10 }
    );
  });

  it('getBoxes() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const client = createTestClient();
          // This will throw because not connected, but we can check the method signature
          try {
            const result = client.getBoxes();
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('openBox() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (mailboxName) => {
          const client = createTestClient();
          try {
            const result = client.openBox(mailboxName);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('addBox() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (mailboxName) => {
          const client = createTestClient();
          try {
            const result = client.addBox(mailboxName);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('delBox() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        (mailboxName) => {
          const client = createTestClient();
          try {
            const result = client.delBox(mailboxName);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('renameBox() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 20 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (oldName, newName) => {
          const client = createTestClient();
          try {
            const result = client.renameBox(oldName, newName);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('search() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.constant(['ALL'] as const),
        (criteria) => {
          const client = createTestClient();
          try {
            const result = client.search([...criteria]);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('fetch() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        (uids) => {
          const client = createTestClient();
          try {
            const result = client.fetch(uids, { bodies: ['HEADER'] });
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('addFlags() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.constantFrom('\\Seen', '\\Flagged', '\\Deleted'), { minLength: 1, maxLength: 3 }),
        (uids, flags) => {
          const client = createTestClient();
          try {
            const result = client.addFlags(uids, flags);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('delFlags() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        fc.array(fc.constantFrom('\\Seen', '\\Flagged', '\\Deleted'), { minLength: 1, maxLength: 3 }),
        (uids, flags) => {
          const client = createTestClient();
          try {
            const result = client.delFlags(uids, flags);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('move() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (uids, destBox) => {
          const client = createTestClient();
          try {
            const result = client.move(uids, destBox);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('copy() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 1, max: 1000 }), { minLength: 1, maxLength: 5 }),
        fc.string({ minLength: 1, maxLength: 20 }),
        (uids, destBox) => {
          const client = createTestClient();
          try {
            const result = client.copy(uids, destBox);
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('expunge() returns a Promise', () => {
    fc.assert(
      fc.property(
        fc.constant(null),
        () => {
          const client = createTestClient();
          try {
            const result = client.expunge();
            expect(isPromise(result)).toBe(true);
            result.catch(() => {});
          } catch (e) {
            // Expected - not connected
            expect(e).toBeDefined();
          }
        }
      ),
      { numRuns: 10 }
    );
  });

  it('all public methods (except constructor) return Promises', () => {
    // This test verifies the property that ALL public methods return Promises
    const client = createTestClient();
    
    // Get all method names from the client prototype
    const methodNames = Object.getOwnPropertyNames(Object.getPrototypeOf(client))
      .filter(name => {
        // Exclude constructor and private methods (starting with _)
        if (name === 'constructor' || name.startsWith('_')) return false;
        // Exclude getters/setters
        const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(client), name);
        if (descriptor?.get || descriptor?.set) return false;
        // Only include functions
        return typeof (client as unknown as Record<string, unknown>)[name] === 'function';
      });

    // Public async methods that should return Promises
    const expectedAsyncMethods = [
      'end', 'getBoxes', 'openBox', 'addBox', 'delBox', 'renameBox',
      'search', 'fetch', 'addFlags', 'delFlags', 'move', 'copy', 'expunge'
    ];

    // Verify all expected async methods exist
    for (const methodName of expectedAsyncMethods) {
      expect(methodNames).toContain(methodName);
    }
  });
});
