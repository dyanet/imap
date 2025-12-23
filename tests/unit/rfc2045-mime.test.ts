/**
 * RFC 2045/2046 MIME Compliance Unit Tests
 * 
 * Tests multipart boundary parsing per RFC 2046.
 * Verifies Content-Transfer-Encoding handling (base64, quoted-printable).
 * Tests encoded-word parsing per RFC 2047.
 * 
 * Requirements: 4.3, 4.4, 7.2
 */

import { describe, it, expect } from 'vitest';
import { base64Encode, base64Decode, base64DecodeToString } from '../../src/encoding/base64.js';
import { 
  quotedPrintableEncode, 
  quotedPrintableDecode, 
  quotedPrintableDecodeToString 
} from '../../src/encoding/quoted-printable.js';
import {
  parseHeaders,
  decodeEncodedWords,
  unfoldHeaders,
  extractHeaderParam,
  parseContentType
} from '../../src/mime/header-parser.js';
import {
  extractBoundary,
  splitMultipartBody,
  decodeContent,
  parseMimePart,
  parseMultipartMessage
} from '../../src/mime/multipart-parser.js';

describe('RFC 2045 MIME Compliance', () => {
  describe('Section 6.1 - Content-Transfer-Encoding: Base64', () => {
    it('should encode ASCII text to base64', () => {
      const input = 'Hello, World!';
      const encoded = base64Encode(input);
      expect(encoded).toBe('SGVsbG8sIFdvcmxkIQ==');
    });

    it('should decode base64 to original text', () => {
      const encoded = 'SGVsbG8sIFdvcmxkIQ==';
      const decoded = base64DecodeToString(encoded);
      expect(decoded).toBe('Hello, World!');
    });

    it('should handle base64 with line breaks (RFC 2045 Section 6.8)', () => {
      // Base64 in MIME can have line breaks every 76 characters
      const encodedWithBreaks = 'SGVs\r\nbG8s\nIFdv\r\ncmxk\nIQ==';
      const decoded = base64DecodeToString(encodedWithBreaks);
      expect(decoded).toBe('Hello, World!');
    });

    it('should encode binary data', () => {
      const binary = Buffer.from([0x00, 0x01, 0x02, 0xFF, 0xFE, 0xFD]);
      const encoded = base64Encode(binary);
      const decoded = base64Decode(encoded);
      expect(decoded).toEqual(binary);
    });

    it('should handle empty input', () => {
      expect(base64Encode('')).toBe('');
      expect(base64DecodeToString('')).toBe('');
    });

    it('should handle padding correctly', () => {
      // No padding needed (multiple of 3)
      expect(base64Encode('abc')).toBe('YWJj');
      // One padding character
      expect(base64Encode('ab')).toBe('YWI=');
      // Two padding characters
      expect(base64Encode('a')).toBe('YQ==');
    });
  });

  describe('Section 6.7 - Content-Transfer-Encoding: Quoted-Printable', () => {
    it('should encode printable ASCII as-is', () => {
      const input = 'Hello World';
      const encoded = quotedPrintableEncode(input);
      expect(encoded).toBe('Hello World');
    });

    it('should encode equals sign', () => {
      const input = 'a=b';
      const encoded = quotedPrintableEncode(input);
      expect(encoded).toBe('a=3Db');
    });

    it('should encode non-printable characters', () => {
      const input = 'Hello\x00World';
      const encoded = quotedPrintableEncode(input);
      expect(encoded).toContain('=00');
    });

    it('should decode quoted-printable', () => {
      const encoded = 'Hello=20World';
      const decoded = quotedPrintableDecodeToString(encoded);
      expect(decoded).toBe('Hello World');
    });

    it('should handle soft line breaks', () => {
      // Soft line break: = at end of line
      const encoded = 'This is a long line that has been =\r\nbroken';
      const decoded = quotedPrintableDecodeToString(encoded);
      expect(decoded).toBe('This is a long line that has been broken');
    });

    it('should handle soft line break with LF only', () => {
      const encoded = 'Line =\ncontinued';
      const decoded = quotedPrintableDecodeToString(encoded);
      expect(decoded).toBe('Line continued');
    });

    it('should decode high-bit characters', () => {
      // UTF-8 encoded "é" is 0xC3 0xA9
      const encoded = '=C3=A9';
      const decoded = quotedPrintableDecodeToString(encoded);
      expect(decoded).toBe('é');
    });

    it('should handle invalid hex sequences gracefully', () => {
      const encoded = '=GG invalid';
      const decoded = quotedPrintableDecodeToString(encoded);
      // Should keep the = as literal when hex is invalid
      expect(decoded).toContain('=');
    });
  });
});

