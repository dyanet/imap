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
import { ImapError, ImapProtocolError } from './types/errors.js';

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
      port: this.config.imap.port,
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
   * Authenticates with the server using LOGIN command
   */
  private async authenticate(): Promise<void> {
    if (!this.protocol) {
      throw new ImapError('No protocol handler', 'NO_PROTOCOL', 'protocol');
    }

    const command = CommandBuilder.login(
      this.config.imap.user,
      this.config.imap.password
    );

    await this.protocol.executeCommand(command, {
      timeout: this.config.imap.authTimeout
    });
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
   * @param criteria - Array of search criteria
   * @param fetchOptions - Optional fetch options to retrieve message data
   * @returns Promise resolving to array of Messages (if fetchOptions provided) or UIDs
   * @throws ImapProtocolError if the search fails
   * 
   * @example
   * ```typescript
   * // Search for unseen messages
   * const messages = await client.search(['UNSEEN'], { bodies: ['HEADER'] });
   * 
   * // Search with multiple criteria (AND logic)
   * const messages = await client.search([
   *   'UNSEEN',
   *   ['FROM', 'sender@example.com'],
   *   ['SINCE', new Date('2024-01-01')]
   * ]);
   * ```
   */
  async search(criteria: SearchCriteria[], fetchOptions?: FetchOptions): Promise<Message[]> {
    this.ensureConnected();
    this.ensureMailboxSelected();

    // Build and execute SEARCH command
    const searchCommand = CommandBuilder.search(criteria);
    const searchResponse = await this.protocol!.executeCommand(searchCommand);
    
    // Parse UIDs from response
    const uids = ResponseParser.parseSearchResponse(searchResponse.untagged);
    
    if (uids.length === 0) {
      return [];
    }

    // If no fetch options, return empty messages with just UIDs
    if (!fetchOptions) {
      return uids.map(uid => ({
        seqno: 0,
        uid,
        attributes: {
          uid,
          flags: [],
          date: new Date(),
          size: 0
        },
        parts: []
      }));
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
