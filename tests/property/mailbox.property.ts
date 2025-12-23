/**
 * Property-based tests for mailbox parsing
 * 
 * Feature: dyanet-imap, Property 8: Mailbox List Parsing
 * Validates: Requirements 2.1
 * 
 * Feature: dyanet-imap, Property 9: Mailbox Select Parsing
 * Validates: Requirements 2.2
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import { ResponseParser } from '../../src/protocol/response-parser.js';
import type { MailboxTree } from '../../src/types/mailbox.js';
import type { UntaggedResponse } from '../../src/types/protocol.js';

/**
 * Generates valid mailbox attributes
 */
const mailboxAttributeArb = fc.constantFrom(
  '\\Noselect',
  '\\HasChildren',
  '\\HasNoChildren',
  '\\Marked',
  '\\Unmarked',
  '\\Noinferiors',
  '\\Drafts',
  '\\Sent',
  '\\Trash',
  '\\Junk',
  '\\All',
  '\\Archive',
  '\\Flagged'
);

/**
 * Generates valid mailbox delimiters
 */
const delimiterArb = fc.constantFrom('/', '.', '\\', '|', null);

/**
 * Generates valid mailbox name parts (no special characters, no reserved JS names)
 */
const mailboxNamePartArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'),
  { minLength: 1, maxLength: 15 }
).filter(name => 
  // Exclude JavaScript reserved property names
  !['constructor', 'prototype', '__proto__', 'valueOf', 'toString', 'hasOwnProperty'].includes(name)
);

/**
 * Generates a valid mailbox name (possibly hierarchical)
 */
const mailboxNameArb = (delimiter: string | null) => {
  if (!delimiter) {
    return mailboxNamePartArb;
  }
  return fc.array(mailboxNamePartArb, { minLength: 1, maxLength: 3 })
    .map(parts => parts.join(delimiter));
};

/**
 * Generates a MailboxInfo object
 */
const mailboxInfoArb = fc.record({
  attributes: fc.array(mailboxAttributeArb, { minLength: 0, maxLength: 3 }),
  delimiter: delimiterArb
}).chain(({ attributes, delimiter }) => 
  mailboxNameArb(delimiter).map(name => ({
    name,
    delimiter: delimiter || '/',
    attributes
  }))
);

/**
 * Generates an UntaggedResponse for LIST
 */
const listResponseArb = mailboxInfoArb.map(info => ({
  type: 'LIST' as const,
  data: {
    attributes: info.attributes,
    delimiter: info.delimiter,
    name: info.name
  },
  raw: `* LIST (${info.attributes.join(' ')}) "${info.delimiter}" "${info.name}"`
}));

