/**
 * IMAP Response Parser
 * 
 * Parses IMAP server responses into structured objects.
 * Handles tagged responses (OK/NO/BAD), untagged responses, and continuations.
 * 
 * @packageDocumentation
 */

import { tokenize, type Token, getTokenValue, isListToken } from './tokenizer.js';
import type { TaggedResponse, UntaggedResponse, ParsedResponse } from '../types/protocol.js';

/**
 * Response status types
 */
export type ResponseStatus = 'OK' | 'NO' | 'BAD';

/**
 * Checks if a string is a valid response status
 */
function isResponseStatus(value: string): value is ResponseStatus {
  return value === 'OK' || value === 'NO' || value === 'BAD';
}

/**
 * Checks if a line is a tagged response
 * Tagged responses start with a tag (e.g., "A001") followed by OK/NO/BAD
 * 
 * @param line - The response line to check
 * @returns True if this is a tagged response
 */
export function isTaggedResponse(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.startsWith('*') || trimmed.startsWith('+')) {
    return false;
  }
  
  // Check if it matches pattern: TAG STATUS ...
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return false;
  }
  
  const status = parts[1].toUpperCase();
  return isResponseStatus(status);
}

/**
 * Checks if a line is a continuation response
 * Continuation responses start with "+"
 * 
 * @param line - The response line to check
 * @returns True if this is a continuation response
 */
export function isContinuationResponse(line: string): boolean {
  return line.trim().startsWith('+');
}

/**
 * Parses a tagged response line
 * 
 * @param line - The tagged response line (e.g., "A001 OK Success")
 * @returns Parsed TaggedResponse object
 */
export function parseTaggedResponse(line: string): TaggedResponse {
  const trimmed = line.trim();
  const spaceIndex = trimmed.indexOf(' ');
  
  if (spaceIndex === -1) {
    // Malformed response - just a tag
    return {
      tag: trimmed,
      status: 'BAD',
      text: ''
    };
  }
  
  const tag = trimmed.slice(0, spaceIndex);
  const rest = trimmed.slice(spaceIndex + 1);
  
  // Find the status (OK/NO/BAD)
  const statusMatch = rest.match(/^(OK|NO|BAD)\s*/i);
  
  if (!statusMatch) {
    return {
      tag,
      status: 'BAD',
      text: rest
    };
  }
  
  const status = statusMatch[1].toUpperCase() as ResponseStatus;
  const text = rest.slice(statusMatch[0].length);
  
  return {
    tag,
    status,
    text
  };
}


/**
 * Parses an untagged response line
 * Untagged responses start with "*"
 * 
 * @param line - The untagged response line (e.g., "* 5 EXISTS")
 * @returns Parsed UntaggedResponse object
 */
export function parseUntaggedResponse(line: string): UntaggedResponse {
  const trimmed = line.trim();
  
  // Remove the leading "* "
  if (!trimmed.startsWith('*')) {
    return {
      type: 'UNKNOWN',
      data: null,
      raw: line
    };
  }
  
  const content = trimmed.slice(1).trim();
  
  // Check for numeric responses like "* 5 EXISTS" or "* 3 RECENT"
  const numericMatch = content.match(/^(\d+)\s+(\S+)(.*)$/);
  if (numericMatch) {
    const num = parseInt(numericMatch[1], 10);
    const type = numericMatch[2].toUpperCase();
    const rest = numericMatch[3].trim();
    
    return {
      type,
      data: { number: num, extra: rest || undefined },
      raw: line
    };
  }
  
  // Check for status responses like "* OK [CAPABILITY ...] Ready"
  const statusMatch = content.match(/^(OK|NO|BAD|BYE|PREAUTH)\s*(.*)$/i);
  if (statusMatch) {
    const type = statusMatch[1].toUpperCase();
    const text = statusMatch[2];
    
    // Parse response code if present [CODE ...]
    const codeMatch = text.match(/^\[([^\]]+)\]\s*(.*)$/);
    if (codeMatch) {
      return {
        type,
        data: {
          code: codeMatch[1],
          text: codeMatch[2]
        },
        raw: line
      };
    }
    
    return {
      type,
      data: { text },
      raw: line
    };
  }
  
  // Check for capability response
  if (content.toUpperCase().startsWith('CAPABILITY')) {
    const caps = content.slice('CAPABILITY'.length).trim().split(/\s+/);
    return {
      type: 'CAPABILITY',
      data: caps.filter(c => c.length > 0),
      raw: line
    };
  }
  
  // Check for FLAGS response
  if (content.toUpperCase().startsWith('FLAGS')) {
    const flagsContent = content.slice('FLAGS'.length).trim();
    const { tokens } = tokenize(flagsContent);
    const flags = extractFlags(tokens);
    return {
      type: 'FLAGS',
      data: flags,
      raw: line
    };
  }
  
  // Check for LIST/LSUB response
  const listMatch = content.match(/^(LIST|LSUB)\s+(.*)$/i);
  if (listMatch) {
    const type = listMatch[1].toUpperCase();
    const listContent = listMatch[2];
    const parsed = parseListResponse(listContent);
    return {
      type,
      data: parsed,
      raw: line
    };
  }
  
  // Check for SEARCH response
  if (content.toUpperCase().startsWith('SEARCH')) {
    const uidsStr = content.slice('SEARCH'.length).trim();
    const uids = uidsStr.length > 0 
      ? uidsStr.split(/\s+/).map(s => parseInt(s, 10)).filter(n => !isNaN(n))
      : [];
    return {
      type: 'SEARCH',
      data: uids,
      raw: line
    };
  }
  
  // Check for FETCH response
  const fetchMatch = content.match(/^(\d+)\s+FETCH\s+(.*)$/i);
  if (fetchMatch) {
    const seqno = parseInt(fetchMatch[1], 10);
    const fetchData = fetchMatch[2];
    const { tokens } = tokenize(fetchData);
    return {
      type: 'FETCH',
      data: { seqno, attributes: parseFetchAttributes(tokens) },
      raw: line
    };
  }
  
  // Generic parsing for other responses
  const parts = content.split(/\s+/);
  const type = parts[0].toUpperCase();
  const rest = parts.slice(1).join(' ');
  
  return {
    type,
    data: rest || null,
    raw: line
  };
}

