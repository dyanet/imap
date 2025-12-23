/**
 * IMAP Command Builder
 * 
 * Builds IMAP commands according to RFC 3501 specification.
 * All commands are returned without the tag - the caller is responsible for adding tags.
 * 
 * @packageDocumentation
 */

import type { SearchCriteria, FetchOptions } from '../types/search.js';

/**
 * Standard IMAP flags
 */
export const STANDARD_FLAGS = [
  '\\Seen',
  '\\Answered',
  '\\Flagged',
  '\\Deleted',
  '\\Draft',
  '\\Recent'
] as const;

/**
 * Escapes a string for use in IMAP commands
 * Handles quoting and escaping special characters
 * 
 * @param value - The string to escape
 * @returns Properly quoted/escaped string
 */
function escapeString(value: string): string {
  // If the string contains special characters, quote it
  if (value.includes('"') || value.includes('\\')) {
    // Escape backslashes and quotes
    const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    return `"${escaped}"`;
  }
  
  // If the string contains spaces or is empty, quote it
  if (value.includes(' ') || value.length === 0) {
    return `"${value}"`;
  }
  
  // Check for other special characters that require quoting
  if (/[\(\)\{\}\[\]%\*\x00-\x1f\x7f]/.test(value)) {
    return `"${value}"`;
  }
  
  return value;
}

/**
 * Formats a date for IMAP commands (DD-Mon-YYYY format)
 * 
 * @param date - The date to format
 * @returns Formatted date string
 */
function formatDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const day = date.getDate();
  const month = months[date.getMonth()];
  const year = date.getFullYear();
  return `${day}-${month}-${year}`;
}

/**
 * Builds an XOAUTH2 authentication string per RFC 7628 / Google XOAUTH2 spec
 * Format: user={user}\x01auth=Bearer {token}\x01\x01
 * 
 * @param user - User email address
 * @param accessToken - OAuth2 access token
 * @returns Base64-encoded XOAUTH2 string
 */
export function buildXOAuth2String(user: string, accessToken: string): string {
  const authString = `user=${user}\x01auth=Bearer ${accessToken}\x01\x01`;
  return Buffer.from(authString, 'utf8').toString('base64');
}

/**
 * CommandBuilder provides static methods to construct IMAP commands
 */
export class CommandBuilder {
  /**
   * Builds a LOGIN command
   * 
   * @param user - Username
   * @param password - Password
   * @returns LOGIN command string
   */
  static login(user: string, password: string): string {
    return `LOGIN ${escapeString(user)} ${escapeString(password)}`;
  }

  /**
   * Builds an AUTHENTICATE XOAUTH2 command
   * Used for OAuth2 authentication with Gmail, Microsoft 365, etc.
   * 
   * @param user - User email address
   * @param accessToken - OAuth2 access token
   * @returns AUTHENTICATE command string with base64-encoded XOAUTH2 token
   */
  static authenticateXOAuth2(user: string, accessToken: string): string {
    const xoauth2Token = buildXOAuth2String(user, accessToken);
    return `AUTHENTICATE XOAUTH2 ${xoauth2Token}`;
  }

  /**
   * Builds a LOGOUT command
   * 
   * @returns LOGOUT command string
   */
  static logout(): string {
    return 'LOGOUT';
  }

  /**
   * Builds a LIST command to list mailboxes
   * 
   * @param reference - Reference name (usually empty string)
   * @param pattern - Mailbox pattern (e.g., "*" for all, "%" for top-level)
   * @returns LIST command string
   */
  static list(reference: string, pattern: string): string {
    return `LIST ${escapeString(reference)} ${escapeString(pattern)}`;
  }

  /**
   * Builds a SELECT command to open a mailbox for read/write
   * 
   * @param mailbox - Mailbox name
   * @returns SELECT command string
   */
  static select(mailbox: string): string {
    return `SELECT ${escapeString(mailbox)}`;
  }

  /**
   * Builds an EXAMINE command to open a mailbox read-only
   * 
   * @param mailbox - Mailbox name
   * @returns EXAMINE command string
   */
  static examine(mailbox: string): string {
    return `EXAMINE ${escapeString(mailbox)}`;
  }

  /**
   * Builds a CREATE command to create a new mailbox
   * 
   * @param mailbox - Mailbox name to create
   * @returns CREATE command string
   */
  static create(mailbox: string): string {
    return `CREATE ${escapeString(mailbox)}`;
  }

  /**
   * Builds a DELETE command to delete a mailbox
   * 
   * @param mailbox - Mailbox name to delete
   * @returns DELETE command string
   */
  static delete(mailbox: string): string {
    return `DELETE ${escapeString(mailbox)}`;
  }

