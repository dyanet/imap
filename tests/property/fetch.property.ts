/**
 * Property-based tests for fetch command construction
 * 
 * Feature: dyanet-imap, Property 4: Fetch Command Construction
 * Validates: Requirements 4.1, 4.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { CommandBuilder } from '../../src/commands/builder.js';
import type { FetchOptions } from '../../src/types/search.js';

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

// Arbitrary for body parts
const bodyPartArb = fc.constantFrom(
  'HEADER', 'TEXT', '', 'FULL', '1', '1.2', '2.1.3',
  'HEADER.FIELDS (FROM TO SUBJECT)', 'HEADER.FIELDS.NOT (BCC)'
);

// Arbitrary for fetch options
const fetchOptionsArb: fc.Arbitrary<FetchOptions> = fc.record({
  bodies: fc.option(
    fc.oneof(
      bodyPartArb,
      fc.array(bodyPartArb, { minLength: 1, maxLength: 3 })
    ),
    { nil: undefined }
  ),
  struct: fc.option(fc.boolean(), { nil: undefined }),
  envelope: fc.option(fc.boolean(), { nil: undefined }),
  size: fc.option(fc.boolean(), { nil: undefined }),
  markSeen: fc.option(fc.boolean(), { nil: undefined })
});

describe('Property 4: Fetch Command Construction', () => {
  it('produces syntactically correct FETCH command starting with "FETCH"', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fetchOptionsArb,
        (sequence, options) => {
          const command = CommandBuilder.fetch(sequence, options);
          expect(command.startsWith('FETCH ')).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes the message sequence in the command', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fetchOptionsArb,
        (sequence, options) => {
          const command = CommandBuilder.fetch(sequence, options);
          expect(command).toContain(sequence);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('always includes UID and FLAGS in fetch items', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fetchOptionsArb,
        (sequence, options) => {
          const command = CommandBuilder.fetch(sequence, options);
          expect(command).toContain('UID');
          expect(command).toContain('FLAGS');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes BODYSTRUCTURE when struct option is true', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        (sequence) => {
          const command = CommandBuilder.fetch(sequence, { struct: true });
          expect(command).toContain('BODYSTRUCTURE');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes ENVELOPE when envelope option is true', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        (sequence) => {
          const command = CommandBuilder.fetch(sequence, { envelope: true });
          expect(command).toContain('ENVELOPE');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('includes RFC822.SIZE when size option is true', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        (sequence) => {
          const command = CommandBuilder.fetch(sequence, { size: true });
          expect(command).toContain('RFC822.SIZE');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses BODY.PEEK when markSeen is false or undefined', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fc.constantFrom(undefined, false),
        (sequence, markSeen) => {
          const command = CommandBuilder.fetch(sequence, { bodies: 'HEADER', markSeen });
          expect(command).toContain('BODY.PEEK');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('uses BODY (without PEEK) when markSeen is true', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        (sequence) => {
          const command = CommandBuilder.fetch(sequence, { bodies: 'HEADER', markSeen: true });
          expect(command).toContain('BODY[');
          expect(command).not.toContain('BODY.PEEK');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('wraps fetch items in parentheses', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fetchOptionsArb,
        (sequence, options) => {
          const command = CommandBuilder.fetch(sequence, options);
          // Should have format: FETCH sequence (items)
          const match = command.match(/^FETCH \S+ \(.*\)$/);
          expect(match).not.toBeNull();
        }
      ),
      { numRuns: 100 }
    );
  });

  it('handles multiple body parts', () => {
    fc.assert(
      fc.property(
        sequenceArb,
        fc.array(bodyPartArb, { minLength: 2, maxLength: 3 }),
        (sequence, bodies) => {
          const command = CommandBuilder.fetch(sequence, { bodies });
          // Each body part should result in a BODY reference
          const bodyCount = (command.match(/BODY/g) || []).length;
          expect(bodyCount).toBeGreaterThanOrEqual(bodies.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});


/**
 * Feature: dyanet-imap, Property 5: Fetch Response Parsing
 * Validates: Requirements 4.5
 */

import { ResponseParser } from '../../src/protocol/response-parser.js';
import type { UntaggedResponse } from '../../src/types/protocol.js';

// Arbitrary for message flags
const flagArb = fc.constantFrom(
  '\\Seen',
  '\\Answered',
  '\\Flagged',
  '\\Deleted',
  '\\Draft',
  '\\Recent'
);

// Arbitrary for body part names
const bodyPartNameArb = fc.constantFrom(
  'HEADER',
  'TEXT',
  '',
  '1',
  '1.2',
  '2.1'
);

// Arbitrary for body content (simple ASCII text)
const bodyContentArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 \n\r'),
  { minLength: 0, maxLength: 100 }
);

