/**
 * ImapClient - Public API for @dyanet/imap
 * 
 * Provides a Promise-based API compatible with imap-simple for IMAP operations.
 * 
 * @packageDocumentation
 */

import { EventEmitter } from 'events';
import { ImapConnection } from './transport/connection.js';
import { ImapProtocol } from './protocol/imap-protocol.js';
import { CommandBuilder } from './commands/builder.js';
import { ResponseParser } from './protocol/response-parser.js';
import type { ImapConfig, ConnectionOptions } from './types/config.js';
import type { Mailbox, MailboxTree } from './types/mailbox.js';
import type { Message } from './types/message.js';
import type { SearchCriteria, FetchOptions } from './types/search.js';
import type { UntaggedResponse } from './types/protocol.js';
import { ImapError, ImapProtocolError } from './types/errors.js';

/**
 * IDLE notification types
 */
export interface IdleNotification {
  /** Type of notification */
  type: 'exists' | 'expunge' | 'fetch' | 'recent' | 'other';
  /** Message sequence number (for EXISTS, EXPUNGE, FETCH) */
  seqno?: number;
  /** New message count (for EXISTS) */
  count?: number;
  /** Flags (for FETCH) */
  flags?: string[];
  /** UID (for FETCH) */
  uid?: number;
  /** Raw response data */
  raw: string;
}

/**
 * IDLE session controller
 * Returned by idle() method to control the IDLE session
 */
export interface IdleController extends EventEmitter {
  /** Stop the IDLE session */
  stop(): Promise<void>;
  /** Whether the IDLE session is active */
  readonly isActive: boolean;
}

/**
 * Internal IDLE controller implementation
 */
class IdleControllerImpl extends EventEmitter implements IdleController {
  private _isActive: boolean = true;
  private stopFn: () => Promise<void>;

  constructor(stopFn: () => Promise<void>) {
    super();
    this.stopFn = stopFn;
  }

  get isActive(): boolean {
    return this._isActive;
  }

  async stop(): Promise<void> {
    if (!this._isActive) return;
    this._isActive = false;
    await this.stopFn();
    this.emit('end');
  }

  /** @internal */
  _setInactive(): void {
    this._isActive = false;
  }
}

/**
 * Default configuration values
 */
const DEFAULT_PORT = 993;
const DEFAULT_TLS = true;
const DEFAULT_AUTH_TIMEOUT = 30000;
const DEFAULT_CONN_TIMEOUT = 30000;

/**
 * ImapClient provides a high-level, Promise-based API for IMAP operations.
 * Compatible with imap-simple API for easy migration.
 * 
 * @example
 * ```typescript
 * const client = await ImapClient.connect({
 *   imap: {
 *     host: 'imap.example.com',
 *     port: 993,
 *     user: 'user@example.com',
 *     password: 'password',
 *     tls: true
 *   }
 * });
 * 
 * await client.openBox('INBOX');
 * const messages = await client.search(['UNSEEN'], { bodies: ['HEADER'] });
 * await client.end();
 * ```
 */
export class ImapClient extends EventEmitter {
  private config: ImapConfig;
  private connection: ImapConnection | null = null;
  private protocol: ImapProtocol | null = null;
  private currentMailbox: Mailbox | null = null;
  private _isConnected: boolean = false;
  private _capabilities: Set<string> = new Set();
  private _idleController: IdleControllerImpl | null = null;

  /**
   * Creates a new ImapClient instance.
   * Use the static connect() method to create and connect in one step.
   * 
   * @param config - imap-simple compatible configuration object
   */
  constructor(config: ImapConfig) {
    super();
    this.config = this.normalizeConfig(config);
  }

  /**
   * Whether the client is currently connected
   */
  get isConnected(): boolean {
    return this._isConnected;
  }

  /**
   * The currently selected mailbox, or null if none selected
   */
  get selectedMailbox(): Mailbox | null {
    return this.currentMailbox;
  }


  /**
   * Normalizes the configuration object to ensure all required fields have values.
   * Handles imap-simple compatible configuration format.
   * 
   * @param config - Raw configuration object
   * @returns Normalized configuration
   */
  private normalizeConfig(config: ImapConfig): ImapConfig {
    const imap = config.imap;
    
    return {
      imap: {
        host: imap.host,
        port: imap.port ?? DEFAULT_PORT,
        user: imap.user,
        password: imap.password,
        xoauth2: imap.xoauth2,
        tls: imap.tls ?? DEFAULT_TLS,
        tlsOptions: imap.tlsOptions,
        authTimeout: imap.authTimeout ?? DEFAULT_AUTH_TIMEOUT,
        connTimeout: imap.connTimeout ?? DEFAULT_CONN_TIMEOUT
      }
    };
  }

