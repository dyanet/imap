/**
 * RFC 3501 Protocol Compliance Unit Tests
 * 
 * Tests IMAP4rev1 response format examples from RFC 3501 Section 7.
 * Verifies correct parsing of formal syntax examples (atoms, strings, literals).
 * Tests edge cases: NIL handling, nested lists, special characters.
 * 
 * Requirements: 1.1, 7.1
 */

import { describe, it, expect } from 'vitest';
import { tokenize, getTokenValue, isListToken, type Token } from '../../src/protocol/tokenizer.js';
import {
  parseTaggedResponse,
  parseUntaggedResponse,
  isTaggedResponse,
  isContinuationResponse,
  parseResponse
} from '../../src/protocol/parser.js';

describe('RFC 3501 Protocol Compliance', () => {
  describe('Section 4.3 - String Formats', () => {
    describe('Quoted Strings', () => {
      it('should parse simple quoted string', () => {
        const { tokens } = tokenize('"hello"');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('quoted');
        expect(tokens[0].value).toBe('hello');
      });

      it('should parse quoted string with spaces', () => {
        const { tokens } = tokenize('"hello world"');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('quoted');
        expect(tokens[0].value).toBe('hello world');
      });

      it('should parse quoted string with escaped quote', () => {
        const { tokens } = tokenize('"say \\"hello\\""');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('quoted');
        expect(tokens[0].value).toBe('say "hello"');
      });

      it('should parse quoted string with escaped backslash', () => {
        const { tokens } = tokenize('"path\\\\to\\\\file"');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('quoted');
        expect(tokens[0].value).toBe('path\\to\\file');
      });

      it('should parse empty quoted string', () => {
        const { tokens } = tokenize('""');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('quoted');
        expect(tokens[0].value).toBe('');
      });
    });

    describe('Literals', () => {
      it('should parse literal marker', () => {
        const { tokens } = tokenize('{10}');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('literal');
        expect(tokens[0].value).toBe('10');
      });

      it('should parse literal with large size', () => {
        const { tokens } = tokenize('{1234567}');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('literal');
        expect(tokens[0].value).toBe('1234567');
      });
    });

    describe('Atoms', () => {
      it('should parse simple atom', () => {
        const { tokens } = tokenize('INBOX');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('atom');
        expect(tokens[0].value).toBe('INBOX');
      });

      it('should parse atom with numbers', () => {
        const { tokens } = tokenize('RFC822');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('atom');
        expect(tokens[0].value).toBe('RFC822');
      });

      it('should parse multiple atoms', () => {
        const { tokens } = tokenize('FETCH BODY HEADER');
        expect(tokens).toHaveLength(3);
        expect(tokens.map(t => t.value)).toEqual(['FETCH', 'BODY', 'HEADER']);
      });
    });

    describe('NIL', () => {
      it('should parse NIL as null', () => {
        const { tokens } = tokenize('NIL');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('nil');
        expect(tokens[0].value).toBeNull();
      });

      it('should parse nil (lowercase) as null', () => {
        const { tokens } = tokenize('nil');
        expect(tokens).toHaveLength(1);
        expect(tokens[0].type).toBe('nil');
        expect(tokens[0].value).toBeNull();
      });

      it('should parse NIL in list context', () => {
        const { tokens } = tokenize('(NIL NIL "value")');
        expect(tokens).toHaveLength(1);
        expect(isListToken(tokens[0])).toBe(true);
        const list = tokens[0].value as Token[];
        expect(list[0].type).toBe('nil');
        expect(list[1].type).toBe('nil');
        expect(list[2].type).toBe('quoted');
      });
    });
  });

  describe('Section 4.4 - Parenthesized Lists', () => {
    it('should parse empty list', () => {
      const { tokens } = tokenize('()');
      expect(tokens).toHaveLength(1);
      expect(isListToken(tokens[0])).toBe(true);
      expect((tokens[0].value as Token[])).toHaveLength(0);
    });

    it('should parse simple list', () => {
      const { tokens } = tokenize('(\\Seen \\Flagged)');
      expect(tokens).toHaveLength(1);
      expect(isListToken(tokens[0])).toBe(true);
      const list = tokens[0].value as Token[];
      expect(list).toHaveLength(2);
      expect(getTokenValue(list[0])).toBe('\\Seen');
      expect(getTokenValue(list[1])).toBe('\\Flagged');
    });

    it('should parse nested lists', () => {
      const { tokens } = tokenize('((a b) (c d))');
      expect(tokens).toHaveLength(1);
      expect(isListToken(tokens[0])).toBe(true);
      const outer = tokens[0].value as Token[];
      expect(outer).toHaveLength(2);
      expect(isListToken(outer[0])).toBe(true);
      expect(isListToken(outer[1])).toBe(true);
    });

    it('should parse deeply nested lists', () => {
      const { tokens } = tokenize('(((deep)))');
      expect(tokens).toHaveLength(1);
      const level1 = tokens[0].value as Token[];
      expect(isListToken(level1[0])).toBe(true);
      const level2 = level1[0].value as Token[];
      expect(isListToken(level2[0])).toBe(true);
      const level3 = level2[0].value as Token[];
      expect(getTokenValue(level3[0])).toBe('deep');
    });

    it('should parse mixed content list', () => {
      const { tokens } = tokenize('(ATOM "quoted" NIL 123)');
      expect(tokens).toHaveLength(1);
      const list = tokens[0].value as Token[];
      expect(list).toHaveLength(4);
      expect(list[0].type).toBe('atom');
      expect(list[1].type).toBe('quoted');
      expect(list[2].type).toBe('nil');
      expect(list[3].type).toBe('atom');
    });
  });

  describe('Section 7.1 - Server Responses - Status Responses', () => {
    describe('Tagged Responses', () => {
      it('should parse OK response', () => {
        const response = parseTaggedResponse('A001 OK LOGIN completed');
        expect(response.tag).toBe('A001');
        expect(response.status).toBe('OK');
        expect(response.text).toBe('LOGIN completed');
      });

      it('should parse NO response', () => {
        const response = parseTaggedResponse('A002 NO Invalid credentials');
        expect(response.tag).toBe('A002');
        expect(response.status).toBe('NO');
        expect(response.text).toBe('Invalid credentials');
      });

      it('should parse BAD response', () => {
        const response = parseTaggedResponse('A003 BAD Command syntax error');
        expect(response.tag).toBe('A003');
        expect(response.status).toBe('BAD');
        expect(response.text).toBe('Command syntax error');
      });

      it('should handle response codes in brackets', () => {
        const response = parseTaggedResponse('A004 OK [READ-WRITE] SELECT completed');
        expect(response.tag).toBe('A004');
        expect(response.status).toBe('OK');
        expect(response.text).toBe('[READ-WRITE] SELECT completed');
      });
    });

    describe('Untagged Responses', () => {
      it('should parse OK greeting', () => {
        const response = parseUntaggedResponse('* OK IMAP4rev1 Service Ready');
        expect(response.type).toBe('OK');
        expect((response.data as { text: string }).text).toBe('IMAP4rev1 Service Ready');
      });

      it('should parse BYE response', () => {
        const response = parseUntaggedResponse('* BYE Server shutting down');
        expect(response.type).toBe('BYE');
        expect((response.data as { text: string }).text).toBe('Server shutting down');
      });

      it('should parse PREAUTH response', () => {
        const response = parseUntaggedResponse('* PREAUTH IMAP4rev1 server logged in as user');
        expect(response.type).toBe('PREAUTH');
      });
    });
  });

  describe('Section 7.2 - Server Responses - Server and Mailbox Status', () => {
    describe('CAPABILITY Response', () => {
      it('should parse CAPABILITY response', () => {
        const response = parseUntaggedResponse('* CAPABILITY IMAP4rev1 STARTTLS AUTH=PLAIN');
        expect(response.type).toBe('CAPABILITY');
        expect(response.data).toEqual(['IMAP4rev1', 'STARTTLS', 'AUTH=PLAIN']);
      });

      it('should parse CAPABILITY with many extensions', () => {
        const response = parseUntaggedResponse('* CAPABILITY IMAP4rev1 LITERAL+ IDLE NAMESPACE CHILDREN');
        expect(response.type).toBe('CAPABILITY');
        expect(response.data).toContain('IMAP4rev1');
        expect(response.data).toContain('IDLE');
      });
    });

    describe('LIST Response', () => {
      it('should parse LIST response with attributes', () => {
        const response = parseUntaggedResponse('* LIST (\\HasNoChildren) "/" "INBOX"');
        expect(response.type).toBe('LIST');
        const data = response.data as { attributes: string[]; delimiter: string; name: string };
        expect(data.attributes).toContain('\\HasNoChildren');
        expect(data.delimiter).toBe('/');
        expect(data.name).toBe('INBOX');
      });

      it('should parse LIST response with NIL delimiter', () => {
        const response = parseUntaggedResponse('* LIST (\\Noselect) NIL ""');
        expect(response.type).toBe('LIST');
        const data = response.data as { attributes: string[]; delimiter: string | null; name: string };
        expect(data.delimiter).toBeNull();
      });

      it('should parse LIST response with multiple attributes', () => {
        const response = parseUntaggedResponse('* LIST (\\HasChildren \\Noselect) "." "Public Folders"');
        expect(response.type).toBe('LIST');
        const data = response.data as { attributes: string[]; delimiter: string; name: string };
        expect(data.attributes).toContain('\\HasChildren');
        expect(data.attributes).toContain('\\Noselect');
      });
    });

    describe('FLAGS Response', () => {
      it('should parse FLAGS response', () => {
        const response = parseUntaggedResponse('* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)');
        expect(response.type).toBe('FLAGS');
        expect(response.data).toContain('\\Answered');
        expect(response.data).toContain('\\Seen');
      });
    });
  });

  describe('Section 7.3 - Server Responses - Mailbox Size', () => {
    it('should parse EXISTS response', () => {
      const response = parseUntaggedResponse('* 172 EXISTS');
      expect(response.type).toBe('EXISTS');
      expect((response.data as { number: number }).number).toBe(172);
    });

    it('should parse RECENT response', () => {
      const response = parseUntaggedResponse('* 5 RECENT');
      expect(response.type).toBe('RECENT');
      expect((response.data as { number: number }).number).toBe(5);
    });

    it('should parse zero EXISTS', () => {
      const response = parseUntaggedResponse('* 0 EXISTS');
      expect(response.type).toBe('EXISTS');
      expect((response.data as { number: number }).number).toBe(0);
    });
  });

  describe('Section 7.4 - Server Responses - Message Status', () => {
    describe('EXPUNGE Response', () => {
      it('should parse EXPUNGE response', () => {
        const response = parseUntaggedResponse('* 3 EXPUNGE');
        expect(response.type).toBe('EXPUNGE');
        expect((response.data as { number: number }).number).toBe(3);
      });
    });

    describe('FETCH Response', () => {
      it('should parse simple FETCH response', () => {
        const response = parseUntaggedResponse('* 1 FETCH (UID 123 FLAGS (\\Seen))');
        expect(response.type).toBe('FETCH');
        const data = response.data as { seqno: number; attributes: Record<string, unknown> };
        expect(data.seqno).toBe(1);
        expect(data.attributes.UID).toBe('123');
      });

      it('should parse FETCH with multiple attributes', () => {
        const response = parseUntaggedResponse('* 2 FETCH (UID 456 FLAGS (\\Seen \\Answered) RFC822.SIZE 1024)');
        expect(response.type).toBe('FETCH');
        const data = response.data as { seqno: number; attributes: Record<string, unknown> };
        expect(data.seqno).toBe(2);
        expect(data.attributes.UID).toBe('456');
        expect(data.attributes['RFC822.SIZE']).toBe('1024');
      });
    });
  });

  describe('Section 7.5 - Server Responses - Command Continuation Request', () => {
    it('should identify continuation response', () => {
      expect(isContinuationResponse('+ Ready for literal data')).toBe(true);
      expect(isContinuationResponse('+')).toBe(true);
      expect(isContinuationResponse('+ ')).toBe(true);
    });

    it('should not identify non-continuation as continuation', () => {
      expect(isContinuationResponse('* OK Ready')).toBe(false);
      expect(isContinuationResponse('A001 OK Done')).toBe(false);
    });
  });

  describe('Response Code Parsing (Section 7.1)', () => {
    it('should parse UIDVALIDITY response code', () => {
      const response = parseUntaggedResponse('* OK [UIDVALIDITY 3857529045] UIDs valid');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toBe('UIDVALIDITY 3857529045');
    });

    it('should parse UIDNEXT response code', () => {
      const response = parseUntaggedResponse('* OK [UIDNEXT 4392] Predicted next UID');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toBe('UIDNEXT 4392');
    });

    it('should parse UNSEEN response code', () => {
      const response = parseUntaggedResponse('* OK [UNSEEN 12] First unseen message');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toBe('UNSEEN 12');
    });

    it('should parse PERMANENTFLAGS response code', () => {
      const response = parseUntaggedResponse('* OK [PERMANENTFLAGS (\\Deleted \\Seen \\*)] Limited');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toContain('PERMANENTFLAGS');
    });
  });

  describe('SEARCH Response Parsing', () => {
    it('should parse SEARCH response with UIDs', () => {
      const response = parseUntaggedResponse('* SEARCH 2 84 882');
      expect(response.type).toBe('SEARCH');
      expect(response.data).toEqual([2, 84, 882]);
    });

    it('should parse empty SEARCH response', () => {
      const response = parseUntaggedResponse('* SEARCH');
      expect(response.type).toBe('SEARCH');
      expect(response.data).toEqual([]);
    });

    it('should parse SEARCH with single UID', () => {
      const response = parseUntaggedResponse('* SEARCH 42');
      expect(response.type).toBe('SEARCH');
      expect(response.data).toEqual([42]);
    });
  });

  describe('Complete Response Parsing', () => {
    it('should parse multi-line SELECT response', () => {
      const lines = [
        '* 172 EXISTS',
        '* 1 RECENT',
        '* OK [UNSEEN 12] Message 12 is first unseen',
        '* OK [UIDVALIDITY 3857529045] UIDs valid',
        '* OK [UIDNEXT 4392] Predicted next UID',
        '* FLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft)',
        '* OK [PERMANENTFLAGS (\\Deleted \\Seen \\*)] Limited',
        'A142 OK [READ-WRITE] SELECT completed'
      ];

      const result = parseResponse(lines);
      
      expect(result.tagged).toBeDefined();
      expect(result.tagged?.status).toBe('OK');
      expect(result.tagged?.tag).toBe('A142');
      expect(result.untagged.length).toBeGreaterThan(0);
      
      // Check EXISTS
      const exists = result.untagged.find(r => r.type === 'EXISTS');
      expect(exists).toBeDefined();
      expect((exists?.data as { number: number }).number).toBe(172);
      
      // Check FLAGS
      const flags = result.untagged.find(r => r.type === 'FLAGS');
      expect(flags).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle tagged response identification', () => {
      expect(isTaggedResponse('A001 OK Done')).toBe(true);
      expect(isTaggedResponse('tag123 NO Failed')).toBe(true);
      expect(isTaggedResponse('* OK Ready')).toBe(false);
      expect(isTaggedResponse('+ Continue')).toBe(false);
    });

    it('should handle special characters in mailbox names', () => {
      const { tokens } = tokenize('"INBOX/Sent Items"');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].value).toBe('INBOX/Sent Items');
    });

    it('should handle bracketed response codes', () => {
      const { tokens } = tokenize('[UIDVALIDITY 123]');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].type).toBe('atom');
      expect(tokens[0].value).toBe('[UIDVALIDITY 123]');
    });

    it('should handle flags with backslash prefix', () => {
      const { tokens } = tokenize('(\\Seen \\Answered \\Flagged \\Deleted \\Draft \\Recent)');
      expect(tokens).toHaveLength(1);
      const list = tokens[0].value as Token[];
      expect(list.every(t => (t.value as string).startsWith('\\'))).toBe(true);
    });
  });
});


