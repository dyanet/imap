/**
 * RFC 7162 CONDSTORE/QRESYNC Extension Tests
 * 
 * Tests for CONDSTORE and QRESYNC IMAP extensions.
 * - CONDSTORE: Efficient flag synchronization using MODSEQ
 * - QRESYNC: Quick mailbox resynchronization
 */

import { describe, it, expect } from 'vitest';
import { parseUntaggedResponse } from '../../src/protocol/parser.js';
import { CommandBuilder } from '../../src/commands/builder.js';
import { ResponseParser } from '../../src/protocol/response-parser.js';
import type { UntaggedResponse } from '../../src/types/protocol.js';

describe('RFC 7162 CONDSTORE Extension', () => {
  describe('Response Code Parsing', () => {
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
      // FETCH responses are parsed as numeric responses first, then as FETCH
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

    it('should extract MODSEQ in parseFetchResponse', () => {
      const responses: UntaggedResponse[] = [{
        type: 'FETCH',
        data: {
          seqno: 1,
          attributes: {
            UID: '123',
            FLAGS: ['\\Seen'],
            MODSEQ: ['12345']
          }
        },
        raw: '* 1 FETCH (UID 123 FLAGS (\\Seen) MODSEQ (12345))'
      }];
      
      const messages = ResponseParser.parseFetchResponse(responses);
      expect(messages).toHaveLength(1);
      expect(messages[0].attributes.modseq).toBe(BigInt(12345));
    });

    it('should handle MODSEQ as string', () => {
      const responses: UntaggedResponse[] = [{
        type: 'FETCH',
        data: {
          seqno: 2,
          attributes: {
            UID: '456',
            FLAGS: [],
            MODSEQ: '67890'
          }
        },
        raw: '* 2 FETCH (UID 456 FLAGS () MODSEQ (67890))'
      }];
      
      const messages = ResponseParser.parseFetchResponse(responses);
      expect(messages).toHaveLength(1);
      expect(messages[0].attributes.modseq).toBe(BigInt(67890));
    });
  });

  describe('SELECT with HIGHESTMODSEQ', () => {
    it('should parse HIGHESTMODSEQ in SELECT response', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'EXISTS',
          data: { number: 172 },
          raw: '* 172 EXISTS'
        },
        {
          type: 'OK',
          data: { code: 'HIGHESTMODSEQ 715194045007', text: 'Highest' },
          raw: '* OK [HIGHESTMODSEQ 715194045007] Highest'
        }
      ];
      
      const mailbox = ResponseParser.parseSelectResponse(responses, 'INBOX', false);
      expect(mailbox.messages.total).toBe(172);
      expect(mailbox.highestModseq).toBe(BigInt('715194045007'));
    });

    it('should handle NOMODSEQ in SELECT response', () => {
      const responses: UntaggedResponse[] = [
        {
          type: 'EXISTS',
          data: { number: 10 },
          raw: '* 10 EXISTS'
        },
        {
          type: 'OK',
          data: { code: 'NOMODSEQ', text: 'No persistent mod-sequences' },
          raw: '* OK [NOMODSEQ] No persistent mod-sequences'
        }
      ];
      
      const mailbox = ResponseParser.parseSelectResponse(responses, 'INBOX', false);
      expect(mailbox.messages.total).toBe(10);
      expect(mailbox.highestModseq).toBeUndefined();
    });
  });

  describe('SEARCH with CHANGEDSINCE', () => {
    it('should build SEARCH command with CHANGEDSINCE modifier', () => {
      const command = CommandBuilder.search(['UNSEEN'], { changedSince: BigInt(12345) });
      expect(command).toBe('SEARCH UNSEEN (CHANGEDSINCE 12345)');
    });

    it('should build SEARCH ALL with CHANGEDSINCE modifier', () => {
      const command = CommandBuilder.search([], { changedSince: BigInt(99999) });
      expect(command).toBe('SEARCH ALL (CHANGEDSINCE 99999)');
    });

    it('should build SEARCH with multiple criteria and CHANGEDSINCE', () => {
      const command = CommandBuilder.search(['UNSEEN', 'FLAGGED'], { changedSince: BigInt(54321) });
      expect(command).toBe('SEARCH UNSEEN FLAGGED (CHANGEDSINCE 54321)');
    });
  });

  describe('FETCH with CHANGEDSINCE', () => {
    it('should build FETCH command with CHANGEDSINCE modifier', () => {
      const command = CommandBuilder.fetch('1:*', { 
        bodies: ['HEADER'],
        changedSince: BigInt(12345)
      });
      expect(command).toContain('CHANGEDSINCE 12345');
    });

    it('should build FETCH command with MODSEQ item', () => {
      const command = CommandBuilder.fetch('1:10', { 
        modseq: true
      });
      expect(command).toContain('MODSEQ');
    });

    it('should build FETCH command with both MODSEQ and CHANGEDSINCE', () => {
      const command = CommandBuilder.fetch('1:*', { 
        modseq: true,
        changedSince: BigInt(99999)
      });
      expect(command).toContain('MODSEQ');
      expect(command).toContain('CHANGEDSINCE 99999');
    });
  });

  describe('CONDSTORE SEARCH Response Parsing', () => {
    it('should parse SEARCH response with MODSEQ', () => {
      const result = ResponseParser.parseCondstoreSearchResponse([
        '* SEARCH 2 84 882 (MODSEQ 12345)'
      ]);
      expect(result.uids).toEqual([2, 84, 882]);
      expect(result.highestModseq).toBe(BigInt(12345));
    });

    it('should parse SEARCH response without MODSEQ', () => {
      const result = ResponseParser.parseCondstoreSearchResponse([
        '* SEARCH 1 2 3'
      ]);
      expect(result.uids).toEqual([1, 2, 3]);
      expect(result.highestModseq).toBeUndefined();
    });

    it('should parse empty SEARCH response', () => {
      const result = ResponseParser.parseCondstoreSearchResponse([
        '* SEARCH'
      ]);
      expect(result.uids).toEqual([]);
      expect(result.highestModseq).toBeUndefined();
    });

    it('should parse SEARCH response with large MODSEQ', () => {
      const result = ResponseParser.parseCondstoreSearchResponse([
        '* SEARCH 42 (MODSEQ 715194045007)'
      ]);
      expect(result.uids).toEqual([42]);
      expect(result.highestModseq).toBe(BigInt('715194045007'));
    });
  });
});

