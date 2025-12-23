/**
 * Configuration types for @dyanet/imap
 */

/**
 * TLS/SSL options for secure connections
 */
export interface TlsOptions {
  /** Whether to reject unauthorized certificates */
  rejectUnauthorized?: boolean;
  /** Certificate authority chain */
  ca?: string | Buffer | string[] | Buffer[];
  /** Client certificate */
  cert?: string | Buffer;
  /** Client private key */
  key?: string | Buffer;
  /** Server name for SNI (Server Name Indication) */
  servername?: string;
}

/**
 * OAuth2/XOAUTH2 authentication options
 * Used for Gmail, Microsoft 365, and other OAuth2-enabled providers
 */
export interface XOAuth2Options {
  /** User email address */
  user: string;
  /** OAuth2 access token */
  accessToken: string;
}

/**
 * Optional IMAP extensions configuration
 * Enable/disable optional IMAP protocol extensions
 */
export interface ImapExtensions {
  /** Enable IDLE extension for real-time notifications (RFC 2177) */
  idle?: boolean;
  /** Enable CONDSTORE extension for efficient flag sync (RFC 7162) */
  condstore?: boolean;
  /** Enable QRESYNC extension for quick mailbox resync (RFC 7162) */
  qresync?: boolean;
}

/**
 * OAuth2/XOAUTH2 authentication options
 * Used for Gmail, Microsoft 365, and other OAuth2-enabled providers
 */
export interface XOAuth2Options {
  /** User email address */
  user: string;
  /** OAuth2 access token */
  accessToken: string;
}

/**
 * Optional IMAP extensions configuration
 * Enable/disable optional IMAP protocol extensions
 */
export interface ImapExtensions {
  /** Enable IDLE extension for real-time notifications (RFC 2177) */
  idle?: boolean;
  /** Enable CONDSTORE extension for efficient flag sync (RFC 7162) */
  condstore?: boolean;
  /** Enable QRESYNC extension for quick mailbox resync (RFC 7162) */
  qresync?: boolean;
}

/**
 * IMAP connection configuration (imap-simple compatible)
 */
export interface ImapConfig {
  imap: {
    /** IMAP server hostname */
    host: string;
    /** IMAP server port (default: 993 for TLS, 143 for non-TLS) */
    port?: number;
    /** Username for authentication (used with password auth) */
    user: string;
    /** Password for authentication (used with password auth) */
    password?: string;
    /** OAuth2/XOAUTH2 authentication options (alternative to password) */
    xoauth2?: XOAuth2Options;
    /** Whether to use TLS/SSL (default: true) */
    tls?: boolean;
    /** TLS options for secure connections */
    tlsOptions?: TlsOptions;
    /** Authentication timeout in milliseconds (default: 30000) */
    authTimeout?: number;
    /** Connection timeout in milliseconds (default: 30000) */
    connTimeout?: number;
    /** Optional IMAP extensions to enable */
    extensions?: ImapExtensions;
  };
}

/**
 * Internal connection options
 */
export interface ConnectionOptions {
  host: string;
  port: number;
  tls: boolean;
  tlsOptions?: TlsOptions;
  connTimeout: number;
}
