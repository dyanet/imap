/**
 * Property-based tests for MIME multipart parsing
 * 
 * Feature: dyanet-imap, Property 6: MIME Multipart Parsing
 * Validates: Requirements 4.3
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  parseHeaders,
  decodeEncodedWords,
  unfoldHeaders,
  parseContentType,
  extractBoundary,
  splitMultipartBody,
  parseMimePart,
  parseMultipartMessage,
  flattenMimeParts,
  decodeContent,
  parseBodyStructure,
} from '../../src/mime/index.js';
import { base64Encode } from '../../src/encoding/base64.js';
import { quotedPrintableEncode } from '../../src/encoding/quoted-printable.js';

/**
 * Generates a valid boundary string (RFC 2046 compliant)
 */
const boundaryArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789_-'.split('')),
  { minLength: 1, maxLength: 40 }
);

/**
 * Generates a valid header name (token per RFC 2822)
 */
const headerNameArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-'.split('')),
  { minLength: 1, maxLength: 20 }
);

/**
 * Generates a simple header value (no special characters that need encoding)
 * Must have at least one non-whitespace character to survive trimming
 */
const simpleHeaderValueArb = fc.tuple(
  fc.stringOf(
    fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789.,;:!?-_@'.split('')),
    { minLength: 1, maxLength: 50 }
  ),
  fc.stringOf(
    fc.constantFrom(...' '.split('')),
    { minLength: 0, maxLength: 10 }
  )
).map(([text, spaces]) => text + spaces).map(s => s.trim()); // Ensure non-empty after trim

/**
 * Generates a simple body content (printable ASCII)
 */
const simpleBodyArb = fc.stringOf(
  fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 .,;:!?-_\r\n'.split('')),
  { minLength: 0, maxLength: 200 }
);

