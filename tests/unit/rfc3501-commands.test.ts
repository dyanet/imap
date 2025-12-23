/**
 * RFC 3501 Command Format Compliance Tests
 * 
 * Verifies command syntax matches RFC 3501 Section 6 examples.
 * Tests SEARCH criteria formatting per RFC 3501 Section 6.4.4.
 * Tests FETCH item formatting per RFC 3501 Section 6.4.5.
 * 
 * Requirements: 3.2, 4.1, 4.2, 7.1
 */

import { describe, it, expect } from 'vitest';
import { CommandBuilder } from '../../src/commands/builder.js';
import type { SearchCriteria, FetchOptions } from '../../src/types/search.js';

describe('RFC 3501 Command Format Compliance', () => {
  describe('Section 6.2 - Client Commands - Any State', () => {
    describe('NOOP Command', () => {
      it('should generate correct NOOP command', () => {
        const cmd = CommandBuilder.noop();
        expect(cmd).toBe('NOOP');
      });
    });

    describe('LOGOUT Command', () => {
      it('should generate correct LOGOUT command', () => {
        const cmd = CommandBuilder.logout();
        expect(cmd).toBe('LOGOUT');
      });
    });
  });

  describe('Section 6.2.3 - LOGIN Command', () => {
    it('should generate LOGIN with simple credentials', () => {
      const cmd = CommandBuilder.login('user', 'password');
      expect(cmd).toBe('LOGIN user password');
    });

    it('should quote username with spaces', () => {
      const cmd = CommandBuilder.login('user name', 'password');
      expect(cmd).toBe('LOGIN "user name" password');
    });

    it('should quote password with spaces', () => {
      const cmd = CommandBuilder.login('user', 'pass word');
      expect(cmd).toBe('LOGIN user "pass word"');
    });

    it('should escape quotes in credentials', () => {
      const cmd = CommandBuilder.login('user"name', 'pass"word');
      expect(cmd).toBe('LOGIN "user\\"name" "pass\\"word"');
    });

    it('should escape backslashes in credentials', () => {
      const cmd = CommandBuilder.login('user\\name', 'pass\\word');
      expect(cmd).toBe('LOGIN "user\\\\name" "pass\\\\word"');
    });

    it('should handle empty password', () => {
      const cmd = CommandBuilder.login('user', '');
      expect(cmd).toBe('LOGIN user ""');
    });
  });

  describe('Section 6.3 - Client Commands - Authenticated State', () => {
    describe('SELECT Command (Section 6.3.1)', () => {
      it('should generate SELECT for simple mailbox', () => {
        const cmd = CommandBuilder.select('INBOX');
        expect(cmd).toBe('SELECT INBOX');
      });

      it('should quote mailbox with spaces', () => {
        const cmd = CommandBuilder.select('Sent Items');
        expect(cmd).toBe('SELECT "Sent Items"');
      });

      it('should handle hierarchical mailbox names', () => {
        const cmd = CommandBuilder.select('INBOX/Subfolder');
        expect(cmd).toBe('SELECT INBOX/Subfolder');
      });
    });

    describe('EXAMINE Command (Section 6.3.2)', () => {
      it('should generate EXAMINE command', () => {
        const cmd = CommandBuilder.examine('INBOX');
        expect(cmd).toBe('EXAMINE INBOX');
      });

      it('should quote mailbox with spaces', () => {
        const cmd = CommandBuilder.examine('Sent Items');
        expect(cmd).toBe('EXAMINE "Sent Items"');
      });
    });

    describe('CREATE Command (Section 6.3.3)', () => {
      it('should generate CREATE command', () => {
        const cmd = CommandBuilder.create('NewFolder');
        expect(cmd).toBe('CREATE NewFolder');
      });

      it('should quote folder with spaces', () => {
        const cmd = CommandBuilder.create('New Folder');
        expect(cmd).toBe('CREATE "New Folder"');
      });
    });

    describe('DELETE Command (Section 6.3.4)', () => {
      it('should generate DELETE command', () => {
        const cmd = CommandBuilder.delete('OldFolder');
        expect(cmd).toBe('DELETE OldFolder');
      });
    });

    describe('RENAME Command (Section 6.3.5)', () => {
      it('should generate RENAME command', () => {
        const cmd = CommandBuilder.rename('OldName', 'NewName');
        expect(cmd).toBe('RENAME OldName NewName');
      });

      it('should quote names with spaces', () => {
        const cmd = CommandBuilder.rename('Old Name', 'New Name');
        expect(cmd).toBe('RENAME "Old Name" "New Name"');
      });
    });

    describe('LIST Command (Section 6.3.8)', () => {
      it('should generate LIST for all mailboxes', () => {
        const cmd = CommandBuilder.list('', '*');
        expect(cmd).toBe('LIST "" "*"');
      });

      it('should generate LIST for top-level mailboxes', () => {
        const cmd = CommandBuilder.list('', '%');
        expect(cmd).toBe('LIST "" "%"');
      });

      it('should generate LIST with reference', () => {
        const cmd = CommandBuilder.list('INBOX', '*');
        expect(cmd).toBe('LIST INBOX "*"');
      });
    });
  });

  describe('Section 6.4.4 - SEARCH Command', () => {
    describe('Simple Search Keys', () => {
      it('should generate SEARCH ALL', () => {
        const cmd = CommandBuilder.search(['ALL']);
        expect(cmd).toBe('SEARCH ALL');
      });

      it('should generate SEARCH with empty criteria as ALL', () => {
        const cmd = CommandBuilder.search([]);
        expect(cmd).toBe('SEARCH ALL');
      });

      it('should generate SEARCH UNSEEN', () => {
        const cmd = CommandBuilder.search(['UNSEEN']);
        expect(cmd).toBe('SEARCH UNSEEN');
      });

      it('should generate SEARCH SEEN', () => {
        const cmd = CommandBuilder.search(['SEEN']);
        expect(cmd).toBe('SEARCH SEEN');
      });

      it('should generate SEARCH FLAGGED', () => {
        const cmd = CommandBuilder.search(['FLAGGED']);
        expect(cmd).toBe('SEARCH FLAGGED');
      });

      it('should generate SEARCH UNFLAGGED', () => {
        const cmd = CommandBuilder.search(['UNFLAGGED']);
        expect(cmd).toBe('SEARCH UNFLAGGED');
      });

      it('should generate SEARCH ANSWERED', () => {
        const cmd = CommandBuilder.search(['ANSWERED']);
        expect(cmd).toBe('SEARCH ANSWERED');
      });

      it('should generate SEARCH UNANSWERED', () => {
        const cmd = CommandBuilder.search(['UNANSWERED']);
        expect(cmd).toBe('SEARCH UNANSWERED');
      });

      it('should generate SEARCH DELETED', () => {
        const cmd = CommandBuilder.search(['DELETED']);
        expect(cmd).toBe('SEARCH DELETED');
      });

      it('should generate SEARCH UNDELETED', () => {
        const cmd = CommandBuilder.search(['UNDELETED']);
        expect(cmd).toBe('SEARCH UNDELETED');
      });

      it('should generate SEARCH DRAFT', () => {
        const cmd = CommandBuilder.search(['DRAFT']);
        expect(cmd).toBe('SEARCH DRAFT');
      });

      it('should generate SEARCH NEW', () => {
        const cmd = CommandBuilder.search(['NEW']);
        expect(cmd).toBe('SEARCH NEW');
      });

      it('should generate SEARCH OLD', () => {
        const cmd = CommandBuilder.search(['OLD']);
        expect(cmd).toBe('SEARCH OLD');
      });

      it('should generate SEARCH RECENT', () => {
        const cmd = CommandBuilder.search(['RECENT']);
        expect(cmd).toBe('SEARCH RECENT');
      });
    });

    describe('Address Search Keys', () => {
      it('should generate SEARCH FROM', () => {
        const cmd = CommandBuilder.search([['FROM', 'sender@example.com']]);
        expect(cmd).toBe('SEARCH FROM sender@example.com');
      });

      it('should quote FROM with spaces', () => {
        const cmd = CommandBuilder.search([['FROM', 'John Doe']]);
        expect(cmd).toBe('SEARCH FROM "John Doe"');
      });

      it('should generate SEARCH TO', () => {
        const cmd = CommandBuilder.search([['TO', 'recipient@example.com']]);
        expect(cmd).toBe('SEARCH TO recipient@example.com');
      });

      it('should generate SEARCH CC', () => {
        const cmd = CommandBuilder.search([['CC', 'cc@example.com']]);
        expect(cmd).toBe('SEARCH CC cc@example.com');
      });

      it('should generate SEARCH BCC', () => {
        const cmd = CommandBuilder.search([['BCC', 'bcc@example.com']]);
        expect(cmd).toBe('SEARCH BCC bcc@example.com');
      });
    });

    describe('Content Search Keys', () => {
      it('should generate SEARCH SUBJECT', () => {
        const cmd = CommandBuilder.search([['SUBJECT', 'test']]);
        expect(cmd).toBe('SEARCH SUBJECT test');
      });

      it('should quote SUBJECT with spaces', () => {
        const cmd = CommandBuilder.search([['SUBJECT', 'test subject']]);
        expect(cmd).toBe('SEARCH SUBJECT "test subject"');
      });

      it('should generate SEARCH BODY', () => {
        const cmd = CommandBuilder.search([['BODY', 'content']]);
        expect(cmd).toBe('SEARCH BODY content');
      });

      it('should generate SEARCH TEXT', () => {
        const cmd = CommandBuilder.search([['TEXT', 'anywhere']]);
        expect(cmd).toBe('SEARCH TEXT anywhere');
      });
    });

    describe('Date Search Keys', () => {
      it('should generate SEARCH SINCE with correct date format', () => {
        // Use explicit date components to avoid timezone issues
        const date = new Date(2024, 2, 15); // March 15, 2024 (month is 0-indexed)
        const cmd = CommandBuilder.search([['SINCE', date]]);
        expect(cmd).toBe('SEARCH SINCE 15-Mar-2024');
      });

      it('should generate SEARCH BEFORE', () => {
        const date = new Date(2024, 0, 1); // January 1, 2024
        const cmd = CommandBuilder.search([['BEFORE', date]]);
        expect(cmd).toBe('SEARCH BEFORE 1-Jan-2024');
      });

      it('should generate SEARCH ON', () => {
        const date = new Date(2024, 5, 15); // June 15, 2024
        const cmd = CommandBuilder.search([['ON', date]]);
        expect(cmd).toBe('SEARCH ON 15-Jun-2024');
      });

      it('should generate SEARCH SENTSINCE', () => {
        const date = new Date(2024, 11, 25); // December 25, 2024
        const cmd = CommandBuilder.search([['SENTSINCE', date]]);
        expect(cmd).toBe('SEARCH SENTSINCE 25-Dec-2024');
      });

      it('should generate SEARCH SENTBEFORE', () => {
        const date = new Date(2024, 6, 4); // July 4, 2024
        const cmd = CommandBuilder.search([['SENTBEFORE', date]]);
        expect(cmd).toBe('SEARCH SENTBEFORE 4-Jul-2024');
      });

      it('should generate SEARCH SENTON', () => {
        const date = new Date(2024, 10, 11); // November 11, 2024
        const cmd = CommandBuilder.search([['SENTON', date]]);
        expect(cmd).toBe('SEARCH SENTON 11-Nov-2024');
      });
    });

    describe('Size Search Keys', () => {
      it('should generate SEARCH LARGER', () => {
        const cmd = CommandBuilder.search([['LARGER', 1024]]);
        expect(cmd).toBe('SEARCH LARGER 1024');
      });

      it('should generate SEARCH SMALLER', () => {
        const cmd = CommandBuilder.search([['SMALLER', 5000]]);
        expect(cmd).toBe('SEARCH SMALLER 5000');
      });
    });

    describe('UID Search Key', () => {
      it('should generate SEARCH UID', () => {
        const cmd = CommandBuilder.search([['UID', '1:100']]);
        expect(cmd).toBe('SEARCH UID 1:100');
      });

      it('should generate SEARCH UID with sequence set', () => {
        const cmd = CommandBuilder.search([['UID', '1,5,10:20']]);
        expect(cmd).toBe('SEARCH UID 1,5,10:20');
      });
    });

    describe('HEADER Search Key', () => {
      it('should generate SEARCH HEADER', () => {
        const cmd = CommandBuilder.search([['HEADER', 'X-Custom', 'value']]);
        expect(cmd).toBe('SEARCH HEADER X-Custom value');
      });

      it('should quote HEADER values with spaces', () => {
        const cmd = CommandBuilder.search([['HEADER', 'X-Custom', 'some value']]);
        expect(cmd).toBe('SEARCH HEADER X-Custom "some value"');
      });
    });

    describe('Combined Search Criteria (AND logic)', () => {
      it('should combine multiple simple criteria', () => {
        const cmd = CommandBuilder.search(['UNSEEN', 'FLAGGED']);
        expect(cmd).toBe('SEARCH UNSEEN FLAGGED');
      });

      it('should combine simple and complex criteria', () => {
        const cmd = CommandBuilder.search(['UNSEEN', ['FROM', 'test@example.com']]);
        expect(cmd).toBe('SEARCH UNSEEN FROM test@example.com');
      });

      it('should combine multiple complex criteria', () => {
        const date = new Date(2024, 0, 1); // January 1, 2024
        const criteria: SearchCriteria[] = [
          ['FROM', 'sender@example.com'],
          ['SINCE', date],
          ['SUBJECT', 'important']
        ];
        const cmd = CommandBuilder.search(criteria);
        expect(cmd).toBe('SEARCH FROM sender@example.com SINCE 1-Jan-2024 SUBJECT important');
      });
    });
  });

  describe('Section 6.4.5 - FETCH Command', () => {
    describe('Basic FETCH Items', () => {
      it('should always include UID and FLAGS', () => {
        const cmd = CommandBuilder.fetch('1:*', {});
        expect(cmd).toContain('UID');
        expect(cmd).toContain('FLAGS');
      });

      it('should generate FETCH with sequence number', () => {
        const cmd = CommandBuilder.fetch('1', {});
        expect(cmd).toMatch(/^FETCH 1 \(/);
      });

      it('should generate FETCH with sequence range', () => {
        const cmd = CommandBuilder.fetch('1:10', {});
        expect(cmd).toMatch(/^FETCH 1:10 \(/);
      });

      it('should generate FETCH with sequence set', () => {
        const cmd = CommandBuilder.fetch('1,5,10:20', {});
        expect(cmd).toMatch(/^FETCH 1,5,10:20 \(/);
      });
    });

    describe('BODY Fetch Items', () => {
      it('should generate BODY.PEEK[HEADER] for headers', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: 'HEADER' });
        expect(cmd).toContain('BODY.PEEK[HEADER]');
      });

      it('should generate BODY.PEEK[TEXT] for text', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: 'TEXT' });
        expect(cmd).toContain('BODY.PEEK[TEXT]');
      });

      it('should not add body part for empty string bodies option', () => {
        // Empty string bodies option doesn't add any body parts
        const cmd = CommandBuilder.fetch('1', { bodies: '' });
        // Should only have UID and FLAGS, no BODY parts
        expect(cmd).toBe('FETCH 1 (UID FLAGS)');
      });

      it('should generate BODY.PEEK[] for FULL', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: 'FULL' });
        expect(cmd).toContain('BODY.PEEK[]');
      });

      it('should generate BODY[] (without PEEK) when markSeen is true', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: 'HEADER', markSeen: true });
        expect(cmd).toContain('BODY[HEADER]');
        expect(cmd).not.toContain('BODY.PEEK');
      });

      it('should handle multiple body parts', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: ['HEADER', 'TEXT'] });
        expect(cmd).toContain('BODY.PEEK[HEADER]');
        expect(cmd).toContain('BODY.PEEK[TEXT]');
      });

      it('should handle specific part numbers', () => {
        const cmd = CommandBuilder.fetch('1', { bodies: '1.2' });
        expect(cmd).toContain('BODY.PEEK[1.2]');
      });
    });

    describe('Structure Fetch Items', () => {
      it('should include BODYSTRUCTURE when struct is true', () => {
        const cmd = CommandBuilder.fetch('1', { struct: true });
        expect(cmd).toContain('BODYSTRUCTURE');
      });

      it('should not include BODYSTRUCTURE when struct is false', () => {
        const cmd = CommandBuilder.fetch('1', { struct: false });
        expect(cmd).not.toContain('BODYSTRUCTURE');
      });
    });

    describe('Envelope Fetch Items', () => {
      it('should include ENVELOPE when envelope is true', () => {
        const cmd = CommandBuilder.fetch('1', { envelope: true });
        expect(cmd).toContain('ENVELOPE');
      });

      it('should not include ENVELOPE when envelope is false', () => {
        const cmd = CommandBuilder.fetch('1', { envelope: false });
        expect(cmd).not.toContain('ENVELOPE');
      });
    });

    describe('Size Fetch Items', () => {
      it('should include RFC822.SIZE when size is true', () => {
        const cmd = CommandBuilder.fetch('1', { size: true });
        expect(cmd).toContain('RFC822.SIZE');
      });

      it('should not include RFC822.SIZE when size is false', () => {
        const cmd = CommandBuilder.fetch('1', { size: false });
        expect(cmd).not.toContain('RFC822.SIZE');
      });
    });

    describe('Combined Fetch Options', () => {
      it('should combine all fetch options', () => {
        const options: FetchOptions = {
          bodies: ['HEADER', 'TEXT'],
          struct: true,
          envelope: true,
          size: true
        };
        const cmd = CommandBuilder.fetch('1:*', options);
        
        expect(cmd).toContain('UID');
        expect(cmd).toContain('FLAGS');
        expect(cmd).toContain('BODY.PEEK[HEADER]');
        expect(cmd).toContain('BODY.PEEK[TEXT]');
        expect(cmd).toContain('BODYSTRUCTURE');
        expect(cmd).toContain('ENVELOPE');
        expect(cmd).toContain('RFC822.SIZE');
      });
    });
  });

  describe('Section 6.4.6 - STORE Command', () => {
    describe('Adding Flags', () => {
      it('should generate +FLAGS for adding flags', () => {
        const cmd = CommandBuilder.store('1:*', ['\\Seen'], 'add');
        expect(cmd).toBe('STORE 1:* +FLAGS (\\Seen)');
      });

      it('should handle multiple flags', () => {
        const cmd = CommandBuilder.store('1', ['\\Seen', '\\Flagged'], 'add');
        expect(cmd).toBe('STORE 1 +FLAGS (\\Seen \\Flagged)');
      });

      it('should handle all standard flags', () => {
        const flags = ['\\Seen', '\\Answered', '\\Flagged', '\\Deleted', '\\Draft'];
        const cmd = CommandBuilder.store('1', flags, 'add');
        expect(cmd).toContain('+FLAGS');
        flags.forEach(flag => expect(cmd).toContain(flag));
      });
    });

    describe('Removing Flags', () => {
      it('should generate -FLAGS for removing flags', () => {
        const cmd = CommandBuilder.store('1:*', ['\\Seen'], 'remove');
        expect(cmd).toBe('STORE 1:* -FLAGS (\\Seen)');
      });

      it('should handle multiple flags removal', () => {
        const cmd = CommandBuilder.store('1', ['\\Seen', '\\Flagged'], 'remove');
        expect(cmd).toBe('STORE 1 -FLAGS (\\Seen \\Flagged)');
      });
    });

    describe('Sequence Sets', () => {
      it('should handle single message', () => {
        const cmd = CommandBuilder.store('5', ['\\Seen'], 'add');
        expect(cmd).toMatch(/^STORE 5 /);
      });

      it('should handle message range', () => {
        const cmd = CommandBuilder.store('1:10', ['\\Seen'], 'add');
        expect(cmd).toMatch(/^STORE 1:10 /);
      });

      it('should handle message set', () => {
        const cmd = CommandBuilder.store('1,5,10:20', ['\\Seen'], 'add');
        expect(cmd).toMatch(/^STORE 1,5,10:20 /);
      });
    });
  });

  describe('Section 6.4.7 - COPY Command', () => {
    it('should generate COPY command', () => {
      const cmd = CommandBuilder.copy('1:*', 'Archive');
      expect(cmd).toBe('COPY 1:* Archive');
    });

    it('should quote destination with spaces', () => {
      const cmd = CommandBuilder.copy('1', 'Sent Items');
      expect(cmd).toBe('COPY 1 "Sent Items"');
    });

    it('should handle sequence set', () => {
      const cmd = CommandBuilder.copy('1,5,10:20', 'Backup');
      expect(cmd).toBe('COPY 1,5,10:20 Backup');
    });
  });

  describe('Section 6.4.3 - EXPUNGE Command', () => {
    it('should generate EXPUNGE command', () => {
      const cmd = CommandBuilder.expunge();
      expect(cmd).toBe('EXPUNGE');
    });
  });

  describe('String Quoting Rules (Section 4.3)', () => {
    it('should not quote simple atoms', () => {
      const cmd = CommandBuilder.select('INBOX');
      expect(cmd).toBe('SELECT INBOX');
    });

    it('should quote strings with spaces', () => {
      const cmd = CommandBuilder.select('My Folder');
      expect(cmd).toBe('SELECT "My Folder"');
    });

    it('should quote empty strings', () => {
      const cmd = CommandBuilder.list('', '*');
      expect(cmd).toContain('""');
    });

    it('should escape embedded quotes', () => {
      const cmd = CommandBuilder.select('Folder"Name');
      expect(cmd).toBe('SELECT "Folder\\"Name"');
    });

    it('should escape embedded backslashes', () => {
      const cmd = CommandBuilder.select('Folder\\Name');
      expect(cmd).toBe('SELECT "Folder\\\\Name"');
    });

    it('should quote strings with special characters', () => {
      const cmd = CommandBuilder.select('Folder(Name)');
      expect(cmd).toBe('SELECT "Folder(Name)"');
    });
  });
});
