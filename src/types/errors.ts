/**
 * Error types for @dyanet/imap
 */

/**
 * Error source categories
 */
export type ErrorSource = 'protocol' | 'network' | 'parse' | 'timeout';

/**
 * Base IMAP error class
 */
export class ImapError extends Error {
  /** Error code */
  code: string;
  /** Error source category */
  source: ErrorSource;
  /** Command that caused the error (if applicable) */
  command?: string;
  /** Server response (if applicable) */
  response?: string;

  constructor(message: string, code: string, source: ErrorSource) {
    super(message);
    this.name = 'ImapError';
    this.code = code;
    this.source = source;
    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace?.(this, this.constructor);
  }
}

/**
 * IMAP protocol error (server returned NO or BAD)
 */
export class ImapProtocolError extends ImapError {
  override source: 'protocol' = 'protocol';
  /** Server response text */
  serverResponse: string;

  constructor(message: string, serverResponse: string, command?: string) {
    super(message, 'PROTOCOL_ERROR', 'protocol');
    this.name = 'ImapProtocolError';
    this.serverResponse = serverResponse;
    this.command = command;
    this.response = serverResponse;
  }
}

/**
 * Network error (connection failure, socket error)
 */
export class ImapNetworkError extends ImapError {
  override source: 'network' = 'network';
  /** Server host */
  host: string;
  /** Server port */
  port: number;

  constructor(message: string, host: string, port: number, cause?: Error) {
    super(message, 'NETWORK_ERROR', 'network');
    this.name = 'ImapNetworkError';
    this.host = host;
    this.port = port;
    if (cause) {
      this.cause = cause;
    }
  }
}

/**
 * Parse error (malformed response)
 */
export class ImapParseError extends ImapError {
  override source: 'parse' = 'parse';
  /** Raw data that failed to parse */
  rawData: string;

  constructor(message: string, rawData: string) {
    super(message, 'PARSE_ERROR', 'parse');
    this.name = 'ImapParseError';
    this.rawData = rawData;
  }
}

/**
 * Timeout error (operation took too long)
 */
export class ImapTimeoutError extends ImapError {
  override source: 'timeout' = 'timeout';
  /** Operation that timed out */
  operation: string;
  /** Timeout duration in milliseconds */
  timeoutMs: number;

  constructor(message: string, operation: string, timeoutMs: number) {
    super(message, 'TIMEOUT_ERROR', 'timeout');
    this.name = 'ImapTimeoutError';
    this.operation = operation;
    this.timeoutMs = timeoutMs;
  }
}