describe('RFC 2046 MIME Compliance', () => {
  describe('Section 5.1 - Multipart Media Type', () => {
    describe('Boundary Extraction', () => {
      it('should extract simple boundary', () => {
        const contentType = 'multipart/mixed; boundary=simple_boundary';
        const boundary = extractBoundary(contentType);
        expect(boundary).toBe('simple_boundary');
      });

      it('should extract quoted boundary', () => {
        const contentType = 'multipart/mixed; boundary="quoted boundary"';
        const boundary = extractBoundary(contentType);
        expect(boundary).toBe('quoted boundary');
      });

      it('should extract boundary with special characters', () => {
        const contentType = 'multipart/alternative; boundary="----=_Part_123_456.789"';
        const boundary = extractBoundary(contentType);
        expect(boundary).toBe('----=_Part_123_456.789');
      });

      it('should return undefined when no boundary', () => {
        const contentType = 'text/plain; charset=utf-8';
        const boundary = extractBoundary(contentType);
        expect(boundary).toBeUndefined();
      });
    });

    describe('Multipart Body Splitting', () => {
      it('should split simple multipart body', () => {
        const body = [
          'Preamble text',
          '--boundary',
          'Part 1 content',
          '--boundary',
          'Part 2 content',
          '--boundary--',
          'Epilogue'
        ].join('\r\n');

        const parts = splitMultipartBody(body, 'boundary');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toBe('Part 1 content');
        expect(parts[1]).toBe('Part 2 content');
      });

      it('should handle multipart with headers in parts', () => {
        const body = [
          '--boundary',
          'Content-Type: text/plain',
          '',
          'Part 1 body',
          '--boundary',
          'Content-Type: text/html',
          '',
          '<p>Part 2 body</p>',
          '--boundary--'
        ].join('\r\n');

        const parts = splitMultipartBody(body, 'boundary');
        expect(parts).toHaveLength(2);
        expect(parts[0]).toContain('Content-Type: text/plain');
        expect(parts[1]).toContain('Content-Type: text/html');
      });

      it('should handle empty parts', () => {
        const body = [
          '--boundary',
          '',
          '--boundary--'
        ].join('\r\n');

        const parts = splitMultipartBody(body, 'boundary');
        // Empty part should be filtered out
        expect(parts.length).toBeLessThanOrEqual(1);
      });

      it('should handle LF-only line endings', () => {
        const body = [
          '--boundary',
          'Part 1',
          '--boundary',
          'Part 2',
          '--boundary--'
        ].join('\n');

        const parts = splitMultipartBody(body, 'boundary');
        expect(parts).toHaveLength(2);
      });
    });

    describe('Content Decoding', () => {
      it('should decode base64 content', () => {
        const content = 'SGVsbG8gV29ybGQ=';
        const decoded = decodeContent(content, 'base64');
        expect(decoded.toString()).toBe('Hello World');
      });

      it('should decode quoted-printable content', () => {
        const content = 'Hello=20World';
        const decoded = decodeContent(content, 'quoted-printable');
        expect(decoded.toString()).toBe('Hello World');
      });

      it('should pass through 7bit content', () => {
        const content = 'Plain text';
        const decoded = decodeContent(content, '7bit');
        expect(decoded).toBe('Plain text');
      });

      it('should pass through 8bit content', () => {
        const content = 'Text with émojis';
        const decoded = decodeContent(content, '8bit');
        expect(decoded).toBe('Text with émojis');
      });

      it('should handle case-insensitive encoding names', () => {
        const content = 'SGVsbG8=';
        expect(decodeContent(content, 'BASE64').toString()).toBe('Hello');
        expect(decodeContent(content, 'Base64').toString()).toBe('Hello');
      });
    });
  });

  describe('Section 5.1.1 - Common Syntax', () => {
    it('should parse complete multipart message', () => {
      const message = [
        'Content-Type: multipart/mixed; boundary="boundary123"',
        '',
        '--boundary123',
        'Content-Type: text/plain',
        '',
        'Hello, this is plain text.',
        '--boundary123',
        'Content-Type: text/html',
        '',
        '<p>Hello HTML</p>',
        '--boundary123--'
      ].join('\r\n');

      const parsed = parseMultipartMessage(message);
      expect(parsed.contentType.type).toBe('multipart');
      expect(parsed.contentType.subtype).toBe('mixed');
      expect(parsed.parts).toBeDefined();
      expect(parsed.parts).toHaveLength(2);
    });

    it('should parse nested multipart message', () => {
      const message = [
        'Content-Type: multipart/mixed; boundary="outer"',
        '',
        '--outer',
        'Content-Type: multipart/alternative; boundary="inner"',
        '',
        '--inner',
        'Content-Type: text/plain',
        '',
        'Plain text',
        '--inner',
        'Content-Type: text/html',
        '',
        '<p>HTML</p>',
        '--inner--',
        '--outer--'
      ].join('\r\n');

      const parsed = parseMultipartMessage(message);
      expect(parsed.parts).toHaveLength(1);
      expect(parsed.parts![0].parts).toHaveLength(2);
    });
  });
});

