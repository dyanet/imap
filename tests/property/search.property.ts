/**
 * Property-based tests for search command construction
 * 
 * Feature: dyanet-imap, Property 2: Search Command Construction
 * Validates: Requirements 3.1, 3.2, 3.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CommandBuilder } from '../../src/commands/builder.js';
import type { SearchCriteria } from '../../src/types/search.js';

// Arbitrary for simple flag criteria
const simpleCriteriaArb = fc.constantFrom<SearchCriteria>(
  'ALL', 'UNSEEN', 'SEEN', 'FLAGGED', 'UNFLAGGED',
  'ANSWERED', 'UNANSWERED', 'DELETED', 'UNDELETED',
  'DRAFT', 'UNDRAFT', 'NEW', 'OLD', 'RECENT'
);

// Arbitrary for string-based criteria (FROM, TO, etc.)
const stringCriteriaArb = fc.oneof(
  fc.tuple(fc.constant('FROM' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('TO' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('CC' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('BCC' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('SUBJECT' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('BODY' as const), fc.string({ minLength: 1, maxLength: 50 })),
  fc.tuple(fc.constant('TEXT' as const), fc.string({ minLength: 1, maxLength: 50 }))
);

// Arbitrary for date-based criteria
const dateCriteriaArb = fc.oneof(
  fc.tuple(fc.constant('SINCE' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') })),
  fc.tuple(fc.constant('BEFORE' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') })),
  fc.tuple(fc.constant('ON' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') })),
  fc.tuple(fc.constant('SENTSINCE' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') })),
  fc.tuple(fc.constant('SENTBEFORE' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') })),
  fc.tuple(fc.constant('SENTON' as const), fc.date({ min: new Date('1990-01-01'), max: new Date('2030-12-31') }))
);

// Arbitrary for size-based criteria
const sizeCriteriaArb = fc.oneof(
  fc.tuple(fc.constant('LARGER' as const), fc.integer({ min: 0, max: 10000000 })),
  fc.tuple(fc.constant('SMALLER' as const), fc.integer({ min: 0, max: 10000000 }))
);

// Arbitrary for UID criteria
const uidCriteriaArb = fc.tuple(
  fc.constant('UID' as const),
  fc.stringOf(fc.constantFrom('0', '1', '2', '3', '4', '5', '6', '7', '8', '9', ':', ',', '*'), { minLength: 1, maxLength: 20 })
);

// Arbitrary for HEADER criteria
const headerCriteriaArb = fc.tuple(
  fc.constant('HEADER' as const),
  fc.string({ minLength: 1, maxLength: 20 }),
  fc.string({ minLength: 1, maxLength: 50 })
);

// Combined arbitrary for any search criteria
const searchCriteriaArb: fc.Arbitrary<SearchCriteria> = fc.oneof(
  simpleCriteriaArb,
  stringCriteriaArb as fc.Arbitrary<SearchCriteria>,
  dateCriteriaArb as fc.Arbitrary<SearchCriteria>,
  sizeCriteriaArb as fc.Arbitrary<SearchCriteria>,
  uidCriteriaArb as fc.Arbitrary<SearchCriteria>,
  headerCriteriaArb as fc.Arbitrary<SearchCriteria>
);

describe('Property 2: Search Command Construction', () => {
  it('produces syntactically correct SEARCH command starting with "SEARCH"', () => {
    fc.assert(
      fc.property(
        fc.array(searchCriteriaArb, { minLength: 0, maxLength: 5 }),
        (criteria) => {
          const command = CommandBuilder.search(criteria);
          expect(command.startsWith('SEARCH ')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('empty criteria array produces "SEARCH ALL"', () => {
    const command = CommandBuilder.search([]);
    expect(command).toBe('SEARCH ALL');
  });

  it('single simple criteria produces correct command', () => {
    fc.assert(
      fc.property(
        simpleCriteriaArb,
        (criterion) => {
          const command = CommandBuilder.search([criterion]);
          expect(command).toBe(`SEARCH ${criterion}`);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('multiple criteria are space-separated (AND semantics)', () => {
    fc.assert(
      fc.property(
        fc.array(simpleCriteriaArb, { minLength: 2, maxLength: 5 }),
        (criteria) => {
          const command = CommandBuilder.search(criteria);
          // Command should contain all criteria
          for (const criterion of criteria) {
            expect(command).toContain(criterion);
          }
          // Should be space-separated after SEARCH
          const afterSearch = command.slice('SEARCH '.length);
          const parts = afterSearch.split(' ');
          expect(parts.length).toBeGreaterThanOrEqual(criteria.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('string criteria (FROM, TO, etc.) include the search type and produce valid command', () => {
    fc.assert(
      fc.property(
        stringCriteriaArb as fc.Arbitrary<[string, string]>,
        ([type, value]) => {
          const command = CommandBuilder.search([[type, value] as SearchCriteria]);
          expect(command).toContain(type);
          // Command should start with SEARCH and contain the type
          expect(command.startsWith('SEARCH ')).toBe(true);
          // The command should have content after the type
          const typeIndex = command.indexOf(type);
          expect(typeIndex).toBeGreaterThan(0);
          // There should be content after the type (the value, possibly escaped)
          const afterType = command.slice(typeIndex + type.length);
          expect(afterType.trim().length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('date criteria produce valid IMAP date format (DD-Mon-YYYY)', () => {
    fc.assert(
      fc.property(
        dateCriteriaArb as fc.Arbitrary<[string, Date]>,
        ([type, date]) => {
          const command = CommandBuilder.search([[type, date] as SearchCriteria]);
          expect(command).toContain(type);
          // Check for date format: D-Mon-YYYY or DD-Mon-YYYY
          const datePattern = /\d{1,2}-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-\d{4}/;
          expect(command).toMatch(datePattern);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('size criteria include numeric value', () => {
    fc.assert(
      fc.property(
        sizeCriteriaArb as fc.Arbitrary<[string, number]>,
        ([type, size]) => {
          const command = CommandBuilder.search([[type, size] as SearchCriteria]);
          expect(command).toContain(type);
          expect(command).toContain(size.toString());
        }
      ),
      { numRuns: 100 }
    );
  });

  it('UID criteria include UID keyword and sequence', () => {
    fc.assert(
      fc.property(
        uidCriteriaArb,
        ([, sequence]) => {
          const command = CommandBuilder.search([['UID', sequence]]);
          expect(command).toContain('UID');
          expect(command).toContain(sequence);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('HEADER criteria include field name and produce valid command', () => {
    fc.assert(
      fc.property(
        headerCriteriaArb,
        ([, fieldName, value]) => {
          const command = CommandBuilder.search([['HEADER', fieldName, value]]);
          expect(command).toContain('HEADER');
          // Command should start with SEARCH
          expect(command.startsWith('SEARCH ')).toBe(true);
          // HEADER should be followed by two arguments (field name and value)
          const headerIndex = command.indexOf('HEADER');
          expect(headerIndex).toBeGreaterThan(0);
          // There should be content after HEADER
          const afterHeader = command.slice(headerIndex + 'HEADER'.length);
          expect(afterHeader.trim().length).toBeGreaterThan(0);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: dyanet-imap, Property 3: Search Response Parsing
 * Validates: Requirements 3.1, 3.4
 */

