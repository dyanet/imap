/**
 * MIME Header Parser
 * 
 * Parses MIME message headers including:
 * - Folded headers (RFC 2822)
 * - Encoded words (RFC 2047)
 * 
 * @packageDocumentation
 */

import { base64Decode } from '../encoding/base64.js';
import { quotedPrintableDecode } from '../encoding/quoted-printable.js';
import type { Headers } from '../types/message.js';

/**
 * Decodes RFC 2047 encoded words in header values
 * Format: =?charset?encoding?encoded_text?=
 * 
 * @param value - Header value potentially containing encoded words
 * @returns Decoded header value
 */
export function decodeEncodedWords(value: string): string {
  // RFC 2047 encoded word pattern: =?charset?encoding?encoded_text?=
  const encodedWordPattern = /=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g;
  
  return value.replace(encodedWordPattern, (match, charset, encoding, encodedText) => {
    try {
      const enc = encoding.toUpperCase();
      let decoded: Buffer;
      
      if (enc === 'B') {
        // Base64 encoding
        decoded = base64Decode(encodedText);
      } else if (enc === 'Q') {
        // Q-encoding (modified quoted-printable)
        // In Q-encoding, underscores represent spaces
        const qpText = encodedText.replace(/_/g, ' ');
        decoded = quotedPrintableDecode(qpText);
      } else {
        return match; // Unknown encoding, return as-is
      }
      
      // Decode using the specified charset
      return decodeWithCharset(decoded, charset.toLowerCase());
    } catch {
      return match; // On error, return original
    }
  });
}


/**
 * Decodes a buffer using the specified charset
 * 
 * @param buffer - Buffer to decode
 * @param charset - Character set name
 * @returns Decoded string
 */
function decodeWithCharset(buffer: Buffer, charset: string): string {
  // Normalize charset names
  const normalizedCharset = charset.replace(/-/g, '').toLowerCase();
  
  // Map common charset aliases
  const charsetMap: Record<string, BufferEncoding> = {
    'utf8': 'utf-8',
    'utf16': 'utf16le',
    'utf16le': 'utf16le',
    'utf16be': 'utf16le', // Node doesn't support utf16be directly
    'ascii': 'ascii',
    'latin1': 'latin1',
    'iso88591': 'latin1',
    'iso885915': 'latin1',
    'windows1252': 'latin1',
    'cp1252': 'latin1',
  };
  
  const encoding = charsetMap[normalizedCharset] || 'utf-8';
  return buffer.toString(encoding);
}

/**
 * Unfolds folded headers (RFC 2822)
 * Folded headers have CRLF followed by whitespace
 * 
 * @param headerBlock - Raw header block with potential folding
 * @returns Unfolded header block
 */
export function unfoldHeaders(headerBlock: string): string {
  // RFC 2822: Folding is indicated by CRLF followed by at least one WSP
  // Also handle bare LF for compatibility
  return headerBlock
    .replace(/\r\n[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, ' ');
}

/**
 * Parses a header block into key-value pairs
 * 
 * @param headerBlock - Raw header block (headers separated by CRLF)
 * @returns Map of header names to values
 */
export function parseHeaders(headerBlock: string): Headers {
  const headers: Headers = new Map();
  
  // First unfold the headers
  const unfolded = unfoldHeaders(headerBlock);
  
  // Split into lines (handle both CRLF and LF)
  const lines = unfolded.split(/\r?\n/);
  
  for (const line of lines) {
    // Skip empty lines
    if (!line.trim()) continue;
    
    // Find the colon separator
    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) continue;
    
    // Extract header name (case-insensitive, stored lowercase)
    const name = line.substring(0, colonIndex).trim().toLowerCase();
    
    // Extract and decode the value
    let value = line.substring(colonIndex + 1).trim();
    value = decodeEncodedWords(value);
    
    // Handle multiple values for the same header
    const existing = headers.get(name);
    if (existing !== undefined) {
      if (Array.isArray(existing)) {
        existing.push(value);
      } else {
        headers.set(name, [existing, value]);
      }
    } else {
      headers.set(name, value);
    }
  }
  
  return headers;
}

/**
 * Extracts a specific parameter from a header value
 * e.g., from "multipart/mixed; boundary=abc" extracts boundary="abc"
 * 
 * @param headerValue - Full header value with parameters
 * @param paramName - Parameter name to extract
 * @returns Parameter value or undefined
 */
export function extractHeaderParam(headerValue: string, paramName: string): string | undefined {
  // Match parameter with optional quotes
  // Format: paramName=value or paramName="value"
  const pattern = new RegExp(
    `${paramName}\\s*=\\s*(?:"([^"]*)"|(\\S+))`,
    'i'
  );
  
  const match = headerValue.match(pattern);
  if (match) {
    return match[1] ?? match[2];
  }
  return undefined;
}

/**
 * Parses a Content-Type header value
 * 
 * @param contentType - Content-Type header value
 * @returns Parsed type, subtype, and parameters
 */
export function parseContentType(contentType: string): {
  type: string;
  subtype: string;
  params: Record<string, string>;
} {
  const params: Record<string, string> = {};
  
  // Split by semicolon to separate type from parameters
  const parts = contentType.split(';').map(p => p.trim());
  
  // First part is type/subtype
  const [type = 'text', subtype = 'plain'] = (parts[0] || 'text/plain')
    .toLowerCase()
    .split('/');
  
  // Parse remaining parameters
  for (let i = 1; i < parts.length; i++) {
    const param = parts[i];
    const eqIndex = param.indexOf('=');
    if (eqIndex !== -1) {
      const name = param.substring(0, eqIndex).trim().toLowerCase();
      let value = param.substring(eqIndex + 1).trim();
      
      // Remove quotes if present
      if (value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }
      
      params[name] = value;
    }
  }
  
  return { type, subtype, params };
}