describe('Property 6: MIME Multipart Parsing', () => {
  describe('Header Parsing', () => {
    it('parseHeaders extracts all headers from a valid header block', () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.tuple(headerNameArb, simpleHeaderValueArb),
            { minLength: 1, maxLength: 10 }
          ),
          (headerPairs) => {
            // Build a header block
            const headerBlock = headerPairs
              .map(([name, value]) => `${name}: ${value}`)
              .join('\r\n');
            
            const headers = parseHeaders(headerBlock);
            
            // Each header should be present (case-insensitive)
            for (const [name, value] of headerPairs) {
              const parsed = headers.get(name.toLowerCase());
              // Handle multiple values for same header
              if (Array.isArray(parsed)) {
                expect(parsed).toContain(value);
              } else {
                expect(parsed).toBe(value);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    it('unfoldHeaders correctly joins folded header lines', () => {
      fc.assert(
        fc.property(
          headerNameArb,
          fc.stringOf(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')),
            { minLength: 1, maxLength: 20 }
          ),
          fc.stringOf(
            fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')),
            { minLength: 1, maxLength: 20 }
          ),
          (name, value1, value2) => {
            // Create a folded header
            const folded = `${name}: ${value1}\r\n ${value2}`;
            const unfolded = unfoldHeaders(folded);
            
            // Folding whitespace (CRLF + space) should be replaced with single space
            // Result should contain both values separated by space
            expect(unfolded).toContain(value1);
            expect(unfolded).toContain(value2);
            // Should not contain CRLF
            expect(unfolded).not.toContain('\r\n');
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parseContentType extracts type, subtype, and parameters', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('text', 'multipart', 'application', 'image'),
          fc.constantFrom('plain', 'html', 'mixed', 'octet-stream'),
          fc.constantFrom('utf-8', 'us-ascii', 'iso-8859-1'),
          (type, subtype, charset) => {
            const contentType = `${type}/${subtype}; charset="${charset}"`;
            const parsed = parseContentType(contentType);
            
            expect(parsed.type).toBe(type);
            expect(parsed.subtype).toBe(subtype);
            expect(parsed.params['charset']).toBe(charset);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multipart Boundary Detection', () => {
    it('extractBoundary extracts boundary from Content-Type', () => {
      fc.assert(
        fc.property(
          boundaryArb,
          (boundary) => {
            const contentType = `multipart/mixed; boundary="${boundary}"`;
            const extracted = extractBoundary(contentType);
            
            expect(extracted).toBe(boundary);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('extractBoundary handles unquoted boundaries', () => {
      fc.assert(
        fc.property(
          boundaryArb,
          (boundary) => {
            const contentType = `multipart/mixed; boundary=${boundary}`;
            const extracted = extractBoundary(contentType);
            
            expect(extracted).toBe(boundary);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Multipart Part Extraction', () => {
    it('splitMultipartBody extracts correct number of parts', () => {
      fc.assert(
        fc.property(
          boundaryArb,
          fc.array(simpleBodyArb, { minLength: 1, maxLength: 5 }),
          (boundary, partContents) => {
            // Build a multipart body
            const parts = partContents.map(content => 
              `Content-Type: text/plain\r\n\r\n${content}`
            );
            
            const body = [
              `--${boundary}`,
              ...parts.flatMap((part, i) => 
                i < parts.length - 1 
                  ? [part, `--${boundary}`]
                  : [part]
              ),
              `--${boundary}--`
            ].join('\r\n');
            
            const extracted = splitMultipartBody(body, boundary);
            
            expect(extracted.length).toBe(partContents.length);
          }
        ),
        { numRuns: 100 }
      );
    });
  });


  describe('Content Decoding', () => {
    it('decodeContent with base64 produces correct output', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200 }),
          (original) => {
            const encoded = base64Encode(original);
            const decoded = decodeContent(encoded, 'base64');
            
            expect(Buffer.isBuffer(decoded)).toBe(true);
            expect((decoded as Buffer).toString('utf-8')).toBe(original);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('decodeContent with quoted-printable produces correct output', () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 0, maxLength: 200 }),
          (original) => {
            const encoded = quotedPrintableEncode(original);
            const decoded = decodeContent(encoded, 'quoted-printable');
            
            expect(Buffer.isBuffer(decoded)).toBe(true);
            expect((decoded as Buffer).toString('utf-8')).toBe(original);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('decodeContent with 7bit/8bit returns original string', () => {
      fc.assert(
        fc.property(
          simpleBodyArb,
          fc.constantFrom('7bit', '8bit', 'binary'),
          (content, encoding) => {
            const decoded = decodeContent(content, encoding);
            
            expect(decoded).toBe(content);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Complete MIME Message Parsing', () => {
    it('parseMimePart extracts headers and body correctly', () => {
      fc.assert(
        fc.property(
          simpleHeaderValueArb,
          simpleBodyArb,
          (subject, body) => {
            const rawPart = `Subject: ${subject}\r\nContent-Type: text/plain\r\n\r\n${body}`;
            const parsed = parseMimePart(rawPart);
            
            expect(parsed.headers.get('subject')).toBe(subject);
            expect(parsed.contentType.type).toBe('text');
            expect(parsed.contentType.subtype).toBe('plain');
            expect(parsed.body).toBe(body);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parseMultipartMessage correctly parses nested parts', () => {
      fc.assert(
        fc.property(
          boundaryArb,
          simpleBodyArb,
          simpleBodyArb,
          (boundary, body1, body2) => {
            const message = [
              `Content-Type: multipart/mixed; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              'Content-Type: text/plain',
              '',
              body1,
              `--${boundary}`,
              'Content-Type: text/html',
              '',
              body2,
              `--${boundary}--`
            ].join('\r\n');
            
            const parsed = parseMultipartMessage(message);
            
            expect(parsed.contentType.type).toBe('multipart');
            expect(parsed.contentType.subtype).toBe('mixed');
            expect(parsed.parts).toBeDefined();
            expect(parsed.parts!.length).toBe(2);
            expect(parsed.parts![0].body).toBe(body1);
            expect(parsed.parts![1].body).toBe(body2);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('flattenMimeParts produces correct part numbers', () => {
      fc.assert(
        fc.property(
          boundaryArb,
          simpleBodyArb,
          simpleBodyArb,
          (boundary, body1, body2) => {
            const message = [
              `Content-Type: multipart/mixed; boundary="${boundary}"`,
              '',
              `--${boundary}`,
              'Content-Type: text/plain',
              '',
              body1,
              `--${boundary}`,
              'Content-Type: text/plain',
              '',
              body2,
              `--${boundary}--`
            ].join('\r\n');
            
            const parsed = parseMultipartMessage(message);
            const flattened = flattenMimeParts(parsed);
            
            expect(flattened.length).toBe(2);
            expect(flattened[0].which).toBe('1');
            expect(flattened[1].which).toBe('2');
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Body Structure Parsing', () => {
    it('parseBodyStructure handles basic text body', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('plain', 'html'),
          fc.constantFrom('utf-8', 'us-ascii'),
          fc.integer({ min: 0, max: 10000 }),
          (subtype, charset, size) => {
            const bodystructure = `("TEXT" "${subtype.toUpperCase()}" ("CHARSET" "${charset}") NIL NIL "7BIT" ${size} ${Math.floor(size / 80)})`;
            const parsed = parseBodyStructure(bodystructure);
            
            expect(parsed.type).toBe('text');
            expect(parsed.subtype).toBe(subtype);
            expect(parsed.params['charset']).toBe(charset);
            expect(parsed.size).toBe(size);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('parseBodyStructure handles multipart body', () => {
      fc.assert(
        fc.property(
          fc.constantFrom('mixed', 'alternative', 'related'),
          boundaryArb,
          (subtype, boundary) => {
            // Simple multipart with two text parts
            const bodystructure = `(("TEXT" "PLAIN" ("CHARSET" "utf-8") NIL NIL "7BIT" 100 5)("TEXT" "HTML" ("CHARSET" "utf-8") NIL NIL "7BIT" 200 10) "${subtype.toUpperCase()}" ("BOUNDARY" "${boundary}"))`;
            const parsed = parseBodyStructure(bodystructure);
            
            expect(parsed.type).toBe('multipart');
            expect(parsed.subtype).toBe(subtype);
            expect(parsed.parts).toBeDefined();
            expect(parsed.parts!.length).toBe(2);
            expect(parsed.params['boundary']).toBe(boundary);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  describe('Encoded Word Decoding', () => {
    it('decodeEncodedWords handles base64 encoded words', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '.split('')), { minLength: 1, maxLength: 50 }),
          (text) => {
            const encoded = `=?utf-8?B?${base64Encode(text)}?=`;
            const decoded = decodeEncodedWords(encoded);
            
            expect(decoded).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('decodeEncodedWords handles Q-encoded words', () => {
      fc.assert(
        fc.property(
          fc.stringOf(fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'.split('')), { minLength: 1, maxLength: 50 }),
          (text) => {
            // Q-encoding: simple ASCII letters don't need encoding
            const encoded = `=?utf-8?Q?${text}?=`;
            const decoded = decodeEncodedWords(encoded);
            
            expect(decoded).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('decodeEncodedWords preserves non-encoded text', () => {
      fc.assert(
        fc.property(
          simpleHeaderValueArb,
          (text) => {
            const decoded = decodeEncodedWords(text);
            
            expect(decoded).toBe(text);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