describe('RFC 7162 CONDSTORE/QRESYNC Extensions', () => {
  describe('CONDSTORE Response Codes', () => {
    it('should parse HIGHESTMODSEQ response code', () => {
      const response = parseUntaggedResponse('* OK [HIGHESTMODSEQ 715194045007] Highest');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toBe('HIGHESTMODSEQ 715194045007');
    });

    it('should parse NOMODSEQ response code', () => {
      const response = parseUntaggedResponse('* OK [NOMODSEQ] No persistent mod-sequences');
      expect(response.type).toBe('OK');
      const data = response.data as { code: string; text: string };
      expect(data.code).toBe('NOMODSEQ');
    });
  });

  describe('FETCH with MODSEQ', () => {
    it('should parse FETCH response with MODSEQ', () => {
      const response = parseUntaggedResponse('* 1 FETCH (UID 123 FLAGS (\\Seen) MODSEQ (12345))');
      expect(response.type).toBe('FETCH');
      const data = response.data as { seqno: number; attributes: Record<string, unknown> };
      expect(data.seqno).toBe(1);
      expect(data.attributes.UID).toBe('123');
      expect(data.attributes.MODSEQ).toBeDefined();
    });

    it('should parse FETCH response with large MODSEQ value', () => {
      const response = parseUntaggedResponse('* 5 FETCH (UID 999 MODSEQ (715194045007))');
      expect(response.type).toBe('FETCH');
      const data = response.data as { seqno: number; attributes: Record<string, unknown> };
      expect(data.seqno).toBe(5);
      expect(data.attributes.MODSEQ).toBeDefined();
    });
  });

  describe('VANISHED Response (QRESYNC)', () => {
    it('should parse VANISHED response with UID range', () => {
      const response = parseUntaggedResponse('* VANISHED 405,407,410:420');
      expect(response.type).toBe('VANISHED');
    });

    it('should parse VANISHED EARLIER response', () => {
      const response = parseUntaggedResponse('* VANISHED (EARLIER) 300:310,405');
      expect(response.type).toBe('VANISHED');
    });
  });
});
