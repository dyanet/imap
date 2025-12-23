/**
 * Message types for @dyanet/imap
 */

/**
 * Represents an email address
 */
export interface Address {
  /** Display name */
  name: string;
  /** Mailbox part (before @) */
  mailbox: string;
  /** Host part (after @) */
  host: string;
}

/**
 * Message envelope (RFC 2822 header information)
 */
export interface Envelope {
  /** Message date */
  date: Date;
  /** Subject line */
  subject: string;
  /** From addresses */
  from: Address[];
  /** Sender addresses */
  sender: Address[];
  /** Reply-To addresses */
  replyTo: Address[];
  /** To addresses */
  to: Address[];
  /** CC addresses */
  cc: Address[];
  /** BCC addresses */
  bcc: Address[];
  /** In-Reply-To header */
  inReplyTo: string;
  /** Message-ID header */
  messageId: string;
}

/**
 * MIME body structure
 */
export interface BodyStructure {
  /** MIME type (e.g., "text", "multipart") */
  type: string;
  /** MIME subtype (e.g., "plain", "html", "mixed") */
  subtype: string;
  /** Content parameters (e.g., charset, boundary) */
  params: Record<string, string>;
  /** Content-ID */
  id: string | null;
  /** Content-Description */
  description: string | null;
  /** Content-Transfer-Encoding */
  encoding: string;
  /** Size in bytes */
  size: number;
  /** Number of lines (for text parts) */
  lines?: number;
  /** MD5 checksum */
  md5?: string;
  /** Content-Disposition */
  disposition?: { type: string; params: Record<string, string> };
  /** Content-Language */
  language?: string[];
  /** Content-Location */
  location?: string;
  /** Child parts (for multipart) */
  parts?: BodyStructure[];
}

/**
 * Message attributes from FETCH response
 */
export interface MessageAttributes {
  /** Unique identifier */
  uid: number;
  /** Message flags */
  flags: string[];
  /** Internal date */
  date: Date;
  /** Message size in bytes */
  size: number;
  /** Envelope information */
  envelope?: Envelope;
  /** Body structure */
  bodystructure?: BodyStructure;
}

/**
 * A part of a message (header, body section, etc.)
 */
export interface MessagePart {
  /** Which part this is (e.g., "HEADER", "TEXT", "1.2") */
  which: string;
  /** Size of this part */
  size: number;
  /** Content of this part */
  body: string | Buffer;
}

/**
 * Complete message with all fetched data
 */
export interface Message {
  /** Sequence number */
  seqno: number;
  /** Unique identifier */
  uid: number;
  /** Message attributes */
  attributes: MessageAttributes;
  /** Fetched message parts */
  parts: MessagePart[];
}

/**
 * Parsed message headers
 */
export type Headers = Map<string, string | string[]>;

/**
 * Parsed message from MIME parser
 */
export interface ParsedMessage {
  /** Parsed headers */
  headers: Headers;
  /** Message body parts */
  parts: MessagePart[];
  /** Raw message content */
  raw: string;
}