describe('RFC 2047 Encoded Words', () => {
  describe('Section 2 - Syntax of encoded-words', () => {
    it('should decode base64 encoded word', () => {
      // =?charset?B?encoded_text?=
      const encoded = '=?UTF-8?B?SGVsbG8gV29ybGQ=?=';
      const decoded = decodeEncodedWords(encoded);
      expect(decoded).toBe('Hello World');
    });

    it('should decode Q-encoded word', () => {
      // =?charset?Q?encoded_text?=
      const encoded = '=?UTF-8?Q?Hello_World?=';
      const decoded = decodeEncodedWords(encoded);
      expect(decoded).toBe('Hello World');
    });

    it('should decode Q-encoded with hex escapes', () => {
      const encoded = '=?UTF-8?Q?Caf=C3=A9?=';
      const decoded = decodeEncodedWords(encoded);
      expect(decoded).toBe('Café');
    });

    it('should handle lowercase encoding indicator', () => {
      const encodedB = '=?utf-8?b?SGVsbG8=?=';
      const encodedQ = '=?utf-8?q?Hello?=';
      expect(decodeEncodedWords(encodedB)).toBe('Hello');
      expect(decodeEncodedWords(encodedQ)).toBe('Hello');
    });

    it('should handle ISO-8859-1 charset', () => {
      // "é" in ISO-8859-1 is 0xE9
      const encoded = '=?ISO-8859-1?Q?Caf=E9?=';
      const decoded = decodeEncodedWords(encoded);
      expect(decoded).toContain('Caf');
    });

    it('should preserve non-encoded text', () => {
      const mixed = 'Subject: =?UTF-8?B?SGVsbG8=?= World';
      const decoded = decodeEncodedWords(mixed);
      expect(decoded).toBe('Subject: Hello World');
    });

    it('should handle multiple encoded words', () => {
      const encoded = '=?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?=';
      const decoded = decodeEncodedWords(encoded);
      expect(decoded).toBe('Hello World');
    });

    it('should handle invalid encoded words gracefully', () => {
      const invalid = '=?INVALID?X?test?=';
      const decoded = decodeEncodedWords(invalid);
      // Should return original when encoding is unknown
      expect(decoded).toBe(invalid);
    });
  });
});