/**
 * Extracts flags from tokenized content
 */
function extractFlags(tokens: Token[]): string[] {
  const flags: string[] = [];
  
  for (const token of tokens) {
    if (isListToken(token)) {
      for (const item of token.value) {
        const val = getTokenValue(item);
        if (val) {
          flags.push(val);
        }
      }
    } else {
      const val = getTokenValue(token);
      if (val) {
        flags.push(val);
      }
    }
  }
  
  return flags;
}

/**
 * Parses LIST/LSUB response content
 */
function parseListResponse(content: string): { attributes: string[]; delimiter: string | null; name: string } {
  const { tokens } = tokenize(content);
  
  let attributes: string[] = [];
  let delimiter: string | null = null;
  let name = '';
  
  let tokenIndex = 0;
  
  // First token should be attributes list
  const firstToken = tokens[tokenIndex];
  if (tokenIndex < tokens.length && isListToken(firstToken)) {
    attributes = firstToken.value.map((t: Token) => getTokenValue(t)).filter((v): v is string => v !== null);
    tokenIndex++;
  }
  
  // Second token is delimiter (quoted string or NIL)
  if (tokenIndex < tokens.length) {
    const delimToken = tokens[tokenIndex];
    if (delimToken.type === 'nil') {
      delimiter = null;
    } else {
      delimiter = getTokenValue(delimToken);
    }
    tokenIndex++;
  }
  
  // Third token is mailbox name
  if (tokenIndex < tokens.length) {
    name = getTokenValue(tokens[tokenIndex]) || '';
  }
  
  return { attributes, delimiter, name };
}

/**
 * Parses FETCH response attributes
 */
function parseFetchAttributes(tokens: Token[]): Record<string, unknown> {
  const attrs: Record<string, unknown> = {};
  
  // FETCH data is usually in a list: (UID 123 FLAGS (\Seen) ...)
  if (tokens.length === 1 && isListToken(tokens[0])) {
    const items = tokens[0].value;
    let i = 0;
    
    while (i < items.length) {
      const keyToken = items[i];
      const key = getTokenValue(keyToken)?.toUpperCase();
      
      if (!key) {
        i++;
        continue;
      }
      
      i++;
      
      if (i >= items.length) {
        attrs[key] = null;
        break;
      }
      
      const valueToken = items[i];
      
      if (isListToken(valueToken)) {
        // Handle list values (like FLAGS)
        attrs[key] = valueToken.value.map(t => getTokenValue(t)).filter(v => v !== null);
      } else if (valueToken.type === 'nil') {
        attrs[key] = null;
      } else {
        attrs[key] = getTokenValue(valueToken);
      }
      
      i++;
    }
  }
  
  return attrs;
}

/**
 * Parses a complete IMAP response (may contain multiple lines)
 * 
 * @param lines - Array of response lines
 * @returns ParsedResponse with tagged, untagged, and continuation components
 */
export function parseResponse(lines: string[]): ParsedResponse {
  const result: ParsedResponse = {
    untagged: []
  };
  
  for (const line of lines) {
    const trimmed = line.trim();
    
    if (!trimmed) {
      continue;
    }
    
    if (isContinuationResponse(trimmed)) {
      // Continuation response: + text
      result.continuation = trimmed.slice(1).trim();
    } else if (trimmed.startsWith('*')) {
      // Untagged response
      result.untagged.push(parseUntaggedResponse(trimmed));
    } else if (isTaggedResponse(trimmed)) {
      // Tagged response
      result.tagged = parseTaggedResponse(trimmed);
    }
  }
  
  return result;
}
