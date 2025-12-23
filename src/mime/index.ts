/**
 * MIME Parser Module
 * 
 * Provides MIME message parsing capabilities including:
 * - Header parsing with RFC 2047 encoded word support
 * - Multipart boundary detection and part extraction
 * - Body structure parsing for IMAP BODYSTRUCTURE responses
 * 
 * @packageDocumentation
 */

// Header parsing
export {
  parseHeaders,
  decodeEncodedWords,
  unfoldHeaders,
  extractHeaderParam,
  parseContentType,
} from './header-parser.js';

// Multipart parsing
export {
  extractBoundary,
  splitMultipartBody,
  parseMimePart,
  parseMultipartMessage,
  flattenMimeParts,
  decodeContent,
} from './multipart-parser.js';

export type { MimePart } from './multipart-parser.js';

// Body structure parsing
export {
  parseBodyStructure,
  tokenizeBodyStructure,
  parseBodyStructureTokens,
} from './body-structure-parser.js';

// Re-export types
export type { Headers, ParsedMessage, MessagePart, BodyStructure } from '../types/message.js';
