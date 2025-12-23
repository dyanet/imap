/**
 * XOAUTH2 Authentication Tests
 * 
 * Tests for OAuth2/XOAUTH2 authentication per RFC 7628 and provider-specific specs.
 * Covers Gmail and Microsoft 365 XOAUTH2 formats.
 */

import { describe, it, expect } from 'vitest';
import { CommandBuilder, buildXOAuth2String } from '../../src/commands/builder';

describe('XOAUTH2 Authentication', () => {
  describe('buildXOAuth2String', () => {
    it('should build correct XOAUTH2 string format', () => {
      const user = 'user@example.com';
      const token = 'ya29.test-access-token';
      
      const result = buildXOAuth2String(user, token);
      
      // Decode to verify format
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${token}\x01\x01`);
    });

    it('should produce valid base64 output', () => {
      const result = buildXOAuth2String('test@gmail.com', 'token123');
      
      // Should be valid base64
      expect(() => Buffer.from(result, 'base64')).not.toThrow();
      // Should not contain invalid base64 characters
      expect(result).toMatch(/^[A-Za-z0-9+/]+=*$/);
    });

    it('should handle special characters in email', () => {
      const user = 'user+tag@example.com';
      const token = 'access-token';
      
      const result = buildXOAuth2String(user, token);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toContain(`user=${user}`);
    });

    it('should handle long access tokens', () => {
      const user = 'user@example.com';
      const token = 'a'.repeat(1000); // Long token
      
      const result = buildXOAuth2String(user, token);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${token}\x01\x01`);
    });
  });

  describe('CommandBuilder.authenticateXOAuth2', () => {
    it('should build AUTHENTICATE XOAUTH2 command', () => {
      const user = 'user@gmail.com';
      const token = 'ya29.test-token';
      
      const command = CommandBuilder.authenticateXOAuth2(user, token);
      
      expect(command).toMatch(/^AUTHENTICATE XOAUTH2 /);
      // Extract the base64 part
      const base64Part = command.replace('AUTHENTICATE XOAUTH2 ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${token}\x01\x01`);
    });

    it('should produce single-line command', () => {
      const command = CommandBuilder.authenticateXOAuth2('user@example.com', 'token');
      
      expect(command).not.toContain('\n');
      expect(command).not.toContain('\r');
    });
  });

  describe('Gmail XOAUTH2 Format', () => {
    // Gmail-specific XOAUTH2 format per Google's documentation
    // https://developers.google.com/gmail/imap/xoauth2-protocol
    
    it('should match Gmail XOAUTH2 format specification', () => {
      const user = 'someuser@gmail.com';
      const accessToken = 'ya29.vF9dft4qmTc2Nvb3RlckBhdHRhdmlzdGEuY29t';
      
      const result = buildXOAuth2String(user, accessToken);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      // Gmail format: user={user}\x01auth=Bearer {token}\x01\x01
      expect(decoded).toMatch(/^user=.+\x01auth=Bearer .+\x01\x01$/);
      expect(decoded.startsWith('user=')).toBe(true);
      expect(decoded).toContain('\x01auth=Bearer ');
      expect(decoded.endsWith('\x01\x01')).toBe(true);
    });

    it('should handle Gmail-style access tokens', () => {
      // Gmail access tokens typically start with 'ya29.'
      const user = 'testuser@gmail.com';
      const gmailToken = 'ya29.a0AfH6SMBx1234567890abcdefghijklmnop';
      
      const command = CommandBuilder.authenticateXOAuth2(user, gmailToken);
      
      expect(command).toMatch(/^AUTHENTICATE XOAUTH2 /);
      const base64Part = command.replace('AUTHENTICATE XOAUTH2 ', '');
      expect(base64Part.length).toBeGreaterThan(0);
    });

    it('should handle Google Workspace (G Suite) accounts', () => {
      const user = 'employee@company.com'; // Google Workspace domain
      const token = 'ya29.workspace-token';
      
      const result = buildXOAuth2String(user, token);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${token}\x01\x01`);
    });
  });

  describe('Microsoft 365 XOAUTH2 Format', () => {
    // Microsoft 365 uses the same XOAUTH2 format as Gmail
    // https://docs.microsoft.com/en-us/exchange/client-developer/legacy-protocols/how-to-authenticate-an-imap-pop-smtp-application-by-using-oauth
    
    it('should match Microsoft 365 XOAUTH2 format', () => {
      const user = 'user@contoso.onmicrosoft.com';
      const accessToken = 'eyJ0eXAiOiJKV1QiLCJhbGciOiJSUzI1NiIsIng1dCI6Ik5HVEZ2ZEstZnl0aEV1Q...';
      
      const result = buildXOAuth2String(user, accessToken);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      // Same format as Gmail
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${accessToken}\x01\x01`);
    });

    it('should handle Microsoft Entra (Azure AD) JWT tokens', () => {
      // Microsoft tokens are typically JWTs starting with 'eyJ'
      const user = 'user@outlook.com';
      const jwtToken = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
      
      const command = CommandBuilder.authenticateXOAuth2(user, jwtToken);
      
      expect(command).toMatch(/^AUTHENTICATE XOAUTH2 /);
      const base64Part = command.replace('AUTHENTICATE XOAUTH2 ', '');
      const decoded = Buffer.from(base64Part, 'base64').toString('utf8');
      expect(decoded).toContain(jwtToken);
    });

    it('should handle Office 365 business accounts', () => {
      const user = 'admin@company.onmicrosoft.com';
      const token = 'EwBwA8l6BAAUO9chh8cJscQLmU+LSWpbnr0vmwwAAQ...';
      
      const result = buildXOAuth2String(user, token);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toBe(`user=${user}\x01auth=Bearer ${token}\x01\x01`);
    });
  });

  describe('Error Handling', () => {
    it('should handle empty user', () => {
      const result = buildXOAuth2String('', 'token');
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toBe('user=\x01auth=Bearer token\x01\x01');
    });

    it('should handle empty token', () => {
      const result = buildXOAuth2String('user@example.com', '');
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toBe('user=user@example.com\x01auth=Bearer \x01\x01');
    });

    it('should handle unicode in email', () => {
      // Some email systems support unicode
      const user = 'üser@example.com';
      const token = 'token';
      
      const result = buildXOAuth2String(user, token);
      const decoded = Buffer.from(result, 'base64').toString('utf8');
      
      expect(decoded).toContain(user);
    });
  });
});
