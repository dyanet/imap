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
}

/**
 * IMAP connection configuration (imap-simple compatible)
 */
export interface ImapConfig {
  imap: {
    /** IMAP server hostname */
    host: string;
    /** IMAP server port */
    port: number;
    /** Username for authentication */
    user: string;
    /** Password for authentication */
    password: string;
    /** Whether to use TLS/SSL */
    tls?: boolean;
    /** TLS options for secure connections */
    tlsOptions?: TlsOptions;
    /** Authentication timeout in milliseconds */
    authTimeout?: number;
    /** Connection timeout in milliseconds */
    connTimeout?: number;
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
