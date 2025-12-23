/**
 * Type exports for @dyanet/imap
 */

// Configuration types
export type { ImapConfig, TlsOptions, ConnectionOptions, XOAuth2Options, ImapExtensions } from './config.js';

// Mailbox types
export type {
  Mailbox,
  MailboxTree,
  MailboxInfo,
  MailboxStatus
} from './mailbox.js';

// Message types
export type {
  Address,
  Envelope,
  BodyStructure,
  MessageAttributes,
  MessagePart,
  Message,
  Headers,
  ParsedMessage
} from './message.js';

// Search and fetch types
export type {
  SearchCriteria,
  FetchOptions,
  FetchResult
} from './search.js';

// Protocol types
export type {
  TaggedResponse,
  UntaggedResponse,
  ParsedResponse,
  ImapResponse
} from './protocol.js';

// Error types
export {
  ImapError,
  ImapProtocolError,
  ImapNetworkError,
  ImapParseError,
  ImapTimeoutError
} from './errors.js';

export type { ErrorSource } from './errors.js';