describe('RFC 7162 QRESYNC Extension', () => {
  describe('VANISHED Response Parsing', () => {
    it('should parse VANISHED response with single UID', () => {
      const response = parseUntaggedResponse('* VANISHED 405');
      expect(response.type).toBe('VANISHED');
      const data = response.data as { earlier: boolean; uids: number[] };
      expect(data.earlier).toBe(false);
      expect(data.uids).toEqual([405]);
    });

    it('should parse VANISHED response with UID list', () => {
      const response = parseUntaggedResponse('* VANISHED 405,407,410');
      expect(response.type).toBe('VANISHED');
      const data = response.data as { earlier: boolean; uids: number[] };
      expect(data.earlier).toBe(false);
      expect(data.uids).toEqual([405, 407, 410]);
    });

    it('should parse VANISHED response with UID range', () => {
      const response = parseUntaggedResponse('* VANISHED 410:420');
      expect(response.type).toBe('VANISHED');
      const data = response.data as { earlier: boolean; uids: number[] };
      expect(data.earlier).toBe(false);
      expect(data.uids).toEqual([410, 411, 412, 413, 414, 415, 416, 417, 418, 419, 420]);
    });

    it('should parse VANISHED response with mixed UIDs and ranges', () => {
      const response = parseUntaggedResponse('* VANISHED 405,407,410:412');
      expect(response.type).toBe('VANISHED');
      const data = response.data as { earlier: boolean; uids: number[] };
      expect(data.earlier).toBe(false);
      expect(data.uids).toEqual([405, 407, 410, 411, 412]);
    });

    it('should parse VANISHED EARLIER response', () => {
      const response = parseUntaggedResponse('* VANISHED (EARLIER) 300:310,405');
      expect(response.type).toBe('VANISHED');
      const data = response.data as { earlier: boolean; uids: number[] };
      expect(data.earlier).toBe(true);
      expect(data.uids).toContain(300);
      expect(data.uids).toContain(310);
      expect(data.uids).toContain(405);
    });
  });

  describe('SELECT with QRESYNC', () => {
    it('should build SELECT command with QRESYNC parameter', () => {
      const command = CommandBuilder.selectWithQresync('INBOX', {
        uidValidity: 67890,
        lastKnownModseq: BigInt(12345)
      });
      expect(command).toContain('SELECT');
      expect(command).toContain('INBOX');
      expect(command).toContain('QRESYNC');
      expect(command).toContain('67890');
      expect(command).toContain('12345');
    });

    it('should build SELECT command with QRESYNC and known UIDs', () => {
      const command = CommandBuilder.selectWithQresync('INBOX', {
        uidValidity: 67890,
        lastKnownModseq: BigInt(12345),
        knownUids: '1:100'
      });
      expect(command).toContain('QRESYNC');
      expect(command).toContain('1:100');
    });

    it('should build SELECT command with QRESYNC and sequence match', () => {
      const command = CommandBuilder.selectWithQresync('INBOX', {
        uidValidity: 67890,
        lastKnownModseq: BigInt(12345),
        knownUids: '1:100',
        sequenceMatch: { seqSet: '1:50', uidSet: '1:50' }
      });
      expect(command).toContain('QRESYNC');
    });
  });
});
