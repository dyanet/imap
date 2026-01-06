/**
 * Property-based tests for IMAP protocol parsing
 * 
 * Feature: dyanet-imap, Property 13: IMAP Response Parsing
 * Validates: Requirements 1.1, 1.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  tokenize,
  parseResponse,
  parseTaggedResponse,
  parseUntaggedResponse,
  isTaggedResponse,
  isContinuationResponse,
  getTokenValue,
  isListToken
} from '../../src/protocol/index.js';

/**
 * Generates valid IMAP tags (alphanumeric, typically A001, A002, etc.)
 */
const tagArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'),
  { minLength: 1, maxLength: 10 }
);

/**
 * Generates valid IMAP response statuses
 */
const statusArb = fc.constantFrom('OK', 'NO', 'BAD');

/**
 * Generates valid response text (printable ASCII without special chars)
 */
const responseTextArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-_'),
  { minLength: 0, maxLength: 50 }
);

/**
 * Generates valid IMAP atoms (no special characters)
 * Excludes NIL (case-insensitive) as it's a reserved keyword
 */
const atomArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._-'),
  { minLength: 1, maxLength: 20 }
).filter(s => s.toUpperCase() !== 'NIL');

/**
 * Generates valid quoted strings (may contain spaces)
 */
const quotedStringArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,!?-_'),
  { minLength: 0, maxLength: 30 }
);

describe('Property 13: IMAP Response Parsing', () => {
  describe('Tagged Response Parsing', () => {
    it('correctly identifies tagged responses with valid tag and status', () => {
      fc.assert(
        fc.property(
          tagArb,
          statusArb,
          responseTextArb,
          (tag, status, text) => {
            const line = `${tag} ${status} ${text}`;
            
            expect(isTaggedResponse(line)).toBe(true);
            expect(isContinuationResponse(line)).toBe(false);
            
            const parsed = parseTaggedResponse(line);
            expect(parsed.tag).toBe(tag);
            expect(parsed.status).toBe(status);
            // Parser correctly trims whitespace from response text
            expect(parsed.text).toBe(text.trim());
          }
        ),
        { numRuns: 100 }
      );
    });

    it('extracts correct status from tagged responses', () => {
      fc.assert(
        fc.property(
          tagArb,
          statusArb,
          (tag, status) => {
            const line = `${tag} ${status}`;
            const parsed = parseTaggedResponse(line);
            
            expect(parsed.status).toBe(status);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Untagged Response Parsing', () => {
    it('correctly parses untagged status responses', () => {
      fc.assert(
        fc.property(
          statusArb,
          responseTextArb,
          (status, text) => {
            const line = `* ${status} ${text}`;
            
            expect(isTaggedResponse(line)).toBe(false);
            
            const parsed = parseUntaggedResponse(line);
            expect(parsed.type).toBe(status);
            expect(parsed.raw).toBe(line);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly parses numeric untagged responses (EXISTS, RECENT, etc.)', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99999 }),
          fc.constantFrom('EXISTS', 'RECENT', 'EXPUNGE'),
          (num, type) => {
            const line = `* ${num} ${type}`;
            
            const parsed = parseUntaggedResponse(line);
            expect(parsed.type).toBe(type);
            expect((parsed.data as { number: number }).number).toBe(num);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly parses SEARCH responses with UIDs', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 0, maxLength: 20 }),
          (uids) => {
            const line = `* SEARCH ${uids.join(' ')}`;
            
            const parsed = parseUntaggedResponse(line);
            expect(parsed.type).toBe('SEARCH');
            expect(parsed.data).toEqual(uids);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly parses CAPABILITY responses', () => {
      fc.assert(
        fc.property(
          fc.array(atomArb, { minLength: 1, maxLength: 10 }),
          (caps) => {
            const line = `* CAPABILITY ${caps.join(' ')}`;
            
            const parsed = parseUntaggedResponse(line);
            expect(parsed.type).toBe('CAPABILITY');
            expect(parsed.data).toEqual(caps);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Continuation Response Parsing', () => {
    it('correctly identifies continuation responses', () => {
      fc.assert(
        fc.property(
          responseTextArb,
          (text) => {
            const line = `+ ${text}`;
            
            expect(isContinuationResponse(line)).toBe(true);
            expect(isTaggedResponse(line)).toBe(false);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multi-line Response Parsing', () => {
    it('correctly separates tagged and untagged responses', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 999 }), { minLength: 1, maxLength: 5 }),
          tagArb,
          statusArb,
          responseTextArb,
          (nums, tag, status, text) => {
            const lines = [
              ...nums.map(n => `* ${n} EXISTS`),
              `${tag} ${status} ${text}`
            ];
            
            const parsed = parseResponse(lines);
            
            expect(parsed.untagged.length).toBe(nums.length);
            expect(parsed.tagged).toBeDefined();
            expect(parsed.tagged?.tag).toBe(tag);
            expect(parsed.tagged?.status).toBe(status);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Tokenizer', () => {
    it('correctly tokenizes atoms', () => {
      fc.assert(
        fc.property(
          atomArb,
          (atom) => {
            const { tokens } = tokenize(atom);
            
            expect(tokens.length).toBe(1);
            expect(tokens[0].type).toBe('atom');
            expect(getTokenValue(tokens[0])).toBe(atom);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly tokenizes quoted strings', () => {
      fc.assert(
        fc.property(
          quotedStringArb,
          (str) => {
            const input = `"${str}"`;
            const { tokens } = tokenize(input);
            
            expect(tokens.length).toBe(1);
            expect(tokens[0].type).toBe('quoted');
            expect(getTokenValue(tokens[0])).toBe(str);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly tokenizes multiple space-separated atoms', () => {
      fc.assert(
        fc.property(
          fc.array(atomArb, { minLength: 1, maxLength: 5 }),
          (atoms) => {
            const input = atoms.join(' ');
            const { tokens } = tokenize(input);
            
            expect(tokens.length).toBe(atoms.length);
            tokens.forEach((token, i) => {
              expect(token.type).toBe('atom');
              expect(getTokenValue(token)).toBe(atoms[i]);
            });
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly tokenizes parenthesized lists', () => {
      fc.assert(
        fc.property(
          fc.array(atomArb, { minLength: 0, maxLength: 5 }),
          (atoms) => {
            const input = `(${atoms.join(' ')})`;
            const { tokens } = tokenize(input);
            
            expect(tokens.length).toBe(1);
            expect(tokens[0].type).toBe('list');
            expect(isListToken(tokens[0])).toBe(true);
            
            if (isListToken(tokens[0])) {
              expect(tokens[0].value.length).toBe(atoms.length);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly identifies NIL tokens', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('NIL', 'nil', 'Nil', 'nIl'),
          (nilVariant) => {
            const { tokens } = tokenize(nilVariant);
            
            expect(tokens.length).toBe(1);
            expect(tokens[0].type).toBe('nil');
            expect(getTokenValue(tokens[0])).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    it('correctly tokenizes literal markers', () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 99999 }),
          (size) => {
            const input = `{${size}}`;
            const { tokens } = tokenize(input);
            
            expect(tokens.length).toBe(1);
            expect(tokens[0].type).toBe('literal');
            expect(getTokenValue(tokens[0])).toBe(String(size));
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
