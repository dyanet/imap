import { describe, it, expect } from 'vitest';
import { parseHeaders, unfoldHeaders } from '../../src/mime/header-parser';

describe('MIME Header Parser - Special Character Handling', () => {

  describe('Unicode characters', () => {
    it('should handle emoji in subject', () => {
      const headers = 'Subject: Hello 📧🎉\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello 📧🎉');
    });

    it('should handle non-ASCII characters', () => {
      const headers = 'Subject: 日本語 العربية עברית\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('日本語 العربية עברית');
    });

    it('should handle mixed scripts', () => {
      const headers = 'Subject: Hello 世界 مرحبا עולם\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello 世界 مرحبا עולם');
    });
  });

  describe('RFC 2047 encoded words', () => {

    it('should decode base64 encoded subject', () => {
      // "Hello World" in base64 UTF-8
      const headers = 'Subject: =?UTF-8?B?SGVsbG8gV29ybGQ=?=\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello World');
    });

    it('should decode quoted-printable encoded subject', () => {
      // "Hello World!" with Q-encoding
      const headers = 'Subject: =?UTF-8?Q?Hello_World!?=\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello World!');
    });

    it('should decode multiple encoded words in sequence', () => {
      const headers = 'Subject: =?UTF-8?B?SGVsbG8=?= =?UTF-8?B?V29ybGQ=?=\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello World');
    });

    it('should decode mixed encoded and plain text', () => {
      const headers = 'Subject: =?UTF-8?B?SGVsbG8=?= there\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('Hello there');
    });
  });

  describe('Edge cases', () => {

    it('should handle very long subjects (>998 chars)', () => {
      const longText = 'A'.repeat(1000);
      const headers = `Subject: ${longText}\r\nFrom: user@example.com`;
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe(longText);
    });

    it('should handle folded headers', () => {
      const headers = 'Subject: This is a folded\r\n header line\r\nFrom: user@example.com';
      const parsed = parseHeaders(headers);
      expect(parsed.get('subject')).toBe('This is a folded header line');
    });

    it('should handle special IMAP characters in subject', () => {
      const specialChars = 'Subject: [IMAP] Test <> () {} \\ " \r\nFrom: user@example.com';
      const parsed = parseHeaders(specialChars);
      expect(parsed.get('subject')).toBe('[IMAP] Test <> () {} \\ "');
    });

    it('should not throw on malformed headers', () => {
      const malformed = 'Subject =?UTF-8?B?SGVsbG8=?=\r\nFrom: user@example.com';
      expect(() => parseHeaders(malformed)).not.toThrow();
      const parsed = parseHeaders(malformed);
      expect(parsed.get('subject')).toBeUndefined(); // fallback behavior
    });

  });

  describe('Unfold headers utility', () => {
    it('should unfold CRLF and LF headers', () => {
      const folded = 'Subject: line1\r\n line2\n\tline3\r\nFrom: user@example.com';
      const unfolded = unfoldHeaders(folded);
      expect(unfolded).toBe('Subject: line1 line2 line3\r\nFrom: user@example.com');
    });
  });

});