import { ResponseParser } from '../../src/protocol/response-parser.js';
import type { UntaggedResponse } from '../../src/types/protocol.js';

describe('Property 3: Search Response Parsing', () => {
  describe('ResponseParser.parseSearchResponse', () => {
    it('correctly parses UntaggedResponse with UIDs into number array', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 0, maxLength: 20 }),
          (uids) => {
            const response: UntaggedResponse = {
              type: 'SEARCH',
              data: uids,
              raw: `* SEARCH ${uids.join(' ')}`
            };

            const result = ResponseParser.parseSearchResponse([response]);

            expect(result).toEqual(uids);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses raw SEARCH response lines', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 0, maxLength: 20 }),
          (uids) => {
            const line = `* SEARCH ${uids.join(' ')}`;

            const result = ResponseParser.parseSearchResponse([line]);

            expect(result).toEqual(uids);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('returns empty array for empty SEARCH response', () => {
      const response: UntaggedResponse = {
        type: 'SEARCH',
        data: [],
        raw: '* SEARCH'
      };

      const result = ResponseParser.parseSearchResponse([response]);

      expect(result).toEqual([]);
    });

    it('returns empty array for empty input', () => {
      const result = ResponseParser.parseSearchResponse([]);
      expect(result).toEqual([]);
    });

    it('ignores non-SEARCH responses', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 10 }),
          (uids) => {
            const responses: UntaggedResponse[] = [
              {
                type: 'EXISTS',
                data: { number: 100 },
                raw: '* 100 EXISTS'
              },
              {
                type: 'SEARCH',
                data: uids,
                raw: `* SEARCH ${uids.join(' ')}`
              },
              {
                type: 'FLAGS',
                data: ['\\Seen', '\\Flagged'],
                raw: '* FLAGS (\\Seen \\Flagged)'
              }
            ];

            const result = ResponseParser.parseSearchResponse(responses);

            // Should only contain UIDs from SEARCH response
            expect(result).toEqual(uids);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('combines UIDs from multiple SEARCH responses', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 10 }),
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 1, maxLength: 10 }),
          (uids1, uids2) => {
            const responses: UntaggedResponse[] = [
              {
                type: 'SEARCH',
                data: uids1,
                raw: `* SEARCH ${uids1.join(' ')}`
              },
              {
                type: 'SEARCH',
                data: uids2,
                raw: `* SEARCH ${uids2.join(' ')}`
              }
            ];

            const result = ResponseParser.parseSearchResponse(responses);

            // Should contain all UIDs from both responses
            expect(result).toEqual([...uids1, ...uids2]);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('preserves order of UIDs', () => {
      fc.assert(
        fc.property(
          fc.array(fc.integer({ min: 1, max: 99999 }), { minLength: 2, maxLength: 20 }),
          (uids) => {
            const response: UntaggedResponse = {
              type: 'SEARCH',
              data: uids,
              raw: `* SEARCH ${uids.join(' ')}`
            };

            const result = ResponseParser.parseSearchResponse([response]);

            // Order should be preserved
            for (let i = 0; i < uids.length; i++) {
              expect(result[i]).toBe(uids[i]);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});
