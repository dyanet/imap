/**
 * Property-based tests for error classes
 * 
 * Feature: dyanet-imap, Property 10: Error Context Preservation
 * Validates: Requirements 1.3, 2.6, 9.1, 9.2, 9.3, 9.4, 9.5
 */

import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
import {
  ImapError,
  ImapProtocolError,
  ImapNetworkError,
  ImapParseError,
  ImapTimeoutError
} from '../../src/types/errors.js';

describe('Property 10: Error Context Preservation', () => {
  it('ImapProtocolError preserves server response and command context', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string({ minLength: 1 }),  // serverResponse
        fc.option(fc.string({ minLength: 1 }), { nil: undefined }),  // command (optional)
        (message, serverResponse, command) => {
          const error = new ImapProtocolError(message, serverResponse, command);
          
          // Must be instance of correct error classes
          expect(error).toBeInstanceOf(Error);
          expect(error).toBeInstanceOf(ImapError);
          expect(error).toBeInstanceOf(ImapProtocolError);
          
          // Must have correct source
          expect(error.source).toBe('protocol');
          
          // Must preserve context
          expect(error.message).toBe(message);
          expect(error.serverResponse).toBe(serverResponse);
          expect(error.response).toBe(serverResponse);
          expect(error.command).toBe(command);
          expect(error.code).toBe('PROTOCOL_ERROR');
          expect(error.name).toBe('ImapProtocolError');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ImapNetworkError preserves host and port context', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string({ minLength: 1 }),  // host
        fc.integer({ min: 1, max: 65535 }),  // port
        (message, host, port) => {
          const error = new ImapNetworkError(message, host, port);
          
          // Must be instance of correct error classes
          expect(error).toBeInstanceOf(Error);
          expect(error).toBeInstanceOf(ImapError);
          expect(error).toBeInstanceOf(ImapNetworkError);
          
          // Must have correct source
          expect(error.source).toBe('network');
          
          // Must preserve context
          expect(error.message).toBe(message);
          expect(error.host).toBe(host);
          expect(error.port).toBe(port);
          expect(error.code).toBe('NETWORK_ERROR');
          expect(error.name).toBe('ImapNetworkError');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ImapNetworkError preserves cause when provided', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string({ minLength: 1 }),  // host
        fc.integer({ min: 1, max: 65535 }),  // port
        fc.string({ minLength: 1 }),  // cause message
        (message, host, port, causeMessage) => {
          const cause = new Error(causeMessage);
          const error = new ImapNetworkError(message, host, port, cause);
          
          expect(error.cause).toBe(cause);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ImapParseError preserves raw data context', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string(),  // rawData (can be empty)
        (message, rawData) => {
          const error = new ImapParseError(message, rawData);
          
          // Must be instance of correct error classes
          expect(error).toBeInstanceOf(Error);
          expect(error).toBeInstanceOf(ImapError);
          expect(error).toBeInstanceOf(ImapParseError);
          
          // Must have correct source
          expect(error.source).toBe('parse');
          
          // Must preserve context
          expect(error.message).toBe(message);
          expect(error.rawData).toBe(rawData);
          expect(error.code).toBe('PARSE_ERROR');
          expect(error.name).toBe('ImapParseError');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('ImapTimeoutError preserves operation name and timeout duration', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string({ minLength: 1 }),  // operation
        fc.integer({ min: 0 }),  // timeoutMs
        (message, operation, timeoutMs) => {
          const error = new ImapTimeoutError(message, operation, timeoutMs);
          
          // Must be instance of correct error classes
          expect(error).toBeInstanceOf(Error);
          expect(error).toBeInstanceOf(ImapError);
          expect(error).toBeInstanceOf(ImapTimeoutError);
          
          // Must have correct source
          expect(error.source).toBe('timeout');
          
          // Must preserve context
          expect(error.message).toBe(message);
          expect(error.operation).toBe(operation);
          expect(error.timeoutMs).toBe(timeoutMs);
          expect(error.code).toBe('TIMEOUT_ERROR');
          expect(error.name).toBe('ImapTimeoutError');
        }
      ),
      { numRuns: 100 }
    );
  });

  it('Base ImapError preserves code and source', () => {
    const sources = ['protocol', 'network', 'parse', 'timeout'] as const;
    
    fc.assert(
      fc.property(
        fc.string({ minLength: 1 }),  // message
        fc.string({ minLength: 1 }),  // code
        fc.constantFrom(...sources),  // source
        (message, code, source) => {
          const error = new ImapError(message, code, source);
          
          // Must be instance of Error
          expect(error).toBeInstanceOf(Error);
          expect(error).toBeInstanceOf(ImapError);
          
          // Must preserve context
          expect(error.message).toBe(message);
          expect(error.code).toBe(code);
          expect(error.source).toBe(source);
          expect(error.name).toBe('ImapError');
        }
      ),
      { numRuns: 100 }
    );
  });
});