describe('Property 8: Mailbox List Parsing', () => {
  describe('ResponseParser.parseListResponse', () => {
    it('parses UntaggedResponse objects into MailboxTree with correct structure', () => {
      fc.assert(
        fc.property(
          fc.array(listResponseArb, { minLength: 1, maxLength: 5 }),
          (responses) => {
            const tree = ResponseParser.parseListResponse(responses);
            
            // Tree should be an object
            expect(typeof tree).toBe('object');
            
            // Each response should result in an entry in the tree
            for (const response of responses) {
              const data = response.data as { name: string; delimiter: string; attributes: string[] };
              const parts = data.delimiter ? data.name.split(data.delimiter) : [data.name];
              
              // Navigate to the mailbox in the tree
              let current: MailboxTree | undefined = tree;
              for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                expect(current).toBeDefined();
                expect(current![part]).toBeDefined();
                
                if (i < parts.length - 1) {
                  current = current![part].children;
                } else {
                  // Last part - check attributes
                  expect(current![part].attribs).toEqual(data.attributes);
                  expect(current![part].delimiter).toBe(data.delimiter);
                }
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('preserves mailbox attributes and delimiter correctly', () => {
      fc.assert(
        fc.property(
          mailboxInfoArb,
          (info) => {
            const response: UntaggedResponse = {
              type: 'LIST',
              data: {
                attributes: info.attributes,
                delimiter: info.delimiter,
                name: info.name
              },
              raw: `* LIST (${info.attributes.join(' ')}) "${info.delimiter}" "${info.name}"`
            };
            
            const tree = ResponseParser.parseListResponse([response]);
            
            // Navigate to the mailbox
            const parts = info.delimiter ? info.name.split(info.delimiter) : [info.name];
            let current: MailboxTree | undefined = tree;
            
            for (let i = 0; i < parts.length; i++) {
              const part = parts[i];
              if (i < parts.length - 1) {
                current = current![part].children;
              } else {
                // Verify attributes and delimiter are preserved
                expect(current![part].attribs).toEqual(info.attributes);
                expect(current![part].delimiter).toBe(info.delimiter);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('builds correct hierarchy for nested mailboxes', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('/', '.'),
          fc.array(mailboxNamePartArb, { minLength: 2, maxLength: 3 }),
          fc.array(mailboxAttributeArb, { minLength: 0, maxLength: 2 }),
          (delimiter, parts, attributes) => {
            const fullName = parts.join(delimiter);
            
            const response: UntaggedResponse = {
              type: 'LIST',
              data: {
                attributes,
                delimiter,
                name: fullName
              },
              raw: `* LIST (${attributes.join(' ')}) "${delimiter}" "${fullName}"`
            };
            
            const tree = ResponseParser.parseListResponse([response]);
            
            // Verify hierarchy is built correctly
            let current: MailboxTree | undefined = tree;
            for (let i = 0; i < parts.length; i++) {
              const part = parts[i];
              expect(current).toBeDefined();
              expect(current![part]).toBeDefined();
              
              if (i < parts.length - 1) {
                expect(current![part].children).toBeDefined();
                current = current![part].children;
              } else {
                expect(current![part].attribs).toEqual(attributes);
              }
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('returns empty tree for empty input', () => {
      const tree = ResponseParser.parseListResponse([]);
      expect(tree).toEqual({});
    });
  });

  describe('ResponseParser.parseListToMailboxInfo', () => {
    it('returns flat array of MailboxInfo objects', () => {
      fc.assert(
        fc.property(
          fc.array(listResponseArb, { minLength: 1, maxLength: 5 }),
          (responses) => {
            const mailboxes = ResponseParser.parseListToMailboxInfo(responses);
            
            expect(Array.isArray(mailboxes)).toBe(true);
            expect(mailboxes.length).toBe(responses.length);
            
            for (let i = 0; i < responses.length; i++) {
              const data = responses[i].data as { name: string; delimiter: string; attributes: string[] };
              expect(mailboxes[i].name).toBe(data.name);
              expect(mailboxes[i].delimiter).toBe(data.delimiter);
              expect(mailboxes[i].attributes).toEqual(data.attributes);
            }
          }
        ),
        { numRuns: 50 }
      );
    });
  });
});


/**
 * Feature: dyanet-imap, Property 9: Mailbox Select Parsing
 * Validates: Requirements 2.2
 */

/**
 * Generates valid IMAP flags
 */
const flagArb = fc.constantFrom(
  '\\Seen',
  '\\Answered',
  '\\Flagged',
  '\\Deleted',
  '\\Draft',
  '\\Recent'
);

/**
 * Generates a valid mailbox name
 */
const simpleMailboxNameArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'),
  { minLength: 1, maxLength: 20 }
).filter(name => 
  !['constructor', 'prototype', '__proto__', 'valueOf', 'toString', 'hasOwnProperty'].includes(name)
);

/**
 * Generates SELECT response data
 */
const selectResponseDataArb = fc.record({
  total: fc.integer({ min: 0, max: 10000 }),
  recent: fc.integer({ min: 0, max: 1000 }),
  unseen: fc.integer({ min: 0, max: 1000 }),
  uidvalidity: fc.integer({ min: 1, max: 999999999 }),
  uidnext: fc.integer({ min: 1, max: 999999999 }),
  flags: fc.array(flagArb, { minLength: 0, maxLength: 5 }),
  permFlags: fc.array(flagArb, { minLength: 0, maxLength: 5 }),
  readOnly: fc.boolean()
});

/**
 * Builds UntaggedResponse array from SELECT response data
 */
function buildSelectResponses(data: {
  total: number;
  recent: number;
  unseen: number;
  uidvalidity: number;
  uidnext: number;
  flags: string[];
  permFlags: string[];
  readOnly: boolean;
}): UntaggedResponse[] {
  const responses: UntaggedResponse[] = [];

  // EXISTS response
  responses.push({
    type: 'EXISTS',
    data: { number: data.total },
    raw: `* ${data.total} EXISTS`
  });

  // RECENT response
  responses.push({
    type: 'RECENT',
    data: { number: data.recent },
    raw: `* ${data.recent} RECENT`
  });

  // FLAGS response
  responses.push({
    type: 'FLAGS',
    data: data.flags,
    raw: `* FLAGS (${data.flags.join(' ')})`
  });

  // UIDVALIDITY response
  responses.push({
    type: 'OK',
    data: { code: `UIDVALIDITY ${data.uidvalidity}`, text: '' },
    raw: `* OK [UIDVALIDITY ${data.uidvalidity}]`
  });

  // UIDNEXT response
  responses.push({
    type: 'OK',
    data: { code: `UIDNEXT ${data.uidnext}`, text: '' },
    raw: `* OK [UIDNEXT ${data.uidnext}]`
  });

  // UNSEEN response
  if (data.unseen > 0) {
    responses.push({
      type: 'OK',
      data: { code: `UNSEEN ${data.unseen}`, text: '' },
      raw: `* OK [UNSEEN ${data.unseen}]`
    });
  }

  // PERMANENTFLAGS response
  if (data.permFlags.length > 0) {
    responses.push({
      type: 'OK',
      data: { code: `PERMANENTFLAGS (${data.permFlags.join(' ')})`, text: '' },
      raw: `* OK [PERMANENTFLAGS (${data.permFlags.join(' ')})]`
    });
  }

  // READ-WRITE or READ-ONLY response
  responses.push({
    type: 'OK',
    data: { code: data.readOnly ? 'READ-ONLY' : 'READ-WRITE', text: '' },
    raw: `* OK [${data.readOnly ? 'READ-ONLY' : 'READ-WRITE'}]`
  });

  return responses;
}

describe('Property 9: Mailbox Select Parsing', () => {
  describe('ResponseParser.parseSelectResponse', () => {
    it('correctly parses message counts from SELECT response', () => {
      fc.assert(
        fc.property(
          selectResponseDataArb,
          simpleMailboxNameArb,
          (data, mailboxName) => {
            const responses = buildSelectResponses(data);
            const mailbox = ResponseParser.parseSelectResponse(responses, mailboxName, data.readOnly);

            expect(mailbox.messages.total).toBe(data.total);
            expect(mailbox.messages.new).toBe(data.recent);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses UID validity and next from SELECT response', () => {
      fc.assert(
        fc.property(
          selectResponseDataArb,
          simpleMailboxNameArb,
          (data, mailboxName) => {
            const responses = buildSelectResponses(data);
            const mailbox = ResponseParser.parseSelectResponse(responses, mailboxName, data.readOnly);

            expect(mailbox.uidvalidity).toBe(data.uidvalidity);
            expect(mailbox.uidnext).toBe(data.uidnext);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses flags from SELECT response', () => {
      fc.assert(
        fc.property(
          selectResponseDataArb,
          simpleMailboxNameArb,
          (data, mailboxName) => {
            const responses = buildSelectResponses(data);
            const mailbox = ResponseParser.parseSelectResponse(responses, mailboxName, data.readOnly);

            expect(mailbox.flags).toEqual(data.flags);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly parses permanent flags from SELECT response', () => {
      fc.assert(
        fc.property(
          selectResponseDataArb,
          simpleMailboxNameArb,
          (data, mailboxName) => {
            const responses = buildSelectResponses(data);
            const mailbox = ResponseParser.parseSelectResponse(responses, mailboxName, data.readOnly);

            if (data.permFlags.length > 0) {
              expect(mailbox.permFlags).toEqual(data.permFlags);
            }
          }
        ),
        { numRuns: 50 }
      );
    });

    it('correctly sets mailbox name and read-only status', () => {
      fc.assert(
        fc.property(
          selectResponseDataArb,
          simpleMailboxNameArb,
          (data, mailboxName) => {
            const responses = buildSelectResponses(data);
            const mailbox = ResponseParser.parseSelectResponse(responses, mailboxName, false);

            expect(mailbox.name).toBe(mailboxName);
            // READ-WRITE/READ-ONLY from response should override initial value
            expect(mailbox.readOnly).toBe(data.readOnly);
          }
        ),
        { numRuns: 50 }
      );
    });

    it('handles empty responses gracefully', () => {
      const mailbox = ResponseParser.parseSelectResponse([], 'INBOX', false);
      
      expect(mailbox.name).toBe('INBOX');
      expect(mailbox.messages.total).toBe(0);
      expect(mailbox.messages.new).toBe(0);
      expect(mailbox.uidvalidity).toBe(0);
      expect(mailbox.uidnext).toBe(0);
      expect(mailbox.flags).toEqual([]);
      expect(mailbox.permFlags).toEqual([]);
    });
  });
});
