/**
 * IMAP Protocol Layer
 * 
 * Wraps the transport connection and provides command execution,
 * tag generation, response correlation, literal handling, and timeout management.
 * 
 * @packageDocumentation
 */

import { EventEmitter } from 'events';
import { ImapConnection } from '../transport/connection.js';
import { parseResponse, isContinuationResponse, isTaggedResponse } from './parser.js';
import type { ImapResponse, UntaggedResponse } from '../types/protocol.js';
import { ImapProtocolError, ImapTimeoutError } from '../types/errors.js';

/**
 * Default timeout for operations in milliseconds
 */
const DEFAULT_TIMEOUT = 30000;

/**
 * Pending command waiting for response
 */
interface PendingCommand {
  tag: string;
  command: string;
  resolve: (response: ImapResponse) => void;
  reject: (error: Error) => void;
  untagged: UntaggedResponse[];
  timeoutId?: NodeJS.Timeout;
  literalData?: Buffer;
  literalSize?: number;
  literalCallback?: (data: Buffer) => void;
}

/**
 * ImapProtocol class wrapping connection
 * Handles tag generation, command execution, response correlation,
 * literal handling, and timeout management.
 */
export class ImapProtocol extends EventEmitter {
  private connection: ImapConnection;
  private tagCounter: number = 0;
  private tagPrefix: string = 'A';
  private pendingCommands: Map<string, PendingCommand> = new Map();
  private responseBuffer: string = '';
  private defaultTimeout: number;
  private literalPending: { size: number; callback: (data: Buffer) => void } | null = null;
  private literalBuffer: Buffer = Buffer.alloc(0);

  constructor(connection: ImapConnection, options?: { timeout?: number; tagPrefix?: string }) {
    super();
    this.connection = connection;
    this.defaultTimeout = options?.timeout ?? DEFAULT_TIMEOUT;
    if (options?.tagPrefix) {
      this.tagPrefix = options.tagPrefix;
    }
    this.setupConnectionListeners();
  }

  /**
   * Get the underlying connection
   */
  getConnection(): ImapConnection {
    return this.connection;
  }


  /**
   * Setup listeners for connection events
   */
  private setupConnectionListeners(): void {
    this.connection.on('data', (chunk: Buffer) => {
      this.handleData(chunk);
    });

    this.connection.on('error', (err: Error) => {
      // Reject all pending commands
      for (const pending of this.pendingCommands.values()) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        pending.reject(err);
      }
      this.pendingCommands.clear();
      this.emit('error', err);
    });

