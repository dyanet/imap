/**
 * Transport layer for @dyanet/imap
 * Manages TCP/TLS socket connections to IMAP servers
 */

import { EventEmitter } from 'events';
import * as net from 'net';
import * as tls from 'tls';
import type { ConnectionOptions } from '../types/config.js';
import { ImapNetworkError, ImapTimeoutError } from '../types/errors.js';

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'disconnecting';

/**
 * ImapConnection events interface for type safety
 */
export interface ImapConnectionEvents {
  data: (chunk: Buffer) => void;
  error: (err: Error) => void;
  close: () => void;
  connect: () => void;
}

/**
 * Low-level IMAP connection manager
 * Handles TCP/TLS socket management and raw data transmission
 */
export class ImapConnection extends EventEmitter {
  private socket: net.Socket | tls.TLSSocket | null = null;
  private options: ConnectionOptions;
  private _state: ConnectionState = 'disconnected';
  private buffer: Buffer = Buffer.alloc(0);

  constructor(options: ConnectionOptions) {
    super();
    this.options = {
      host: options.host,
      port: options.port,
      tls: options.tls ?? false,
      tlsOptions: options.tlsOptions,
      connTimeout: options.connTimeout ?? 30000
    };
  }

  /**
   * Current connection state
   */
  get state(): ConnectionState {
    return this._state;
  }

  /**
   * Whether the connection is currently connected
   */
  get isConnected(): boolean {
    return this._state === 'connected';
  }

  /**
   * Host being connected to
   */
  get host(): string {
    return this.options.host;
  }

  /**
   * Port being connected to
   */
  get port(): number {
    return this.options.port;
  }


  /**
   * Establish connection to the IMAP server
   * @returns Promise that resolves when connected
   * @throws ImapNetworkError on connection failure
   * @throws ImapTimeoutError if connection times out
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this._state !== 'disconnected') {
        reject(new ImapNetworkError(
          `Cannot connect: connection is ${this._state}`,
          this.options.host,
          this.options.port
        ));
        return;
      }

      this._state = 'connecting';
      let timeoutId: NodeJS.Timeout | null = null;
      let resolved = false;

      const cleanup = () => {
        if (timeoutId) {
          clearTimeout(timeoutId);
          timeoutId = null;
        }
      };

      const onError = (err: Error) => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._state = 'disconnected';
        this.socket = null;
        reject(new ImapNetworkError(
          `Connection failed: ${err.message}`,
          this.options.host,
          this.options.port,
          err
        ));
      };

      const onConnect = () => {
        if (resolved) return;
        resolved = true;
        cleanup();
        this._state = 'connected';
        this.setupSocketListeners();
        this.emit('connect');
        resolve();
      };

      // Set connection timeout
      if (this.options.connTimeout > 0) {
        timeoutId = setTimeout(() => {
          if (resolved) return;
          resolved = true;
          this.socket?.destroy();
          this.socket = null;
          this._state = 'disconnected';
          reject(new ImapTimeoutError(
            `Connection timed out after ${this.options.connTimeout}ms`,
            'connect',
            this.options.connTimeout
          ));
        }, this.options.connTimeout);
      }

      try {
        if (this.options.tls) {
          // TLS connection
          const tlsOpts: tls.ConnectionOptions = {
            host: this.options.host,
            port: this.options.port,
            ...this.buildTlsOptions()
          };
          this.socket = tls.connect(tlsOpts, onConnect);
        } else {
          // Plain TCP connection
          this.socket = net.createConnection({
            host: this.options.host,
            port: this.options.port
          }, onConnect);
        }

        this.socket.once('error', onError);
      } catch (err) {
        onError(err as Error);
      }
    });
  }


  /**
   * Build TLS options from configuration
   */
  private buildTlsOptions(): tls.ConnectionOptions {
    const opts: tls.ConnectionOptions = {};
    
    if (this.options.tlsOptions) {
      const tlsOpts = this.options.tlsOptions;
      
      if (tlsOpts.rejectUnauthorized !== undefined) {
        opts.rejectUnauthorized = tlsOpts.rejectUnauthorized;
      }
      if (tlsOpts.ca) {
        opts.ca = tlsOpts.ca;
      }
      if (tlsOpts.cert) {
        opts.cert = tlsOpts.cert;
      }
      if (tlsOpts.key) {
        opts.key = tlsOpts.key;
      }
    }
    
    return opts;
  }

