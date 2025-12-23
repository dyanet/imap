/**
 * Search and fetch types for @dyanet/imap
 */

/**
 * Search criteria for finding messages
 * 
 * Simple criteria are strings like 'ALL', 'UNSEEN', 'SEEN', etc.
 * Complex criteria are tuples like ['FROM', 'user@example.com']
 */
export type SearchCriteria =
  // Simple flags
  | 'ALL' | 'UNSEEN' | 'SEEN' | 'FLAGGED' | 'UNFLAGGED'
  | 'ANSWERED' | 'UNANSWERED' | 'DELETED' | 'UNDELETED'
  | 'DRAFT' | 'UNDRAFT' | 'NEW' | 'OLD' | 'RECENT'
  // Address-based criteria
  | ['FROM', string]
  | ['TO', string]
  | ['CC', string]
  | ['BCC', string]
  // Content-based criteria
  | ['SUBJECT', string]
  | ['BODY', string]
  | ['TEXT', string]
  // Date-based criteria (internal date)
  | ['SINCE', Date]
  | ['BEFORE', Date]
  | ['ON', Date]
  // Date-based criteria (sent date)
  | ['SENTSINCE', Date]
  | ['SENTBEFORE', Date]
  | ['SENTON', Date]
  // Size-based criteria
  | ['LARGER', number]
  | ['SMALLER', number]
  // UID-based criteria
  | ['UID', string]
  // Header-based criteria
  | ['HEADER', string, string];

/**
 * Options for fetching messages
 */
export interface FetchOptions {
  /** 
   * Which body parts to fetch
   * Can be a string like 'HEADER' or array like ['HEADER', 'TEXT']
   */
  bodies?: string | string[];
  /** Whether to fetch body structure */
  struct?: boolean;
  /** Whether to fetch envelope */
  envelope?: boolean;
  /** Whether to fetch size */
  size?: boolean;
  /** Whether to mark messages as seen when fetching */
  markSeen?: boolean;
}

/**
 * Result from a FETCH command
 */
export interface FetchResult {
  /** Sequence number */
  seqno: number;
  /** Unique identifier */
  uid: number;
  /** Message flags */
  flags: string[];
  /** Internal date */
  date?: Date;
  /** Message size */
  size?: number;
  /** Envelope data */
  envelope?: import('./message.js').Envelope;
  /** Body structure */
  bodystructure?: import('./message.js').BodyStructure;
  /** Fetched body parts */
  parts: Map<string, string | Buffer>;
}