  /**
   * Creates connection options from the configuration
   */
  private getConnectionOptions(): ConnectionOptions {
    return {
      host: this.config.imap.host,
      port: this.config.imap.port ?? DEFAULT_PORT,
      tls: this.config.imap.tls ?? DEFAULT_TLS,
      tlsOptions: this.config.imap.tlsOptions,
      connTimeout: this.config.imap.connTimeout ?? DEFAULT_CONN_TIMEOUT
    };
  }

  /**
   * Creates a new ImapClient and connects to the server.
   * This is the recommended way to create an ImapClient instance.
   * 
   * @param config - imap-simple compatible configuration object
   * @returns Promise resolving to a connected ImapClient
   * @throws ImapNetworkError if connection fails
   * @throws ImapProtocolError if authentication fails
   * 
   * @example
   * ```typescript
   * const client = await ImapClient.connect({
   *   imap: {
   *     host: 'imap.example.com',
   *     port: 993,
   *     user: 'user@example.com',
   *     password: 'password',
   *     tls: true
   *   }
   * });
   * ```
   */
  static async connect(config: ImapConfig): Promise<ImapClient> {
    const client = new ImapClient(config);
    await client.connectInternal();
    return client;
  }

  /**
   * Internal method to establish connection and authenticate
   */
  private async connectInternal(): Promise<void> {
    // Create connection
    this.connection = new ImapConnection(this.getConnectionOptions());
    
    // Setup connection event handlers
    this.connection.on('error', (err: Error) => {
      this._isConnected = false;
      this.emit('error', err);
    });
    
    this.connection.on('close', () => {
      this._isConnected = false;
      this.currentMailbox = null;
      this.emit('close');
    });

    // Connect to server
    await this.connection.connect();

    // Create protocol handler
    this.protocol = new ImapProtocol(this.connection, {
      timeout: this.config.imap.authTimeout
    });

    // Wait for server greeting
    await this.waitForGreeting();

    // Authenticate
    await this.authenticate();

    this._isConnected = true;
  }