describe('RFC 2822 Header Parsing', () => {
  describe('Section 2.2.3 - Long Header Fields (Folding)', () => {
    it('should unfold headers with CRLF + space', () => {
      const folded = 'Subject: This is a very long\r\n subject line';
      const unfolded = unfoldHeaders(folded);
      expect(unfolded).toBe('Subject: This is a very long subject line');
    });

    it('should unfold headers with CRLF + tab', () => {
      const folded = 'Subject: This is\r\n\ta tabbed continuation';
      const unfolded = unfoldHeaders(folded);
      expect(unfolded).toBe('Subject: This is a tabbed continuation');
    });

    it('should unfold headers with LF only', () => {
      const folded = 'Subject: Line one\n continues here';
      const unfolded = unfoldHeaders(folded);
      expect(unfolded).toBe('Subject: Line one continues here');
    });

    it('should handle multiple folds', () => {
      const folded = 'Subject: Part1\r\n Part2\r\n Part3';
      const unfolded = unfoldHeaders(folded);
      expect(unfolded).toBe('Subject: Part1 Part2 Part3');
    });
  });

  describe('Header Parsing', () => {
    it('should parse simple headers', () => {
      const headerBlock = 'From: sender@example.com\r\nTo: recipient@example.com';
      const headers = parseHeaders(headerBlock);
      expect(headers.get('from')).toBe('sender@example.com');
      expect(headers.get('to')).toBe('recipient@example.com');
    });

    it('should handle case-insensitive header names', () => {
      const headerBlock = 'FROM: test@example.com\r\nContent-Type: text/plain';
      const headers = parseHeaders(headerBlock);
      expect(headers.get('from')).toBe('test@example.com');
      expect(headers.get('content-type')).toBe('text/plain');
    });

    it('should handle multiple values for same header', () => {
      const headerBlock = 'Received: from server1\r\nReceived: from server2';
      const headers = parseHeaders(headerBlock);
      const received = headers.get('received');
      expect(Array.isArray(received)).toBe(true);
      expect(received).toHaveLength(2);
    });

    it('should decode encoded words in headers', () => {
      const headerBlock = 'Subject: =?UTF-8?B?SGVsbG8=?=';
      const headers = parseHeaders(headerBlock);
      expect(headers.get('subject')).toBe('Hello');
    });
  });

  describe('Content-Type Parsing', () => {
    it('should parse simple content type', () => {
      const { type, subtype, params } = parseContentType('text/plain');
      expect(type).toBe('text');
      expect(subtype).toBe('plain');
      expect(Object.keys(params)).toHaveLength(0);
    });

    it('should parse content type with charset', () => {
      const { type, subtype, params } = parseContentType('text/html; charset=utf-8');
      expect(type).toBe('text');
      expect(subtype).toBe('html');
      expect(params.charset).toBe('utf-8');
    });

    it('should parse content type with quoted parameter', () => {
      const { params } = parseContentType('multipart/mixed; boundary="----=_Part_123"');
      expect(params.boundary).toBe('----=_Part_123');
    });

    it('should parse content type with multiple parameters', () => {
      const { params } = parseContentType('text/plain; charset=utf-8; format=flowed');
      expect(params.charset).toBe('utf-8');
      expect(params.format).toBe('flowed');
    });

    it('should handle case-insensitive type/subtype', () => {
      const { type, subtype } = parseContentType('TEXT/HTML');
      expect(type).toBe('text');
      expect(subtype).toBe('html');
    });
  });

  describe('Header Parameter Extraction', () => {
    it('should extract unquoted parameter', () => {
      const value = 'attachment; filename=document.pdf';
      expect(extractHeaderParam(value, 'filename')).toBe('document.pdf');
    });

    it('should extract quoted parameter', () => {
      const value = 'attachment; filename="my document.pdf"';
      expect(extractHeaderParam(value, 'filename')).toBe('my document.pdf');
    });

    it('should return undefined for missing parameter', () => {
      const value = 'attachment; filename=test.pdf';
      expect(extractHeaderParam(value, 'charset')).toBeUndefined();
    });

    it('should handle case-insensitive parameter names', () => {
      const value = 'text/plain; CHARSET=utf-8';
      expect(extractHeaderParam(value, 'charset')).toBe('utf-8');
    });
  });
});

describe('MIME Part Parsing', () => {
  it('should parse simple text part', () => {
    const rawPart = [
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: 7bit',
      '',
      'Hello, World!'
    ].join('\r\n');

    const part = parseMimePart(rawPart);
    expect(part.contentType.type).toBe('text');
    expect(part.contentType.subtype).toBe('plain');
    expect(part.encoding).toBe('7bit');
    expect(part.body).toBe('Hello, World!');
  });

  it('should parse base64 encoded part', () => {
    const rawPart = [
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: base64',
      '',
      'SGVsbG8gV29ybGQ='
    ].join('\r\n');

    const part = parseMimePart(rawPart);
    expect(part.encoding).toBe('base64');
    expect(part.body.toString()).toBe('Hello World');
  });

  it('should parse quoted-printable encoded part', () => {
    const rawPart = [
      'Content-Type: text/plain',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      'Hello=20World'
    ].join('\r\n');

    const part = parseMimePart(rawPart);
    expect(part.body.toString()).toBe('Hello World');
  });

  it('should handle part with no body', () => {
    const rawPart = 'Content-Type: text/plain';
    const part = parseMimePart(rawPart);
    expect(part.body).toBe('');
  });

  it('should default to text/plain when no content-type', () => {
    const rawPart = [
      '',
      'Just some text'
    ].join('\r\n');

    const part = parseMimePart(rawPart);
    expect(part.contentType.type).toBe('text');
    expect(part.contentType.subtype).toBe('plain');
  });
});