  /**
   * Builds a RENAME command to rename a mailbox
   * 
   * @param oldName - Current mailbox name
   * @param newName - New mailbox name
   * @returns RENAME command string
   */
  static rename(oldName: string, newName: string): string {
    return `RENAME ${escapeString(oldName)} ${escapeString(newName)}`;
  }

  /**
   * Builds a SEARCH command with the given criteria
   * Multiple criteria are combined with AND logic (space-separated)
   * 
   * @param criteria - Array of search criteria
   * @returns SEARCH command string
   */
  static search(criteria: SearchCriteria[]): string {
    if (criteria.length === 0) {
      return 'SEARCH ALL';
    }

    const parts: string[] = [];

    for (const criterion of criteria) {
      if (typeof criterion === 'string') {
        // Simple flag criteria
        parts.push(criterion);
      } else if (Array.isArray(criterion)) {
        // Complex criteria with arguments
        const [type, ...args] = criterion;
        
        switch (type) {
          case 'FROM':
          case 'TO':
          case 'CC':
          case 'BCC':
          case 'SUBJECT':
          case 'BODY':
          case 'TEXT':
            parts.push(`${type} ${escapeString(args[0] as string)}`);
            break;
          
          case 'SINCE':
          case 'BEFORE':
          case 'ON':
          case 'SENTSINCE':
          case 'SENTBEFORE':
          case 'SENTON':
            parts.push(`${type} ${formatDate(args[0] as Date)}`);
            break;
          
          case 'LARGER':
          case 'SMALLER':
            parts.push(`${type} ${args[0]}`);
            break;
          
          case 'UID':
            parts.push(`UID ${args[0]}`);
            break;
          
          case 'HEADER':
            // HEADER field-name string
            parts.push(`HEADER ${escapeString(args[0] as string)} ${escapeString(args[1] as string)}`);
            break;
        }
      }
    }

    return `SEARCH ${parts.join(' ')}`;
  }

  /**
   * Builds a FETCH command with the given options
   * 
   * @param sequence - Message sequence set (e.g., "1:*", "1,2,3", "5")
   * @param options - Fetch options specifying what to retrieve
   * @returns FETCH command string
   */
  static fetch(sequence: string, options: FetchOptions): string {
    const items: string[] = [];

    // Always fetch UID
    items.push('UID');
    items.push('FLAGS');

    // Handle bodies option
    if (options.bodies) {
      const bodies = Array.isArray(options.bodies) ? options.bodies : [options.bodies];
      const peek = options.markSeen === true ? '' : '.PEEK';
      
      for (const body of bodies) {
        const upperBody = body.toUpperCase();
        
        if (upperBody === 'HEADER' || upperBody === 'HEADERS') {
          items.push(`BODY${peek}[HEADER]`);
        } else if (upperBody === 'TEXT') {
          items.push(`BODY${peek}[TEXT]`);
        } else if (upperBody === '' || upperBody === 'FULL') {
          items.push(`BODY${peek}[]`);
        } else {
          // Specific part like "1", "1.2", "HEADER.FIELDS (FROM TO)"
          items.push(`BODY${peek}[${body}]`);
        }
      }
    }

    // Handle struct option
    if (options.struct) {
      items.push('BODYSTRUCTURE');
    }

    // Handle envelope option
    if (options.envelope) {
      items.push('ENVELOPE');
    }

    // Handle size option
    if (options.size) {
      items.push('RFC822.SIZE');
    }

    return `FETCH ${sequence} (${items.join(' ')})`;
  }

  /**
   * Builds a STORE command to modify message flags
   * 
   * @param sequence - Message sequence set (e.g., "1:*", "1,2,3", "5")
   * @param flags - Array of flags to add or remove
   * @param action - 'add' to add flags (+FLAGS), 'remove' to remove flags (-FLAGS)
   * @returns STORE command string
   */
  static store(sequence: string, flags: string[], action: 'add' | 'remove'): string {
    const flagsStr = flags.join(' ');
    const operator = action === 'add' ? '+FLAGS' : '-FLAGS';
    return `STORE ${sequence} ${operator} (${flagsStr})`;
  }

  /**
   * Builds a COPY command to copy messages to another mailbox
   * 
   * @param sequence - Message sequence set (e.g., "1:*", "1,2,3", "5")
   * @param mailbox - Destination mailbox name
   * @returns COPY command string
   */
  static copy(sequence: string, mailbox: string): string {
    return `COPY ${sequence} ${escapeString(mailbox)}`;
  }

  /**
   * Builds an EXPUNGE command to permanently remove deleted messages
   * 
   * @returns EXPUNGE command string
   */
  static expunge(): string {
    return 'EXPUNGE';
  }

  /**
   * Builds a NOOP command (no operation, used to keep connection alive)
   * 
   * @returns NOOP command string
   */
  static noop(): string {
    return 'NOOP';
  }
}