  /**
   * Waits for the server greeting after connection
   */
  private waitForGreeting(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new ImapError('No connection', 'NO_CONNECTION', 'protocol'));
        return;
      }

      const timeout = setTimeout(() => {
        reject(new ImapError('Timeout waiting for server greeting', 'GREETING_TIMEOUT', 'timeout'));
      }, this.config.imap.connTimeout ?? DEFAULT_CONN_TIMEOUT);

      // The greeting is an untagged OK response
      const onData = (chunk: Buffer) => {
        const data = chunk.toString('utf8');
        if (data.includes('* OK') || data.includes('* PREAUTH')) {
          clearTimeout(timeout);
          this.connection?.removeListener('data', onData);
          
          // Try to parse capabilities from greeting (e.g., "* OK [CAPABILITY IMAP4rev1 IDLE ...] Ready")
          this.parseCapabilitiesFromGreeting(data);
          
          resolve();
        } else if (data.includes('* BYE')) {
          clearTimeout(timeout);
          this.connection?.removeListener('data', onData);
          reject(new ImapProtocolError('Server rejected connection', data, 'CONNECT'));
        }
      };

      this.connection.on('data', onData);
    });
  }

  /**
   * Parses capabilities from the server greeting
   * @internal
   */
  private parseCapabilitiesFromGreeting(greeting: string): void {
    // Look for [CAPABILITY ...] in the greeting
    const capMatch = greeting.match(/\[CAPABILITY\s+([^\]]+)\]/i);
    if (capMatch) {
      const caps = capMatch[1].split(/\s+/);
      for (const cap of caps) {
        if (cap) {
          this._capabilities.add(cap.toUpperCase());
        }
      }
    }
  }

  /**
   * Authenticates with the server using LOGIN or XOAUTH2 command
   */
  private async authenticate(): Promise<void> {
    if (!this.protocol) {
      throw new ImapError('No protocol handler', 'NO_PROTOCOL', 'protocol');
    }

    let response;

    // Check if XOAUTH2 authentication is configured
    if (this.config.imap.xoauth2) {
      response = await this.authenticateXOAuth2(
        this.config.imap.xoauth2.user,
        this.config.imap.xoauth2.accessToken
      );
    } else if (this.config.imap.password) {
      const command = CommandBuilder.login(
        this.config.imap.user,
        this.config.imap.password
      );
      response = await this.protocol.executeCommand(command, {
        timeout: this.config.imap.authTimeout
      });
    } else {
      throw new ImapError('No authentication credentials provided', 'NO_CREDENTIALS', 'protocol');
    }

    // Parse capabilities from authentication response (may be included in OK response)
    this.parseCapabilitiesFromResponse(response.text);
    
    // If no capabilities were found, refresh them explicitly
    // Use internal method that doesn't check connection state
    if (this._capabilities.size === 0) {
      await this.fetchCapabilities();
    }
  }

  /**
   * Performs XOAUTH2 authentication with proper continuation handling.
   * 
   * XOAUTH2 authentication flow:
   * 1. Client sends: AUTHENTICATE XOAUTH2 <base64-token>
   * 2. Server responds with either:
   *    - Tagged OK response (success)
   *    - Continuation (+) with base64-encoded error JSON (failure)
   * 3. On continuation, client sends empty line to get final tagged response
   * 
   * @param user - User email address
   * @param accessToken - OAuth2 access token
   * @returns Promise resolving to the authentication response
   */
  private async authenticateXOAuth2(user: string, accessToken: string): Promise<{ text: string }> {
    if (!this.protocol || !this.connection) {
      throw new ImapError('No protocol handler', 'NO_PROTOCOL', 'protocol');
    }

    // Capture references to avoid null checks in callbacks
    const protocol = this.protocol;
    const connection = this.connection;
    const command = CommandBuilder.authenticateXOAuth2(user, accessToken);
    
    return new Promise((resolve, reject) => {
      const timeout = this.config.imap.authTimeout ?? DEFAULT_AUTH_TIMEOUT;
      let timeoutId: NodeJS.Timeout | undefined;
      let continuationHandler: ((text: string) => void) | undefined;
      let errorMessage: string | undefined;

      // Set up timeout
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          if (continuationHandler) {
            protocol.removeListener('continuation', continuationHandler);
          }
          reject(new ImapError(`Authentication timed out after ${timeout}ms`, 'AUTH_TIMEOUT', 'timeout'));
        }, timeout);
      }

      // Handle continuation response (authentication error from server)
      continuationHandler = (text: string) => {
        // Server sent a continuation with base64-encoded error
        // Decode and store the error message
        if (text) {
          try {
            const decoded = Buffer.from(text, 'base64').toString('utf8');
            // Gmail sends JSON like: {"status":"400","schemes":"Bearer","scope":"https://mail.google.com/"}
            errorMessage = decoded;
          } catch {
            errorMessage = text;
          }
        }
        
        // Send empty line to get the final tagged response
        try {
          connection.sendLine('');
        } catch (err) {
          if (timeoutId) clearTimeout(timeoutId);
          protocol.removeListener('continuation', continuationHandler!);
          reject(err);
        }
      };

      protocol.once('continuation', continuationHandler);

      // Execute the command
      protocol.executeCommand(command, { timeout })
        .then((response) => {
          if (timeoutId) clearTimeout(timeoutId);
          protocol.removeListener('continuation', continuationHandler!);
          resolve(response);
        })
        .catch((err) => {
          if (timeoutId) clearTimeout(timeoutId);
          protocol.removeListener('continuation', continuationHandler!);
          
          // Enhance error message with decoded XOAUTH2 error if available
          if (errorMessage && err instanceof Error) {
            const enhancedMessage = `${err.message} (XOAUTH2 error: ${errorMessage})`;
            reject(new ImapProtocolError(enhancedMessage, errorMessage, 'AUTHENTICATE'));
          } else {
            reject(err);
          }
        });
    });
  }

  /**
   * Parses capabilities from a response text
   * @internal
   */
  private parseCapabilitiesFromResponse(text: string): void {
    // Look for [CAPABILITY ...] in the response
    const capMatch = text.match(/\[CAPABILITY\s+([^\]]+)\]/i);
    if (capMatch) {
      const caps = capMatch[1].split(/\s+/);
      for (const cap of caps) {
        if (cap) {
          this._capabilities.add(cap.toUpperCase());
        }
      }
    }
  }


  /**
   * Closes the connection gracefully.
   * Sends LOGOUT command and closes the socket.
   * 
   * @returns Promise that resolves when disconnected
   * 
   * @example
   * ```typescript
   * await client.end();
   * ```
   */
  async end(): Promise<void> {
    if (!this._isConnected || !this.protocol || !this.connection) {
      return;
    }

    // Stop IDLE if active
    if (this._idleController && this._idleController.isActive) {
      try {
        await this._idleController.stop();
      } catch {
        // Ignore errors during IDLE stop
      }
    }

    try {
      // Send LOGOUT command
      const command = CommandBuilder.logout();
      await this.protocol.executeCommand(command, { timeout: 5000 });
    } catch {
      // Ignore errors during logout - we're closing anyway
    }

    // Close the connection
    await this.connection.disconnect();
    
    this._isConnected = false;
    this.currentMailbox = null;
    this.protocol = null;
    this.connection = null;
    this._idleController = null;
  }

  /**
   * Lists all mailboxes on the server.
   * 
   * @returns Promise resolving to a MailboxTree structure
   * @throws ImapProtocolError if the command fails
   * 
   * @example
   * ```typescript
   * const boxes = await client.getBoxes();
   * console.log(boxes.INBOX); // { attribs: [], delimiter: '/', children: {...} }
   * ```
   */
  async getBoxes(): Promise<MailboxTree> {
    this.ensureConnected();

    const command = CommandBuilder.list('', '*');
    const response = await this.protocol!.executeCommand(command);
    
    return ResponseParser.parseListResponse(response.untagged);
  }

  /**
   * Opens a mailbox for operations.
   * 
   * @param mailboxName - Name of the mailbox to open (e.g., 'INBOX')
   * @param readOnly - If true, opens in read-only mode (EXAMINE instead of SELECT)
   * @returns Promise resolving to the Mailbox status
   * @throws ImapProtocolError if the mailbox doesn't exist or can't be opened
   * 
   * @example
   * ```typescript
   * const box = await client.openBox('INBOX');
   * console.log(box.messages.total); // Total message count
   * ```
   */
  async openBox(mailboxName: string, readOnly: boolean = false): Promise<Mailbox> {
    this.ensureConnected();

    const command = readOnly 
      ? CommandBuilder.examine(mailboxName)
      : CommandBuilder.select(mailboxName);
    
    const response = await this.protocol!.executeCommand(command);
    
    this.currentMailbox = ResponseParser.parseSelectResponse(
      response.untagged,
      mailboxName,
      readOnly
    );
    
    return this.currentMailbox;
  }

  /**
   * Opens a mailbox with QRESYNC for quick resynchronization (RFC 7162).
   * 
   * QRESYNC allows efficient mailbox resync by providing the server with
   * the last known state. The server responds with VANISHED responses
   * indicating which messages have been expunged since the last sync.
   * 
   * Requires QRESYNC capability. Use hasCapability('QRESYNC') to check.
   * 
   * @param mailboxName - Name of the mailbox to open
   * @param qresync - QRESYNC parameters from previous session
   * @param readOnly - If true, opens in read-only mode
   * @returns Promise resolving to QresyncResult with mailbox and vanished UIDs
   * @throws ImapError if QRESYNC is not supported
   * @throws ImapProtocolError if the command fails
   * 
   * @example
   * ```typescript
   * // First session - save state
   * const box = await client.openBox('INBOX');
   * const savedState = {
   *   uidValidity: box.uidvalidity,
   *   lastKnownModseq: box.highestModseq!
   * };
   * 
   * // Later session - resync
   * const result = await client.openBoxWithQresync('INBOX', savedState);
   * console.log('Vanished UIDs:', result.vanished);
   * ```
   */
  async openBoxWithQresync(
    mailboxName: string,
    qresync: {
      uidValidity: number;
      lastKnownModseq: bigint;
      knownUids?: string;
      sequenceMatch?: { seqSet: string; uidSet: string };
    },
    readOnly: boolean = false
  ): Promise<{ mailbox: Mailbox; vanished: number[]; vanishedEarlier: boolean }> {
    this.ensureConnected();

    // Check if QRESYNC is supported
    if (this._capabilities.size > 0 && !this._capabilities.has('QRESYNC')) {
      throw new ImapError('Server does not support QRESYNC extension', 'QRESYNC_NOT_SUPPORTED', 'protocol');
    }

    const command = readOnly
      ? CommandBuilder.examineWithQresync(mailboxName, qresync)
      : CommandBuilder.selectWithQresync(mailboxName, qresync);
    
    const response = await this.protocol!.executeCommand(command);
    
    // Parse mailbox status
    this.currentMailbox = ResponseParser.parseSelectResponse(
      response.untagged,
      mailboxName,
      readOnly
    );

    // Parse VANISHED responses
    const vanished: number[] = [];
    let vanishedEarlier = false;

    for (const untagged of response.untagged) {
      if (untagged.type === 'VANISHED') {
        const data = untagged.data as { earlier: boolean; uids: number[] };
        vanished.push(...data.uids);
        if (data.earlier) {
          vanishedEarlier = true;
        }
      }
    }
    
    return {
      mailbox: this.currentMailbox,
      vanished,
      vanishedEarlier
    };
  }

  /**
   * Creates a new mailbox on the server.
   * 
   * @param mailboxName - Name of the mailbox to create
   * @returns Promise that resolves when the mailbox is created
   * @throws ImapProtocolError if the mailbox can't be created
   * 
   * @example
   * ```typescript
   * await client.addBox('Archive');
   * ```
   */
  async addBox(mailboxName: string): Promise<void> {
    this.ensureConnected();

    const command = CommandBuilder.create(mailboxName);
    await this.protocol!.executeCommand(command);
  }

  /**
   * Deletes a mailbox from the server.
   * 
   * @param mailboxName - Name of the mailbox to delete
   * @returns Promise that resolves when the mailbox is deleted
   * @throws ImapProtocolError if the mailbox can't be deleted
   * 
   * @example
   * ```typescript
   * await client.delBox('OldFolder');
   * ```
   */
  async delBox(mailboxName: string): Promise<void> {
    this.ensureConnected();

    const command = CommandBuilder.delete(mailboxName);
    await this.protocol!.executeCommand(command);
  }

  /**
   * Renames a mailbox on the server.
   * 
   * @param oldName - Current name of the mailbox
   * @param newName - New name for the mailbox
   * @returns Promise that resolves when the mailbox is renamed
   * @throws ImapProtocolError if the mailbox can't be renamed
   * 
   * @example
   * ```typescript
   * await client.renameBox('OldName', 'NewName');
   * ```
   */
  async renameBox(oldName: string, newName: string): Promise<void> {
    this.ensureConnected();

    const command = CommandBuilder.rename(oldName, newName);
    await this.protocol!.executeCommand(command);
  }


  /**
   * Searches for messages matching the given criteria.
   * 
   * When called without fetchOptions, returns an array of UIDs (numbers).
   * When called with fetchOptions, returns an array of Message objects with fetched data.
   * 
   * @param criteria - Array of search criteria
   * @param fetchOptions - Optional fetch options to retrieve message data
   * @returns Promise resolving to array of UIDs (without fetchOptions) or Messages (with fetchOptions)
   * @throws ImapProtocolError if the search fails
   * 
   * @example
   * ```typescript
   * // Search for UIDs only (no fetch)
   * const uids = await client.search(['UNSEEN']);
   * console.log(uids); // [1, 2, 3]
   * 
   * // Search and fetch message data
   * const messages = await client.search(['UNSEEN'], { bodies: ['HEADER'] });
   * 
   * // Search with multiple criteria (AND logic)
   * const messages = await client.search([
   *   'UNSEEN',
   *   ['FROM', 'sender@example.com'],
   *   ['SINCE', new Date('2024-01-01')]
   * ], { bodies: ['HEADER', 'TEXT'] });
   * ```
   */
  async search(criteria: SearchCriteria[]): Promise<number[]>;
  async search(criteria: SearchCriteria[], fetchOptions: FetchOptions): Promise<Message[]>;
  async search(criteria: SearchCriteria[], fetchOptions?: FetchOptions): Promise<number[] | Message[]> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    // Build and execute UID SEARCH command to get UIDs (not sequence numbers)
    const searchCommand = `UID ${CommandBuilder.search(criteria)}`;
    const searchResponse = await this.protocol!.executeCommand(searchCommand);
    
    // Parse UIDs from response
    const uids = ResponseParser.parseSearchResponse(searchResponse.untagged);
    
    if (uids.length === 0) {
      return [];
    }

    // If no fetch options, return UIDs directly
    if (!fetchOptions) {
      return uids;
    }

    // Fetch the messages
    return this.fetch(uids, fetchOptions);
  }

  /**
   * Fetches messages by UID or sequence number.
   * 
   * @param source - UID sequence string (e.g., '1:*', '1,2,3') or array of UIDs
   * @param fetchOptions - Options specifying what to fetch
   * @returns Promise resolving to array of Message objects
   * @throws ImapProtocolError if the fetch fails
   * 
   * @example
   * ```typescript
   * // Fetch by UID array
   * const messages = await client.fetch([1, 2, 3], { bodies: ['HEADER', 'TEXT'] });
   * 
   * // Fetch by sequence string
   * const messages = await client.fetch('1:10', { bodies: ['HEADER'], struct: true });
   * ```
   */
  async fetch(source: string | number[], fetchOptions: FetchOptions): Promise<Message[]> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    // Convert array of UIDs to sequence string
    const sequence = Array.isArray(source) 
      ? source.join(',')
      : source;

    if (!sequence || sequence === '') {
      return [];
    }

    // Build and execute FETCH command with UID prefix
    const fetchCommand = `UID ${CommandBuilder.fetch(sequence, fetchOptions)}`;
    const fetchResponse = await this.protocol!.executeCommand(fetchCommand);
    
    // Parse messages from response
    return ResponseParser.parseFetchResponse(fetchResponse.untagged);
  }

  /**
   * Adds flags to messages.
   * 
   * @param uids - Array of message UIDs
   * @param flags - Array of flags to add (e.g., ['\\Seen', '\\Flagged'])
   * @returns Promise that resolves when flags are added
   * @throws ImapProtocolError if the operation fails
   * 
   * @example
   * ```typescript
   * await client.addFlags([1, 2, 3], ['\\Seen']);
   * ```
   */
  async addFlags(uids: number[], flags: string[]): Promise<void> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    if (uids.length === 0 || flags.length === 0) {
      return;
    }

    const sequence = uids.join(',');
    const command = `UID ${CommandBuilder.store(sequence, flags, 'add')}`;
    await this.protocol!.executeCommand(command);
  }

  /**
   * Removes flags from messages.
   * 
   * @param uids - Array of message UIDs
   * @param flags - Array of flags to remove
   * @returns Promise that resolves when flags are removed
   * @throws ImapProtocolError if the operation fails
   * 
   * @example
   * ```typescript
   * await client.delFlags([1, 2, 3], ['\\Seen']);
   * ```
   */
  async delFlags(uids: number[], flags: string[]): Promise<void> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    if (uids.length === 0 || flags.length === 0) {
      return;
    }

    const sequence = uids.join(',');
    const command = `UID ${CommandBuilder.store(sequence, flags, 'remove')}`;
    await this.protocol!.executeCommand(command);
  }


  /**
   * Moves messages to another mailbox.
   * This copies the messages to the destination and marks the originals as deleted.
   * Call expunge() to permanently remove the originals.
   * 
   * @param uids - Array of message UIDs to move
   * @param destBox - Destination mailbox name
   * @returns Promise that resolves when messages are moved
   * @throws ImapProtocolError if the operation fails
   * 
   * @example
   * ```typescript
   * await client.move([1, 2, 3], 'Archive');
   * await client.expunge(); // Remove originals
   * ```
   */
  async move(uids: number[], destBox: string): Promise<void> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    if (uids.length === 0) {
      return;
    }

    // Copy to destination
    await this.copy(uids, destBox);

    // Mark originals as deleted
    await this.addFlags(uids, ['\\Deleted']);
  }

  /**
   * Copies messages to another mailbox.
   * 
   * @param uids - Array of message UIDs to copy
   * @param destBox - Destination mailbox name
   * @returns Promise that resolves when messages are copied
   * @throws ImapProtocolError if the operation fails
   * 
   * @example
   * ```typescript
   * await client.copy([1, 2, 3], 'Backup');
   * ```
   */
  async copy(uids: number[], destBox: string): Promise<void> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    if (uids.length === 0) {
      return;
    }

    const sequence = uids.join(',');
    const command = `UID ${CommandBuilder.copy(sequence, destBox)}`;
    await this.protocol!.executeCommand(command);
  }

  /**
   * Permanently removes messages marked with \\Deleted flag.
   * 
   * @returns Promise that resolves when expunge is complete
   * @throws ImapProtocolError if the operation fails
   * 
   * @example
   * ```typescript
   * await client.addFlags([1, 2], ['\\Deleted']);
   * await client.expunge(); // Permanently remove
   * ```
   */
  async expunge(): Promise<void> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    const command = CommandBuilder.expunge();
    await this.protocol!.executeCommand(command);
  }

  /**
   * Enters IDLE mode for real-time mailbox notifications (RFC 2177).
   * 
   * Returns an IdleController that emits events when the mailbox changes:
   * - 'exists': New message count changed
   * - 'expunge': A message was expunged
   * - 'fetch': Message flags changed
   * - 'recent': Recent message count changed
   * - 'notification': Any mailbox notification (raw)
   * - 'error': An error occurred
   * - 'end': IDLE session ended
   * 
   * @returns Promise resolving to an IdleController
   * @throws ImapError if IDLE is not supported or not connected
   * @throws ImapProtocolError if the server rejects IDLE
   * 
   * @example
   * ```typescript
   * const idle = await client.idle();
   * 
   * idle.on('exists', (count) => {
   *   console.log(`New message count: ${count}`);
   * });
   * 
   * idle.on('expunge', (seqno) => {
   *   console.log(`Message ${seqno} was expunged`);
   * });
   * 
   * // Stop IDLE when done
   * await idle.stop();
   * ```
   */
  async idle(): Promise<IdleController> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    // Check if already in IDLE mode
    if (this._idleController && this._idleController.isActive) {
      throw new ImapError('Already in IDLE mode', 'ALREADY_IDLE', 'protocol');
    }

    // Check if IDLE is supported (if capabilities are known)
    if (this._capabilities.size > 0 && !this._capabilities.has('IDLE')) {
      throw new ImapError('Server does not support IDLE extension', 'IDLE_NOT_SUPPORTED', 'protocol');
    }

    // Create the controller
    const controller = new IdleControllerImpl(async () => {
      await this.stopIdle();
    });
    this._idleController = controller;

    // Set up untagged response handler for IDLE notifications
    const untaggedHandler = (response: UntaggedResponse) => {
      if (!controller.isActive) return;

      const notification = this.parseIdleNotification(response);
      
      // Emit specific event based on type
      switch (notification.type) {
        case 'exists':
          controller.emit('exists', notification.count);
          break;
        case 'expunge':
          controller.emit('expunge', notification.seqno);
          break;
        case 'fetch':
          controller.emit('fetch', {
            seqno: notification.seqno,
            flags: notification.flags,
            uid: notification.uid
          });
          break;
        case 'recent':
          controller.emit('recent', notification.count);
          break;
      }

      // Always emit the raw notification
      controller.emit('notification', notification);
    };

    // Listen for untagged responses
    this.protocol!.on('untagged', untaggedHandler);

    // Clean up handler when IDLE ends
    controller.once('end', () => {
      this.protocol?.removeListener('untagged', untaggedHandler);
      if (this._idleController === controller) {
        this._idleController = null;
      }
    });

    // Enter IDLE mode
    try {
      await this.protocol!.enterIdle();
    } catch (err) {
      controller._setInactive();
      this.protocol?.removeListener('untagged', untaggedHandler);
      this._idleController = null;
      throw err;
    }

    return controller;
  }

  /**
   * Stops the current IDLE session
   * @internal
   */
  private async stopIdle(): Promise<void> {
    if (!this.protocol || !this.protocol.isIdling) {
      return;
    }

    try {
      await this.protocol.exitIdle();
    } catch {
      // Ignore errors during IDLE exit - connection may be closed
    }
  }

  /**
   * Parses an untagged response into an IdleNotification
   * @internal
   */
  private parseIdleNotification(response: UntaggedResponse): IdleNotification {
    const raw = response.raw;
    const type = response.type.toUpperCase();

    // Parse EXISTS: * 23 EXISTS
    if (type === 'EXISTS') {
      const count = typeof response.data === 'number' ? response.data : parseInt(String(response.data), 10);
      return { type: 'exists', count, raw };
    }

    // Parse EXPUNGE: * 3 EXPUNGE
    if (type === 'EXPUNGE') {
      const seqno = typeof response.data === 'number' ? response.data : parseInt(String(response.data), 10);
      return { type: 'expunge', seqno, raw };
    }

    // Parse RECENT: * 5 RECENT
    if (type === 'RECENT') {
      const count = typeof response.data === 'number' ? response.data : parseInt(String(response.data), 10);
      return { type: 'recent', count, raw };
    }

    // Parse FETCH: * 14 FETCH (FLAGS (\Seen))
    if (type === 'FETCH') {
      const data = response.data as { seqno?: number; flags?: string[]; uid?: number } | undefined;
      return {
        type: 'fetch',
        seqno: data?.seqno,
        flags: data?.flags,
        uid: data?.uid,
        raw
      };
    }

    // Other notification types
    return { type: 'other', raw };
  }

  /**
   * Checks if the server supports a specific capability
   * 
   * @param capability - The capability to check (e.g., 'IDLE', 'CONDSTORE')
   * @returns true if the capability is supported
   * 
   * @example
   * ```typescript
   * if (client.hasCapability('IDLE')) {
   *   const idle = await client.idle();
   * }
   * ```
   */
  hasCapability(capability: string): boolean {
    return this._capabilities.has(capability.toUpperCase());
  }

  /**
   * Checks if the server supports CONDSTORE extension (RFC 7162)
   * 
   * CONDSTORE provides efficient flag synchronization using MODSEQ values.
   * 
   * @returns true if CONDSTORE is supported
   * 
   * @example
   * ```typescript
   * if (client.hasCondstore()) {
   *   // Use CHANGEDSINCE modifier in FETCH/SEARCH
   *   const messages = await client.fetch('1:*', { 
   *     modseq: true,
   *     changedSince: lastKnownModseq 
   *   });
   * }
   * ```
   */
  hasCondstore(): boolean {
    return this._capabilities.has('CONDSTORE');
  }

  /**
   * Checks if the server supports QRESYNC extension (RFC 7162)
   * 
   * QRESYNC provides quick mailbox resynchronization by returning
   * VANISHED responses for expunged messages.
   * 
   * Note: QRESYNC implies CONDSTORE support.
   * 
   * @returns true if QRESYNC is supported
   * 
   * @example
   * ```typescript
   * if (client.hasQresync()) {
   *   const result = await client.openBoxWithQresync('INBOX', {
   *     uidValidity: savedUidValidity,
   *     lastKnownModseq: savedModseq
   *   });
   *   console.log('Vanished UIDs:', result.vanished);
   * }
   * ```
   */
  hasQresync(): boolean {
    return this._capabilities.has('QRESYNC');
  }

  /**
   * Gets all server capabilities
   * 
   * @returns Set of capability strings
   */
  getCapabilities(): Set<string> {
    return new Set(this._capabilities);
  }

  /**
   * Refreshes the server capabilities
   * 
   * @returns Promise resolving to the set of capabilities
   */
  async refreshCapabilities(): Promise<Set<string>> {
    this.ensureConnected();
    return this.fetchCapabilities();
  }

  /**
   * Internal method to fetch capabilities without connection check.
   * Used during initial authentication when _isConnected is not yet true.
   * @internal
   */
  private async fetchCapabilities(): Promise<Set<string>> {
    if (!this.protocol) {
      throw new ImapError('No protocol handler', 'NO_PROTOCOL', 'protocol');
    }

    const command = CommandBuilder.capability();
    const response = await this.protocol.executeCommand(command);

    // Parse capabilities from response
    this._capabilities.clear();
    for (const untagged of response.untagged) {
      if (untagged.type === 'CAPABILITY') {
        const caps = String(untagged.data).split(' ');
        for (const cap of caps) {
          if (cap) {
            this._capabilities.add(cap.toUpperCase());
          }
        }
      }
    }

    return this.getCapabilities();
  }

  /**
   * Polls the mailbox for changes using NOOP command.
   * This is a fallback for servers that don't support IDLE.
   * 
   * Returns any untagged responses received, which may include
   * EXISTS, EXPUNGE, FETCH notifications.
   * 
   * @returns Promise resolving to array of notifications
   * 
   * @example
   * ```typescript
   * // Poll every 30 seconds if IDLE not supported
   * if (!client.hasCapability('IDLE')) {
   *   setInterval(async () => {
   *     const notifications = await client.poll();
   *     for (const n of notifications) {
   *       if (n.type === 'exists') {
   *         console.log(`New message count: ${n.count}`);
   *       }
   *     }
   *   }, 30000);
   * }
   * ```
   */
  async poll(): Promise<IdleNotification[]> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    const command = CommandBuilder.noop();
    const response = await this.protocol!.executeCommand(command);

    // Convert untagged responses to notifications
    const notifications: IdleNotification[] = [];
    for (const untagged of response.untagged) {
      notifications.push(this.parseIdleNotification(untagged));
    }

    return notifications;
  }

  /**
   * Starts watching the mailbox for changes.
   * Uses IDLE if supported, otherwise falls back to polling.
   * 
   * @param options - Watch options
   * @returns Promise resolving to an IdleController
   * 
   * @example
   * ```typescript
   * const watcher = await client.watch({ pollInterval: 30000 });
   * 
   * watcher.on('exists', (count) => {
   *   console.log(`New message count: ${count}`);
   * });
   * 
   * // Stop watching when done
   * await watcher.stop();
   * ```
   */
  async watch(options?: { pollInterval?: number }): Promise<IdleController> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    // Try IDLE first if supported
    if (this.hasCapability('IDLE')) {
      return this.idle();
    }

    // Fall back to polling
    const pollInterval = options?.pollInterval ?? 30000;
    return this.startPolling(pollInterval);
  }

  /**
   * Starts polling for mailbox changes
   * @internal
   */
  private startPolling(interval: number): IdleController {
    let isActive = true;
    let pollTimer: NodeJS.Timeout | null = null;

    const controller = new IdleControllerImpl(async () => {
      isActive = false;
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
    });

    const doPoll = async () => {
      if (!isActive || !this._isConnected) {
        controller._setInactive();
        if (pollTimer) {
          clearInterval(pollTimer);
        }
        controller.emit('end');
        return;
      }

      try {
        const notifications = await this.poll();
        for (const notification of notifications) {
          switch (notification.type) {
            case 'exists':
              controller.emit('exists', notification.count);
              break;
            case 'expunge':
              controller.emit('expunge', notification.seqno);
              break;
            case 'fetch':
              controller.emit('fetch', {
                seqno: notification.seqno,
                flags: notification.flags,
                uid: notification.uid
              });
              break;
            case 'recent':
              controller.emit('recent', notification.count);
              break;
          }
          controller.emit('notification', notification);
        }
      } catch (err) {
        controller.emit('error', err);
      }
    };

    // Start polling
    pollTimer = setInterval(doPoll, interval);

    // Do an initial poll
    doPoll();

    return controller;
  }

  /**
   * Ensures the client is connected
   * @throws ImapError if not connected
   */
  private ensureConnected(): void {
    if (!this._isConnected || !this.protocol) {
      throw new ImapError('Not connected to server', 'NOT_CONNECTED', 'protocol');
    }
  }

  /**
   * Ensures a mailbox is selected
   * @throws ImapError if no mailbox is selected
   */
  private ensureMailboxSelected(): void {
    if (!this.currentMailbox) {
      throw new ImapError('No mailbox selected. Call openBox() first.', 'NO_MAILBOX', 'protocol');
    }
  }
}
