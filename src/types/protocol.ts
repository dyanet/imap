/**
 * Protocol types for @dyanet/imap
 */

/**
 * Tagged response from IMAP server
 */
export interface TaggedResponse {
  /** Command tag */
  tag: string;
  /** Response status */
  status: 'OK' | 'NO' | 'BAD';
  /** Response text */
  text: string;
}

/**
 * Untagged response from IMAP server
 */
export interface UntaggedResponse {
  /** Response type (e.g., 'EXISTS', 'RECENT', 'FETCH') */
  type: string;
  /** Parsed data */
  data: unknown;
  /** Raw response line */
  raw: string;
}

/**
 * Parsed IMAP response
 */
export interface ParsedResponse {
  /** Tagged response (if present) */
  tagged?: TaggedResponse;
  /** Untagged responses */
  untagged: UntaggedResponse[];
  /** Continuation request (if present) */
  continuation?: string;
}

/**
 * Complete IMAP response for a command
 */
export interface ImapResponse {
  /** Command tag */
  tag: string;
  /** Response type */
  type: 'OK' | 'NO' | 'BAD';
  /** Response text */
  text: string;
  /** Untagged responses received */
  untagged: UntaggedResponse[];
}
