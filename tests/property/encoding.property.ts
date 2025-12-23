/**
 * Property-based tests for content encoding/decoding
 * 
 * Feature: dyanet-imap, Property 1: Content Encoding Round-Trip
 * Validates: Requirements 4.4
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  base64Encode,
  base64Decode,
  quotedPrintableEncode,
  quotedPrintableDecode
} from '../../src/encoding/index.js';

describe('Property 1: Content Encoding Round-Trip', () => {
  it('base64 encode/decode round-trip preserves string data', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (original) => {
          const encoded = base64Encode(original);
          const decoded = base64Decode(encoded);
          const result = decoded.toString('utf-8');
          
          expect(result).toBe(original);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('base64 encode/decode round-trip preserves binary data', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 1000 }),
        (original) => {
          const buffer = Buffer.from(original);
          const encoded = base64Encode(buffer);
          const decoded = base64Decode(encoded);
          
          expect(decoded.equals(buffer)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('base64 decode handles whitespace in encoded string', () => {
    fc.assert(
      fc.property(
        fc.string(),
        (original) => {
          const encoded = base64Encode(original);
          // Add line breaks like MIME base64
          const withLineBreaks = encoded.match(/.{1,76}/g)?.join('\r\n') || encoded;
          const decoded = base64Decode(withLineBreaks);
          const result = decoded.toString('utf-8');
          
          expect(result).toBe(original);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('quoted-printable encode/decode round-trip preserves ASCII string data', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 0, maxLength: 500 }),
        (original) => {
          const encoded = quotedPrintableEncode(original);
          const decoded = quotedPrintableDecode(encoded);
          const result = decoded.toString('utf-8');
          
          expect(result).toBe(original);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('quoted-printable encode/decode round-trip preserves binary data', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 500 }),
        (original) => {
          const buffer = Buffer.from(original);
          const encoded = quotedPrintableEncode(buffer);
          const decoded = quotedPrintableDecode(encoded);
          
          expect(decoded.equals(buffer)).toBe(true);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('base64 encoded output contains only valid base64 characters', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 500 }),
        (original) => {
          const buffer = Buffer.from(original);
          const encoded = base64Encode(buffer);
          
          // Base64 alphabet: A-Z, a-z, 0-9, +, /, and = for padding
          expect(encoded).toMatch(/^[A-Za-z0-9+/=]*$/);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('quoted-printable encoded output contains only valid QP characters', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 0, maxLength: 200 }),
        (original) => {
          const buffer = Buffer.from(original);
          const encoded = quotedPrintableEncode(buffer);
          
          // QP output should only contain printable ASCII and =XX sequences
          // Remove soft line breaks for validation
          const withoutSoftBreaks = encoded.replace(/=\r\n/g, '');
          
          // Each character should be printable ASCII or part of =XX sequence
          const validPattern = /^(?:[!-<>-~\t ]|=[0-9A-F]{2})*$/;
          expect(withoutSoftBreaks).toMatch(validPattern);
        }
      ),
      { numRuns: 100 }
    );
  });
});