// Arbitrary for FETCH response data
const fetchDataArb = fc.record({
  seqno: fc.integer({ min: 1, max: 99999 }),
  uid: fc.integer({ min: 1, max: 999999999 }),
  flags: fc.array(flagArb, { minLength: 0, maxLength: 4 }),
  size: fc.integer({ min: 0, max: 10000000 }),
  bodyParts: fc.uniqueArray(
    fc.record({
      name: bodyPartNameArb,
      content: bodyContentArb
    }),
    { minLength: 0, maxLength: 3, selector: (item) => item.name }
  )
});

/**
 * Builds an UntaggedResponse for FETCH from test data
 */
function buildFetchResponse(data: {
  seqno: number;
  uid: number;
  flags: string[];
  size: number;
  bodyParts: { name: string; content: string }[];
}): UntaggedResponse {
  const attributes: Record<string, unknown> = {
    UID: data.uid,
    FLAGS: data.flags,
    'RFC822.SIZE': data.size
  };

  // Add body parts
  for (const part of data.bodyParts) {
    const key = `BODY[${part.name}]`;
    attributes[key] = part.content;
  }

  return {
    type: 'FETCH',
    data: {
      seqno: data.seqno,
      attributes
    },
    raw: `* ${data.seqno} FETCH (...)`
  };
}

describe('Property 5: Fetch Response Parsing', () => {
  describe('ResponseParser.parseFetchResponse', () => {
    it('correctly parses sequence number and UID', () => {
      fc.assert(
        fc.property(
          fetchDataArb,
          (data) => {
            const response = buildFetchResponse(data);
            const messages = ResponseParser.parseFetchResponse([response]);

            expect(messages.length).toBe(1);
            expect(messages[0].seqno).toBe(data.seqno);
            expect(messages[0].uid).toBe(data.uid);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses message flags', () => {
      fc.assert(
        fc.property(
          fetchDataArb,
          (data) => {
            const response = buildFetchResponse(data);
            const messages = ResponseParser.parseFetchResponse([response]);

            expect(messages.length).toBe(1);
            expect(messages[0].attributes.flags).toEqual(data.flags);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses message size', () => {
      fc.assert(
        fc.property(
          fetchDataArb,
          (data) => {
            const response = buildFetchResponse(data);
            const messages = ResponseParser.parseFetchResponse([response]);

            expect(messages.length).toBe(1);
            expect(messages[0].attributes.size).toBe(data.size);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly extracts body parts', () => {
      fc.assert(
        fc.property(
          fetchDataArb,
          (data) => {
            const response = buildFetchResponse(data);
            const messages = ResponseParser.parseFetchResponse([response]);

            expect(messages.length).toBe(1);
            expect(messages[0].parts.length).toBe(data.bodyParts.length);

            for (let i = 0; i < data.bodyParts.length; i++) {
              const expectedPart = data.bodyParts[i];
              const actualPart = messages[0].parts.find(p => p.which === expectedPart.name);
              expect(actualPart).toBeDefined();
              expect(actualPart!.body).toBe(expectedPart.content);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('handles multiple FETCH responses', () => {
      fc.assert(
        fc.property(
          fc.array(fetchDataArb, { minLength: 1, maxLength: 5 }),
          (dataArray) => {
            const responses = dataArray.map(buildFetchResponse);
            const messages = ResponseParser.parseFetchResponse(responses);

            expect(messages.length).toBe(dataArray.length);

            for (let i = 0; i < dataArray.length; i++) {
              expect(messages[i].seqno).toBe(dataArray[i].seqno);
              expect(messages[i].uid).toBe(dataArray[i].uid);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('ignores non-FETCH responses', () => {
      fc.assert(
        fc.property(
          fetchDataArb,
          (data) => {
            const fetchResponse = buildFetchResponse(data);
            const responses: UntaggedResponse[] = [
              {
                type: 'EXISTS',
                data: { number: 100 },
                raw: '* 100 EXISTS'
              },
              fetchResponse,
              {
                type: 'FLAGS',
                data: ['\\Seen'],
                raw: '* FLAGS (\\Seen)'
              }
            ];

            const messages = ResponseParser.parseFetchResponse(responses);

            expect(messages.length).toBe(1);
            expect(messages[0].uid).toBe(data.uid);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('returns empty array for empty input', () => {
      const messages = ResponseParser.parseFetchResponse([]);
      expect(messages).toEqual([]);
    });

    it('returns empty array when no FETCH responses present', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'EXISTS',
          data: { number: 100 },
          raw: '* 100 EXISTS'
        },
        {
          type: 'SEARCH',
          data: [1, 2, 3],
          raw: '* SEARCH 1 2 3'
        }
      ];

      const messages = ResponseParser.parseFetchResponse(responses);
      expect(messages).toEqual([]);
    });
  });
});