  /**
   * Setup socket event listeners after connection
   */
  private setupSocketListeners(): void {
    if (!this.socket) return;

    // Remove the one-time error handler from connect
    this.socket.removeAllListeners('error');

    this.socket.on('data', (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      this.emit('data', chunk);
    });

    this.socket.on('error', (err: Error) => {
      const networkError = new ImapNetworkError(
        `Socket error: ${err.message}`,
        this.options.host,
        this.options.port,
        err
      );
      this.emit('error', networkError);
    });

    this.socket.on('close', () => {
      this._state = 'disconnected';
      this.socket = null;
      this.emit('close');
    });

    this.socket.on('end', () => {
      // Server closed the connection
      this._state = 'disconnected';
    });
  }


  /**
   * Disconnect from the IMAP server
   * @returns Promise that resolves when disconnected
   */
  disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this._state === 'disconnected' || !this.socket) {
        this._state = 'disconnected';
        resolve();
        return;
      }

      this._state = 'disconnecting';

      const onClose = () => {
        this._state = 'disconnected';
        this.socket = null;
        this.buffer = Buffer.alloc(0);
        resolve();
      };

      // If socket is already destroyed, resolve immediately
      if (this.socket.destroyed) {
        onClose();
        return;
      }

      this.socket.once('close', onClose);
      this.socket.end();

      // Force destroy after a short timeout if graceful close doesn't work
      setTimeout(() => {
        if (this.socket && !this.socket.destroyed) {
          this.socket.destroy();
        }
      }, 1000);
    });
  }

  /**
   * Send raw data to the server
   * @param data - Data to send (string or Buffer)
   * @throws ImapNetworkError if not connected
   */
  send(data: string | Buffer): void {
    if (!this.socket || this._state !== 'connected') {
      throw new ImapNetworkError(
        'Cannot send data: not connected',
        this.options.host,
        this.options.port
      );
    }

    this.socket.write(data);
  }

  /**
   * Send a line of data (appends CRLF)
   * @param line - Line to send
   * @throws ImapNetworkError if not connected
   */
  sendLine(line: string): void {
    this.send(line + '\r\n');
  }

  /**
   * Get and clear the current buffer
   * @returns The buffered data
   */
  getBuffer(): Buffer {
    const data = this.buffer;
    this.buffer = Buffer.alloc(0);
    return data;
  }

  /**
   * Peek at the current buffer without clearing
   * @returns The buffered data
   */
  peekBuffer(): Buffer {
    return this.buffer;
  }

  /**
   * Clear the buffer
   */
  clearBuffer(): void {
    this.buffer = Buffer.alloc(0);
  }

  /**
   * Upgrade a plain connection to TLS (STARTTLS)
   * @returns Promise that resolves when upgrade is complete
   * @throws ImapNetworkError if upgrade fails
   */
  upgradeToTls(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.socket || this._state !== 'connected') {
        reject(new ImapNetworkError(
          'Cannot upgrade: not connected',
          this.options.host,
          this.options.port
        ));
        return;
      }

      if (this.socket instanceof tls.TLSSocket) {
        // Already TLS
        resolve();
        return;
      }

      const plainSocket = this.socket as net.Socket;
      
      // Remove existing listeners
      plainSocket.removeAllListeners();

      const tlsOpts: tls.ConnectionOptions = {
        socket: plainSocket,
        ...this.buildTlsOptions()
      };

      const tlsSocket = tls.connect(tlsOpts, () => {
        this.socket = tlsSocket;
        this.setupSocketListeners();
        resolve();
      });

      tlsSocket.once('error', (err: Error) => {
        reject(new ImapNetworkError(
          `TLS upgrade failed: ${err.message}`,
          this.options.host,
          this.options.port,
          err
        ));
      });
    });
  }
}
