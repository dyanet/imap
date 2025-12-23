/**
 * MIME Multipart Parser
 * 
 * Handles multipart boundary detection and part extraction
 * per RFC 2046.
 * 
 * @packageDocumentation
 */

import { parseHeaders, parseContentType } from './header-parser.js';
import { base64Decode } from '../encoding/base64.js';
import { quotedPrintableDecode } from '../encoding/quoted-printable.js';
import type { Headers, MessagePart } from '../types/message.js';

/**
 * Represents a parsed MIME part
 */
export interface MimePart {
  /** Part headers */
  headers: Headers;
  /** Content type information */
  contentType: {
    type: string;
    subtype: string;
    params: Record<string, string>;
  };
  /** Content transfer encoding */
  encoding: string;
  /** Raw body content (before decoding) */
  rawBody: string;
  /** Decoded body content */
  body: string | Buffer;
  /** Child parts (for multipart) */
  parts?: MimePart[];
}

/**
 * Extracts the boundary from a Content-Type header
 * 
 * @param contentType - Content-Type header value
 * @returns Boundary string or undefined
 */
export function extractBoundary(contentType: string): string | undefined {
  const match = contentType.match(/boundary\s*=\s*(?:"([^"]+)"|([^\s;]+))/i);
  return match ? (match[1] ?? match[2]) : undefined;
}

/**
 * Splits a multipart body into individual parts
 * 
 * @param body - Raw multipart body
 * @param boundary - Boundary string (without --)
 * @returns Array of raw part strings
 */
export function splitMultipartBody(body: string, boundary: string): string[] {
  const parts: string[] = [];
  
  // Boundary markers
  const delimiter = `--${boundary}`;
  const closeDelimiter = `--${boundary}--`;
  
  // Find the start of the first part (after preamble)
  let startIndex = body.indexOf(delimiter);
  if (startIndex === -1) return parts;
  
  // Move past the first delimiter and CRLF
  startIndex = body.indexOf('\n', startIndex) + 1;
  if (startIndex === 0) return parts;
  
  while (startIndex < body.length) {
    // Find the next delimiter
    let endIndex = body.indexOf(delimiter, startIndex);
    
    if (endIndex === -1) {
      // No more delimiters, take rest as last part
      break;
    }
    
    // Extract the part content (excluding trailing CRLF before delimiter)
    let partContent = body.substring(startIndex, endIndex);
    
    // Remove trailing CRLF or LF
    if (partContent.endsWith('\r\n')) {
      partContent = partContent.slice(0, -2);
    } else if (partContent.endsWith('\n')) {
      partContent = partContent.slice(0, -1);
    }
    
    if (partContent.length > 0) {
      parts.push(partContent);
    }
    
    // Check if this is the closing delimiter
    if (body.substring(endIndex, endIndex + closeDelimiter.length) === closeDelimiter) {
      break;
    }
    
    // Move to the next part
    startIndex = body.indexOf('\n', endIndex) + 1;
    if (startIndex === 0) break;
  }
  
  return parts;
}


/**
 * Decodes content based on Content-Transfer-Encoding
 * 
 * @param content - Raw content string
 * @param encoding - Content-Transfer-Encoding value
 * @returns Decoded content
 */
export function decodeContent(content: string, encoding: string): string | Buffer {
  const enc = encoding.toLowerCase();
  
  switch (enc) {
    case 'base64':
      return base64Decode(content);
    case 'quoted-printable':
      return quotedPrintableDecode(content);
    case '7bit':
    case '8bit':
    case 'binary':
    default:
      return content;
  }
}

/**
 * Parses a single MIME part (headers + body)
 * 
 * @param rawPart - Raw part content
 * @returns Parsed MIME part
 */
export function parseMimePart(rawPart: string): MimePart {
  // Find the header/body separator (empty line)
  const separatorMatch = rawPart.match(/\r?\n\r?\n/);
  
  let headerBlock: string;
  let bodyContent: string;
  
  if (separatorMatch && separatorMatch.index !== undefined) {
    headerBlock = rawPart.substring(0, separatorMatch.index);
    bodyContent = rawPart.substring(separatorMatch.index + separatorMatch[0].length);
  } else {
    // No body, just headers
    headerBlock = rawPart;
    bodyContent = '';
  }
  
  // Parse headers
  const headers = parseHeaders(headerBlock);
  
  // Get content type
  const contentTypeHeader = headers.get('content-type');
  const contentTypeStr = Array.isArray(contentTypeHeader) 
    ? contentTypeHeader[0] 
    : (contentTypeHeader || 'text/plain');
  const contentType = parseContentType(contentTypeStr);
  
  // Get encoding
  const encodingHeader = headers.get('content-transfer-encoding');
  const encoding = Array.isArray(encodingHeader)
    ? encodingHeader[0]
    : (encodingHeader || '7bit');
  
  // Check if this is a multipart type
  let parts: MimePart[] | undefined;
  let decodedBody: string | Buffer = bodyContent;
  
  if (contentType.type === 'multipart') {
    const boundary = contentType.params['boundary'];
    if (boundary) {
      const rawParts = splitMultipartBody(bodyContent, boundary);
      parts = rawParts.map(p => parseMimePart(p));
    }
  } else {
    // Decode the body content
    decodedBody = decodeContent(bodyContent, encoding);
  }
  
  return {
    headers,
    contentType,
    encoding,
    rawBody: bodyContent,
    body: decodedBody,
    parts,
  };
}

/**
 * Parses a complete MIME message
 * 
 * @param rawMessage - Raw message content
 * @returns Parsed MIME part tree
 */
export function parseMultipartMessage(rawMessage: string): MimePart {
  return parseMimePart(rawMessage);
}

/**
 * Flattens a MIME part tree into an array of MessageParts
 * 
 * @param mimePart - Root MIME part
 * @param prefix - Part number prefix
 * @returns Array of MessageParts
 */
export function flattenMimeParts(mimePart: MimePart, prefix: string = ''): MessagePart[] {
  const result: MessagePart[] = [];
  
  if (mimePart.parts && mimePart.parts.length > 0) {
    // Multipart - recurse into children
    mimePart.parts.forEach((part, index) => {
      const partNum = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
      result.push(...flattenMimeParts(part, partNum));
    });
  } else {
    // Leaf part
    const which = prefix || 'TEXT';
    const body = mimePart.body;
    const size = typeof body === 'string' ? body.length : body.length;
    
    result.push({
      which,
      size,
      body,
    });
  }
  
  return result;
}
