/**
 * Mailbox types for @dyanet/imap
 */

/**
 * Represents a selected mailbox with its status
 */
export interface Mailbox {
  /** Mailbox name */
  name: string;
  /** Whether the mailbox is opened in read-only mode */
  readOnly: boolean;
  /** UID validity value */
  uidvalidity: number;
  /** Next UID to be assigned */
  uidnext: number;
  /** Available flags for this mailbox */
  flags: string[];
  /** Permanent flags that can be set */
  permFlags: string[];
  /** Message counts */
  messages: {
    /** Total number of messages */
    total: number;
    /** Number of new messages */
    new: number;
    /** Number of unseen messages */
    unseen: number;
  };
}

/**
 * Hierarchical mailbox tree structure
 */
export interface MailboxTree {
  [name: string]: {
    /** Mailbox attributes (e.g., \Noselect, \HasChildren) */
    attribs: string[];
    /** Hierarchy delimiter character */
    delimiter: string;
    /** Child mailboxes */
    children?: MailboxTree;
  };
}

/**
 * Information about a single mailbox from LIST response
 */
export interface MailboxInfo {
  /** Mailbox name */
  name: string;
  /** Hierarchy delimiter character */
  delimiter: string;
  /** Mailbox attributes */
  attributes: string[];
}

/**
 * Mailbox status information
 */
export interface MailboxStatus {
  /** Total number of messages */
  messages: number;
  /** Number of recent messages */
  recent: number;
  /** Number of unseen messages */
  unseen: number;
  /** UID validity value */
  uidvalidity: number;
  /** Next UID to be assigned */
  uidnext: number;
}
