import { describe, it, expect } from 'vitest';
import {
  ImapError,
  ImapProtocolError,
  ImapNetworkError,
  ImapParseError,
  ImapTimeoutError
} from '../../src/types/errors.js';

describe('Type definitions', () => {
  describe('Error classes', () => {
    it('should create ImapError with correct properties', () => {
      const error = new ImapError('Test error', 'TEST_CODE', 'protocol');
      
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(ImapError);
      expect(error.message).toBe('Test error');
      expect(error.code).toBe('TEST_CODE');
      expect(error.source).toBe('protocol');
      expect(error.name).toBe('ImapError');
    });

    it('should create ImapProtocolError with server response', () => {
      const error = new ImapProtocolError('Protocol error', 'NO Invalid command', 'LOGIN');
      
      expect(error).toBeInstanceOf(ImapError);
      expect(error).toBeInstanceOf(ImapProtocolError);
      expect(error.source).toBe('protocol');
      expect(error.serverResponse).toBe('NO Invalid command');
      expect(error.command).toBe('LOGIN');
      expect(error.name).toBe('ImapProtocolError');
    });

    it('should create ImapNetworkError with host and port', () => {
      const error = new ImapNetworkError('Connection failed', 'imap.example.com', 993);
      
      expect(error).toBeInstanceOf(ImapError);
      expect(error).toBeInstanceOf(ImapNetworkError);
      expect(error.source).toBe('network');
      expect(error.host).toBe('imap.example.com');
      expect(error.port).toBe(993);
      expect(error.name).toBe('ImapNetworkError');
    });

    it('should create ImapParseError with raw data', () => {
      const error = new ImapParseError('Parse failed', '* INVALID RESPONSE');
      
      expect(error).toBeInstanceOf(ImapError);
      expect(error).toBeInstanceOf(ImapParseError);
      expect(error.source).toBe('parse');
      expect(error.rawData).toBe('* INVALID RESPONSE');
      expect(error.name).toBe('ImapParseError');
    });

    it('should create ImapTimeoutError with operation and timeout', () => {
      const error = new ImapTimeoutError('Operation timed out', 'FETCH', 30000);
      
      expect(error).toBeInstanceOf(ImapError);
      expect(error).toBeInstanceOf(ImapTimeoutError);
      expect(error.source).toBe('timeout');
      expect(error.operation).toBe('FETCH');
      expect(error.timeoutMs).toBe(30000);
      expect(error.name).toBe('ImapTimeoutError');
    });
  });
});
