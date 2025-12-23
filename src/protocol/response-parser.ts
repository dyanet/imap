/**
 * IMAP Response Parser
 * 
 * Parses IMAP command responses into structured objects.
 * Handles LIST, SELECT, SEARCH, and FETCH responses.
 * 
 * @packageDocumentation
 */

import { tokenize, getTokenValue, isListToken, type Token } from './tokenizer.js';
import type { MailboxTree, MailboxInfo, Mailbox } from '../types/mailbox.js';
import type { UntaggedResponse } from '../types/protocol.js';
import type { Message, MessagePart, MessageAttributes } from '../types/message.js';

/**
 * CONDSTORE search result with MODSEQ (RFC 7162)
 */
export interface CondstoreSearchResult {
  /** Array of message UIDs */
  uids: number[];
  /** Highest MODSEQ value of the returned messages */
  highestModseq?: bigint;
}

/**
 * ResponseParser class for parsing IMAP command responses
 */
export class ResponseParser {
  /**
   * Parses LIST response lines into a MailboxTree structure
   * 
   * LIST responses have the format:
   * * LIST (\Attributes) "delimiter" "mailbox name"
   * 
   * @param lines - Array of LIST response lines or UntaggedResponse objects
   * @returns MailboxTree with hierarchical mailbox structure
   */
  static parseListResponse(lines: string[] | UntaggedResponse[]): MailboxTree {
    const tree: MailboxTree = {};
    const mailboxes = this.parseListToMailboxInfo(lines);
    
    for (const mailbox of mailboxes) {
      this.addMailboxToTree(tree, mailbox);
    }
    
    return tree;
  }

  /**
   * Parses LIST response lines into flat MailboxInfo array
   * 
   * @param lines - Array of LIST response lines or UntaggedResponse objects
   * @returns Array of MailboxInfo objects
   */
  static parseListToMailboxInfo(lines: string[] | UntaggedResponse[]): MailboxInfo[] {
    const mailboxes: MailboxInfo[] = [];
    
    for (const line of lines) {
      const parsed = this.parseListLine(line);
      if (parsed) {
        mailboxes.push(parsed);
      }
    }
    
    return mailboxes;
  }

  /**
   * Parses a single LIST response line
   */
  private static parseListLine(line: string | UntaggedResponse): MailboxInfo | null {
    // Handle UntaggedResponse objects
    if (typeof line === 'object' && 'type' in line) {
      if (line.type !== 'LIST' && line.type !== 'LSUB') {
        return null;
      }
      const data = line.data as { attributes: string[]; delimiter: string | null; name: string };
      return {
        name: data.name,
        delimiter: data.delimiter || '/',
        attributes: data.attributes
      };
    }
    
    // Handle raw string lines
    const trimmed = line.trim();
    
    // Check if it's a LIST response
    const listMatch = trimmed.match(/^\*\s+LIST\s+(.*)$/i);
    if (!listMatch) {
      return null;
    }
    
    const content = listMatch[1];
    return this.parseListContent(content);
  }

  /**
   * Parses the content portion of a LIST response
   */
  private static parseListContent(content: string): MailboxInfo {
    const { tokens } = tokenize(content);
    
    let attributes: string[] = [];
    let delimiter = '/';
    let name = '';
    
    let tokenIndex = 0;
    
    // First token should be attributes list
    if (tokenIndex < tokens.length) {
      const firstToken = tokens[tokenIndex];
      if (isListToken(firstToken)) {
        attributes = firstToken.value
          .map((t: Token) => getTokenValue(t))
          .filter((v): v is string => v !== null);
        tokenIndex++;
      }
    }
    
    // Second token is delimiter (quoted string or NIL)
    if (tokenIndex < tokens.length) {
      const delimToken = tokens[tokenIndex];
      if (delimToken.type === 'nil') {
        delimiter = '/'; // Default delimiter
      } else {
        delimiter = getTokenValue(delimToken) || '/';
      }
      tokenIndex++;
    }
    
    // Third token is mailbox name
    if (tokenIndex < tokens.length) {
      name = getTokenValue(tokens[tokenIndex]) || '';
    }
    
    return { name, delimiter, attributes };
  }