    this.connection.on('close', () => {
      // Reject all pending commands
      for (const pending of this.pendingCommands.values()) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        pending.reject(new Error('Connection closed'));
      }
      this.pendingCommands.clear();
      this.emit('close');
    });
  }

  /**
   * Handle incoming data from connection
   */
  private handleData(chunk: Buffer): void {
    // If we're waiting for literal data
    if (this.literalPending) {
      this.handleLiteralData(chunk);
      return;
    }

    // Append to response buffer
    this.responseBuffer += chunk.toString('utf8');
    this.processResponseBuffer();
  }

  /**
   * Handle literal data reception
   */
  private handleLiteralData(chunk: Buffer): void {
    if (!this.literalPending) return;

    this.literalBuffer = Buffer.concat([this.literalBuffer, chunk]);

    // Check if we have received all literal data
    if (this.literalBuffer.length >= this.literalPending.size) {
      const literalData = this.literalBuffer.subarray(0, this.literalPending.size);
      const remaining = this.literalBuffer.subarray(this.literalPending.size);
      
      // Call the callback with literal data
      this.literalPending.callback(literalData);
      
      // Reset literal state
      this.literalPending = null;
      this.literalBuffer = Buffer.alloc(0);
      
      // Process any remaining data as normal response
      if (remaining.length > 0) {
        this.responseBuffer += remaining.toString('utf8');
        this.processResponseBuffer();
      }
    }
  }


  /**
   * Process the response buffer for complete lines
   */
  private processResponseBuffer(): void {
    // Process complete lines (ending with CRLF)
    let lineEnd: number;
    
    while ((lineEnd = this.responseBuffer.indexOf('\r\n')) !== -1) {
      const line = this.responseBuffer.slice(0, lineEnd);
      this.responseBuffer = this.responseBuffer.slice(lineEnd + 2);
      
      // Check for literal marker {n}
      const literalMatch = line.match(/\{(\d+)\}\s*$/);
      if (literalMatch) {
        const literalSize = parseInt(literalMatch[1], 10);
        this.handleLiteralMarker(line, literalSize);
        continue;
      }
      
      this.processLine(line);
    }
  }

  /**
   * Handle a literal marker in the response
   */
  private handleLiteralMarker(line: string, size: number): void {
    // Find which pending command this belongs to
    // For now, we'll associate it with the line content
    
    // Set up literal reception
    this.literalPending = {
      size,
      callback: (data: Buffer) => {
        // Store the literal data and continue processing
        // The literal data will be associated with the current response
        this.processLineWithLiteral(line, data);
      }
    };
    
    // Check if we already have data in the buffer that's part of the literal
    if (this.responseBuffer.length > 0) {
      const chunk = Buffer.from(this.responseBuffer, 'utf8');
      this.responseBuffer = '';
      this.handleLiteralData(chunk);
    }
  }

  /**
   * Process a line that had literal data
   */
  private processLineWithLiteral(line: string, literalData: Buffer): void {
    // Replace the literal marker with the actual data for parsing
    const lineWithoutLiteral = line.replace(/\{(\d+)\}\s*$/, '');
    const fullLine = lineWithoutLiteral + literalData.toString('utf8');
    this.processLine(fullLine);
  }

  /**
   * Process a single response line
   */
  private processLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Check if this is a continuation response
    if (isContinuationResponse(trimmed)) {
      this.handleContinuation(trimmed);
      return;
    }

    // Check if this is a tagged response
    if (isTaggedResponse(trimmed)) {
      this.handleTaggedResponse(trimmed);
      return;
    }

    // This is an untagged response - add to all pending commands
    const parsed = parseResponse([trimmed]);
    if (parsed.untagged.length > 0) {
      for (const pending of this.pendingCommands.values()) {
        pending.untagged.push(...parsed.untagged);
      }
      // Also emit for listeners
      for (const untagged of parsed.untagged) {
        this.emit('untagged', untagged);
      }
    }
  }


  /**
   * Handle a continuation response
   */
  private handleContinuation(line: string): void {
    const text = line.slice(1).trim(); // Remove leading '+'
    this.emit('continuation', text);
  }

  /**
   * Handle a tagged response
   */
  private handleTaggedResponse(line: string): void {
    const parsed = parseResponse([line]);
    
    if (!parsed.tagged) return;
    
    const { tag, status, text } = parsed.tagged;
    const pending = this.pendingCommands.get(tag);
    
    if (!pending) {
      // Unknown tag - emit as event
      this.emit('unknownTag', { tag, status, text });
      return;
    }
    
    // Clear timeout
    if (pending.timeoutId) {
      clearTimeout(pending.timeoutId);
    }
    
    // Remove from pending
    this.pendingCommands.delete(tag);
    
    // Create response
    const response: ImapResponse = {
      tag,
      type: status,
      text,
      untagged: pending.untagged
    };
    
    // Resolve or reject based on status
    if (status === 'OK') {
      pending.resolve(response);
    } else {
      pending.reject(new ImapProtocolError(
        `Command failed: ${text}`,
        text,
        pending.command
      ));
    }
  }

  /**
   * Generate a unique command tag
   * Tags are in format: A001, A002, etc.
   */
  generateTag(): string {
    this.tagCounter++;
    return `${this.tagPrefix}${this.tagCounter.toString().padStart(3, '0')}`;
  }

  /**
   * Execute an IMAP command and wait for response
   * 
   * @param command - The IMAP command to execute (without tag)
   * @param options - Execution options
   * @returns Promise resolving to the command response
   * @throws ImapProtocolError if server returns NO or BAD
   * @throws ImapTimeoutError if operation times out
   */
  executeCommand(command: string, options?: { timeout?: number }): Promise<ImapResponse> {
    return new Promise((resolve, reject) => {
      const tag = this.generateTag();
      const timeout = options?.timeout ?? this.defaultTimeout;
      
      // Create pending command entry
      const pending: PendingCommand = {
        tag,
        command,
        resolve,
        reject,
        untagged: []
      };
      
      // Set up timeout if specified
      if (timeout > 0) {
        pending.timeoutId = setTimeout(() => {
          this.pendingCommands.delete(tag);
          reject(new ImapTimeoutError(
            `Command timed out after ${timeout}ms: ${command}`,
            command,
            timeout
          ));
        }, timeout);
      }
      
      // Store pending command
      this.pendingCommands.set(tag, pending);
      
      // Send command
      try {
        this.connection.sendLine(`${tag} ${command}`);
      } catch (err) {
        // Clean up on send failure
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        this.pendingCommands.delete(tag);
        reject(err);
      }
    });
  }


  /**
   * Execute a command that may require literal data
   * Used for commands like APPEND that send large data
   * 
   * @param command - The IMAP command with literal marker
   * @param literalData - The literal data to send
   * @param options - Execution options
   * @returns Promise resolving to the command response
   */
  executeCommandWithLiteral(
    command: string,
    literalData: Buffer | string,
    options?: { timeout?: number }
  ): Promise<ImapResponse> {
    return new Promise((resolve, reject) => {
      const tag = this.generateTag();
      const timeout = options?.timeout ?? this.defaultTimeout;
      const data = typeof literalData === 'string' ? Buffer.from(literalData) : literalData;
      
      // Create pending command entry
      const pending: PendingCommand = {
        tag,
        command,
        resolve,
        reject,
        untagged: [],
        literalData: data,
        literalSize: data.length
      };
      
      // Set up timeout
      if (timeout > 0) {
        pending.timeoutId = setTimeout(() => {
          this.pendingCommands.delete(tag);
          this.removeListener('continuation', continuationHandler);
          reject(new ImapTimeoutError(
            `Command timed out after ${timeout}ms: ${command}`,
            command,
            timeout
          ));
        }, timeout);
      }
      
      // Handler for continuation response
      const continuationHandler = () => {
        // Server is ready for literal data
        this.removeListener('continuation', continuationHandler);
        try {
          this.connection.send(data);
          this.connection.sendLine(''); // Send CRLF after literal
        } catch (err) {
          if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
          }
          this.pendingCommands.delete(tag);
          reject(err);
        }
      };
      
      // Listen for continuation
      this.once('continuation', continuationHandler);
      
      // Store pending command
      this.pendingCommands.set(tag, pending);
      
      // Send command with literal marker
      const commandWithLiteral = `${tag} ${command} {${data.length}}`;
      try {
        this.connection.sendLine(commandWithLiteral);
      } catch (err) {
        if (pending.timeoutId) {
          clearTimeout(pending.timeoutId);
        }
        this.pendingCommands.delete(tag);
        this.removeListener('continuation', continuationHandler);
        reject(err);
      }
    });
  }

  /**
   * Handle literal data for large responses
   * Returns a promise that resolves with the literal data
   * 
   * @param size - Expected size of literal data in bytes
   * @returns Promise resolving to the literal data
   */
  handleLiteral(size: number): Promise<Buffer> {
    return new Promise((resolve) => {
      this.literalPending = {
        size,
        callback: resolve
      };
    });
  }

  /**
   * Send raw data to the server (for literal data)
   * 
   * @param data - Data to send
   */
  sendLiteral(data: Buffer | string): void {
    this.connection.send(data);
  }

  /**
   * Check if there are pending commands
   */
  hasPendingCommands(): boolean {
    return this.pendingCommands.size > 0;
  }

  /**
   * Get count of pending commands
   */
  getPendingCommandCount(): number {
    return this.pendingCommands.size;
  }

  /**
   * Cancel all pending commands
   */
  cancelAllPending(): void {
    for (const pending of this.pendingCommands.values()) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      pending.reject(new Error('Command cancelled'));
    }
    this.pendingCommands.clear();
  }

  /**
   * Set the default timeout for operations
   * 
   * @param timeout - Timeout in milliseconds
   */
  setDefaultTimeout(timeout: number): void {
    this.defaultTimeout = timeout;
  }

  /**
   * Get the default timeout
   */
  getDefaultTimeout(): number {
    return this.defaultTimeout;
  }
}
