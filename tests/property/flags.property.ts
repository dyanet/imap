/**
 * Property-based tests for flag command construction
 * 
 * Feature: dyanet-imap, Property 7: Flag Command Construction
 * Validates: Requirements 5.1, 5.2, 5.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CommandBuilder, STANDARD_FLAGS } from '../../src/commands/builder.js';

// Arbitrary for message sequence sets
const sequenceArb = fc.oneof(
  fc.integer({ min: 1, max: 99999 }).map(n => n.toString()),
  fc.tuple(
    fc.integer({ min: 1, max: 99999 }),
    fc.integer({ min: 1, max: 99999 })
  ).map(([a, b]) => `${Math.min(a, b)}:${Math.max(a, b)}`),
  fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 5 })
    .map(nums => nums.join(',')),
  fc.constant('1:*')
);

// Arbitrary for standard IMAP flags
const standardFlagArb = fc.constantFrom(
  '\\Seen', '\\Answered', '\\Flagged', '\\Deleted', '\\Draft'
);

// Arbitrary for flag arrays
const flagsArb = fc.array(standardFlagArb, { minLength: 1, maxLength: 5 })
  .map(flags => [...new Set(flags)]); // Remove duplicates

// Arbitrary for action type
const actionArb = fc.constantFrom<'add' | 'remove'>('add', 'remove');

describe('Property 7: Flag Command Construction', () => {
  it('produces syntactically correct STORE command starting with "STORE"', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        actionArb,
        (sequence, flags, action) => {
          const command = CommandBuilder.store(sequence, flags, action);
          expect(command.startsWith('STORE ')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes the message sequence in the command', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        actionArb,
        (sequence, flags, action) => {
          const command = CommandBuilder.store(sequence, flags, action);
          expect(command).toContain(sequence);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses +FLAGS for add action', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        (sequence, flags) => {
          const command = CommandBuilder.store(sequence, flags, 'add');
          expect(command).toContain('+FLAGS');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses -FLAGS for remove action', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        (sequence, flags) => {
          const command = CommandBuilder.store(sequence, flags, 'remove');
          expect(command).toContain('-FLAGS');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes all specified flags in the command', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        actionArb,
        (sequence, flags, action) => {
          const command = CommandBuilder.store(sequence, flags, action);
          for (const flag of flags) {
            expect(command).toContain(flag);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('wraps flags in parentheses', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        flagsArb,
        actionArb,
        (sequence, flags, action) => {
          const command = CommandBuilder.store(sequence, flags, action);
          // Should have format: STORE sequence +/-FLAGS (flags)
          expect(command).toMatch(/FLAGS \(.*\)$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('supports all standard IMAP flags', () => {
    const allStandardFlags = ['\\Seen', '\\Answered', '\\Flagged', '\\Deleted', '\\Draft'];
    
    fc.assert(
      fc.property(
        sequenceArb,
        actionArb,
        (sequence, action) => {
          const command = CommandBuilder.store(sequence, allStandardFlags, action);
          for (const flag of allStandardFlags) {
            expect(command).toContain(flag);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  it('STANDARD_FLAGS constant contains expected flags', () => {
    expect(STANDARD_FLAGS).toContain('\\Seen');
    expect(STANDARD_FLAGS).toContain('\\Answered');
    expect(STANDARD_FLAGS).toContain('\\Flagged');
    expect(STANDARD_FLAGS).toContain('\\Deleted');
    expect(STANDARD_FLAGS).toContain('\\Draft');
    expect(STANDARD_FLAGS).toContain('\\Recent');
  });
});