  /**
   * Adds a mailbox to the tree structure
   */
  private static addMailboxToTree(tree: MailboxTree, mailbox: MailboxInfo): void {
    const { name, delimiter, attributes } = mailbox;
    
    // Split the mailbox name by delimiter to get hierarchy
    const parts = delimiter ? name.split(delimiter) : [name];
    
    let current = tree;
    
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      const isLast = i === parts.length - 1;
      
      if (!current[part]) {
        current[part] = {
          attribs: isLast ? attributes : [],
          delimiter: delimiter,
          children: undefined
        };
      } else if (isLast) {
        // Update attributes for existing entry
        current[part].attribs = attributes;
      }
      
      if (!isLast) {
        // Create children object if needed
        if (!current[part].children) {
          current[part].children = {};
        }
        current = current[part].children!;
      }
    }
  }

  /**
   * Parses SELECT/EXAMINE response into a Mailbox object
   * 
   * SELECT responses include multiple untagged responses:
   * * FLAGS (\Answered \Flagged \Deleted \Seen \Draft)
   * * OK [PERMANENTFLAGS (\Answered \Flagged \Deleted \Seen \Draft \*)]
   * * 172 EXISTS
   * * 1 RECENT
   * * OK [UNSEEN 12]
   * * OK [UIDVALIDITY 3857529045]
   * * OK [UIDNEXT 4392]
   * A142 OK [READ-WRITE] SELECT completed
   * 
   * @param responses - Array of UntaggedResponse objects from SELECT command
   * @param mailboxName - Name of the selected mailbox
   * @param readOnly - Whether the mailbox was opened read-only (EXAMINE vs SELECT)
   * @returns Mailbox object with status information
   */
  static parseSelectResponse(
    responses: UntaggedResponse[],
    mailboxName: string,
    readOnly: boolean = false
  ): Mailbox {
    const mailbox: Mailbox = {
      name: mailboxName,
      readOnly,
      uidvalidity: 0,
      uidnext: 0,
      flags: [],
      permFlags: [],
      messages: {
        total: 0,
        new: 0,
        unseen: 0
      }
    };

    for (const response of responses) {
      this.parseSelectResponseLine(response, mailbox);
    }

    return mailbox;
  }

  /**
   * Parses a single SELECT response line and updates the mailbox object
   */
  private static parseSelectResponseLine(response: UntaggedResponse, mailbox: Mailbox): void {
    const { type, data } = response;

    switch (type) {
      case 'EXISTS':
        // * N EXISTS - total message count
        if (typeof data === 'object' && data !== null && 'number' in data) {
          mailbox.messages.total = (data as { number: number }).number;
        }
        break;

      case 'RECENT':
        // * N RECENT - new message count
        if (typeof data === 'object' && data !== null && 'number' in data) {
          mailbox.messages.new = (data as { number: number }).number;
        }
        break;

      case 'FLAGS':
        // * FLAGS (\Answered \Flagged \Deleted \Seen \Draft)
        if (Array.isArray(data)) {
          mailbox.flags = data as string[];
        }
        break;

      case 'OK':
        // Parse response codes like [UIDVALIDITY 123], [UIDNEXT 456], [UNSEEN 12], [PERMANENTFLAGS (...)]
        if (typeof data === 'object' && data !== null && 'code' in data) {
          const codeData = data as { code: string; text: string };
          this.parseSelectOkCode(codeData.code, mailbox);
        }
        break;
    }
  }

  /**
   * Parses OK response codes from SELECT response
   */
  private static parseSelectOkCode(code: string, mailbox: Mailbox): void {
    // Parse UIDVALIDITY
    const uidvalidityMatch = code.match(/^UIDVALIDITY\s+(\d+)/i);
    if (uidvalidityMatch) {
      mailbox.uidvalidity = parseInt(uidvalidityMatch[1], 10);
      return;
    }

    // Parse UIDNEXT
    const uidnextMatch = code.match(/^UIDNEXT\s+(\d+)/i);
    if (uidnextMatch) {
      mailbox.uidnext = parseInt(uidnextMatch[1], 10);
      return;
    }

    // Parse UNSEEN
    const unseenMatch = code.match(/^UNSEEN\s+(\d+)/i);
    if (unseenMatch) {
      mailbox.messages.unseen = parseInt(unseenMatch[1], 10);
      return;
    }

    // Parse PERMANENTFLAGS
    const permFlagsMatch = code.match(/^PERMANENTFLAGS\s+\(([^)]*)\)/i);
    if (permFlagsMatch) {
      const flagsStr = permFlagsMatch[1].trim();
      mailbox.permFlags = flagsStr ? flagsStr.split(/\s+/) : [];
      return;
    }

    // Parse HIGHESTMODSEQ (CONDSTORE extension - RFC 7162)
    const highestModseqMatch = code.match(/^HIGHESTMODSEQ\s+(\d+)/i);
    if (highestModseqMatch) {
      mailbox.highestModseq = BigInt(highestModseqMatch[1]);
      return;
    }

    // Parse NOMODSEQ (CONDSTORE extension - RFC 7162)
    // Indicates the mailbox does not support persistent mod-sequences
    if (code.toUpperCase() === 'NOMODSEQ') {
      mailbox.highestModseq = undefined;
      return;
    }

    // Parse READ-WRITE / READ-ONLY
    if (code.toUpperCase() === 'READ-WRITE') {
      mailbox.readOnly = false;
      return;
    }
    if (code.toUpperCase() === 'READ-ONLY') {
      mailbox.readOnly = true;
      return;
    }
  }

  /**
   * Parses SEARCH response into an array of UIDs
   * 
   * SEARCH responses have the format:
   * * SEARCH 1 2 3 4 5
   * or
   * * SEARCH (empty result)
   * 
   * @param responses - Array of UntaggedResponse objects or raw response lines
   * @returns Array of message UIDs
   */
  static parseSearchResponse(responses: UntaggedResponse[] | string[]): number[] {
    const uids: number[] = [];

    for (const response of responses) {
      const parsed = this.parseSearchLine(response);
      uids.push(...parsed);
    }

    return uids;
  }

  /**
   * Parses SEARCH response with CONDSTORE extension (RFC 7162)
   * 
   * CONDSTORE SEARCH responses may include MODSEQ:
   * * SEARCH 1 2 3 (MODSEQ 12345)
   * 
   * @param responses - Array of UntaggedResponse objects or raw response lines
   * @returns CondstoreSearchResult with UIDs and optional highestModseq
   */
  static parseCondstoreSearchResponse(responses: UntaggedResponse[] | string[]): CondstoreSearchResult {
    const result: CondstoreSearchResult = {
      uids: [],
      highestModseq: undefined
    };

    for (const response of responses) {
      const parsed = this.parseCondstoreSearchLine(response);
      result.uids.push(...parsed.uids);
      if (parsed.highestModseq !== undefined) {
        result.highestModseq = parsed.highestModseq;
      }
    }

    return result;
  }

  /**
   * Parses a single SEARCH response line with CONDSTORE support
   */
  private static parseCondstoreSearchLine(line: string | UntaggedResponse): CondstoreSearchResult {
    const result: CondstoreSearchResult = {
      uids: [],
      highestModseq: undefined
    };

    // Handle UntaggedResponse objects
    if (typeof line === 'object' && 'type' in line) {
      if (line.type !== 'SEARCH') {
        return result;
      }
      // Data should already be parsed as number array
      if (Array.isArray(line.data)) {
        result.uids = line.data.filter((n): n is number => typeof n === 'number');
      }
      // Check raw for MODSEQ
      const modseqMatch = line.raw.match(/\(MODSEQ\s+(\d+)\)/i);
      if (modseqMatch) {
        result.highestModseq = BigInt(modseqMatch[1]);
      }
      return result;
    }

    // Handle raw string lines
    const trimmed = line.trim();

    // Check if it's a SEARCH response
    const searchMatch = trimmed.match(/^\*\s+SEARCH\s*(.*)$/i);
    if (!searchMatch) {
      return result;
    }

    let content = searchMatch[1].trim();
    
    // Check for MODSEQ at the end: (MODSEQ 12345)
    const modseqMatch = content.match(/\(MODSEQ\s+(\d+)\)\s*$/i);
    if (modseqMatch) {
      result.highestModseq = BigInt(modseqMatch[1]);
      // Remove MODSEQ from content
      content = content.replace(/\(MODSEQ\s+\d+\)\s*$/i, '').trim();
    }

    if (content) {
      // Parse space-separated UIDs
      result.uids = content
        .split(/\s+/)
        .map(s => parseInt(s, 10))
        .filter(n => !isNaN(n));
    }

    return result;
  }

  /**
   * Parses a single SEARCH response line
   */
  private static parseSearchLine(line: string | UntaggedResponse): number[] {
    // Handle UntaggedResponse objects
    if (typeof line === 'object' && 'type' in line) {
      if (line.type !== 'SEARCH') {
        return [];
      }
      // Data should already be parsed as number array
      if (Array.isArray(line.data)) {
        return line.data.filter((n): n is number => typeof n === 'number');
      }
      return [];
    }

    // Handle raw string lines
    const trimmed = line.trim();

    // Check if it's a SEARCH response
    const searchMatch = trimmed.match(/^\*\s+SEARCH\s*(.*)$/i);
    if (!searchMatch) {
      return [];
    }

    const uidsStr = searchMatch[1].trim();
    if (!uidsStr) {
      return [];
    }

    // Parse space-separated UIDs
    return uidsStr
      .split(/\s+/)
      .map(s => parseInt(s, 10))
      .filter(n => !isNaN(n));
  }

  /**
   * Parses FETCH response into an array of Message objects
   * 
   * FETCH responses have the format:
   * * 1 FETCH (UID 123 FLAGS (\Seen) BODY[HEADER] {1234}...)
   * 
   * @param responses - Array of UntaggedResponse objects from FETCH command
   * @returns Array of Message objects with parts
   */
  static parseFetchResponse(responses: UntaggedResponse[]): Message[] {
    const messages: Message[] = [];

    for (const response of responses) {
      if (response.type !== 'FETCH') {
        continue;
      }

      const message = this.parseFetchData(response);
      if (message) {
        messages.push(message);
      }
    }

    return messages;
  }

  /**
   * Parses a single FETCH response into a Message object
   */
  private static parseFetchData(response: UntaggedResponse): Message | null {
    const data = response.data as { seqno: number; attributes: Record<string, unknown> } | null;
    
    if (!data || typeof data.seqno !== 'number') {
      return null;
    }

    const { seqno, attributes } = data;
    const parts: MessagePart[] = [];

    // Extract UID
    const uid = typeof attributes.UID === 'string' 
      ? parseInt(attributes.UID, 10) 
      : (typeof attributes.UID === 'number' ? attributes.UID : 0);

    // Extract FLAGS
    const flags = Array.isArray(attributes.FLAGS) 
      ? attributes.FLAGS.filter((f): f is string => typeof f === 'string')
      : [];

    // Extract RFC822.SIZE
    const size = typeof attributes['RFC822.SIZE'] === 'string'
      ? parseInt(attributes['RFC822.SIZE'], 10)
      : (typeof attributes['RFC822.SIZE'] === 'number' ? attributes['RFC822.SIZE'] : 0);

    // Extract INTERNALDATE
    let date = new Date();
    if (typeof attributes.INTERNALDATE === 'string') {
      const parsed = new Date(attributes.INTERNALDATE);
      if (!isNaN(parsed.getTime())) {
        date = parsed;
      }
    }

    // Extract MODSEQ (CONDSTORE extension - RFC 7162)
    let modseq: bigint | undefined;
    if (attributes.MODSEQ !== undefined) {
      // MODSEQ is returned as a parenthesized value like (12345)
      const modseqValue = attributes.MODSEQ;
      if (typeof modseqValue === 'string') {
        // Remove parentheses if present
        const cleanValue = modseqValue.replace(/[()]/g, '').trim();
        modseq = BigInt(cleanValue);
      } else if (typeof modseqValue === 'number') {
        modseq = BigInt(modseqValue);
      } else if (Array.isArray(modseqValue) && modseqValue.length > 0) {
        // Handle case where MODSEQ is parsed as a list
        const firstValue = modseqValue[0];
        if (typeof firstValue === 'string') {
          modseq = BigInt(firstValue);
        } else if (typeof firstValue === 'number') {
          modseq = BigInt(firstValue);
        }
      }
    }

    // Extract body parts (BODY[...] or BODY.PEEK[...])
    for (const [key, value] of Object.entries(attributes)) {
      if (key.startsWith('BODY[') || key.startsWith('BODY.PEEK[')) {
        const which = this.extractBodyPartName(key);
        const body = typeof value === 'string' ? value : '';
        parts.push({
          which,
          size: body.length,
          body
        });
      }
    }

    const messageAttributes: MessageAttributes = {
      uid,
      flags,
      date,
      size,
      modseq
    };

    return {
      seqno,
      uid,
      attributes: messageAttributes,
      parts
    };
  }

  /**
   * Extracts the body part name from a BODY[...] key
   */
  private static extractBodyPartName(key: string): string {
    // Match BODY[...] or BODY.PEEK[...]
    const match = key.match(/BODY(?:\.PEEK)?\[([^\]]*)\]/i);
    if (match) {
      return match[1] || '';
    }
    return '';
  }
}
