/**
 * MIME Body Structure Parser
 * 
 * Parses IMAP BODYSTRUCTURE responses into BodyStructure objects.
 * 
 * @packageDocumentation
 */

import type { BodyStructure } from '../types/message.js';

/**
 * Token types for body structure parsing
 */
type Token = string | Token[];

/**
 * Tokenizes a BODYSTRUCTURE response into nested arrays
 * 
 * @param input - Raw BODYSTRUCTURE string
 * @returns Tokenized structure
 */
export function tokenizeBodyStructure(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  
  function parseValue(): Token {
    // Skip whitespace
    while (i < input.length && /\s/.test(input[i])) i++;
    
    if (i >= input.length) return '';
    
    const char = input[i];
    
    if (char === '(') {
      // Start of a list
      i++; // consume '('
      const list: Token[] = [];
      
      while (i < input.length) {
        // Skip whitespace
        while (i < input.length && /\s/.test(input[i])) i++;
        
        if (i >= input.length || input[i] === ')') {
          i++; // consume ')'
          break;
        }
        
        list.push(parseValue());
      }
      
      return list;
    } else if (char === '"') {
      // Quoted string
      i++; // consume opening quote
      let str = '';
      while (i < input.length && input[i] !== '"') {
        if (input[i] === '\\' && i + 1 < input.length) {
          i++; // skip escape
        }
        str += input[i];
        i++;
      }
      i++; // consume closing quote
      return str;
    } else if (char === '{') {
      // Literal - {size}
      i++; // consume '{'
      let sizeStr = '';
      while (i < input.length && input[i] !== '}') {
        sizeStr += input[i];
        i++;
      }
      i++; // consume '}'
      // Skip CRLF and read literal content
      if (input[i] === '\r') i++;
      if (input[i] === '\n') i++;
      const size = parseInt(sizeStr, 10);
      const literal = input.substring(i, i + size);
      i += size;
      return literal;
    } else {
      // Atom (unquoted string)
      let atom = '';
      while (i < input.length && !/[\s()"\[\]]/.test(input[i])) {
        atom += input[i];
        i++;
      }
      return atom;
    }
  }
  
  while (i < input.length) {
    // Skip whitespace
    while (i < input.length && /\s/.test(input[i])) i++;
    if (i >= input.length) break;
    tokens.push(parseValue());
  }
  
  return tokens;
}


/**
 * Checks if a value is NIL
 */
function isNil(value: Token): boolean {
  return typeof value === 'string' && value.toUpperCase() === 'NIL';
}

/**
 * Converts a token to a string, handling NIL
 */
function tokenToString(token: Token): string | null {
  if (isNil(token)) return null;
  if (typeof token === 'string') return token;
  return null;
}

/**
 * Parses a parameter list into a Record
 * Format: (key1 value1 key2 value2 ...)
 */
function parseParams(tokens: Token): Record<string, string> {
  const params: Record<string, string> = {};
  
  if (!Array.isArray(tokens) || isNil(tokens as unknown as Token)) {
    return params;
  }
  
  for (let i = 0; i < tokens.length - 1; i += 2) {
    const key = tokenToString(tokens[i]);
    const value = tokenToString(tokens[i + 1]);
    if (key && value) {
      params[key.toLowerCase()] = value;
    }
  }
  
  return params;
}

/**
 * Parses a disposition structure
 * Format: (type (param1 value1 ...))
 */
function parseDisposition(tokens: Token): { type: string; params: Record<string, string> } | undefined {
  if (!Array.isArray(tokens) || tokens.length < 1) {
    return undefined;
  }
  
  const type = tokenToString(tokens[0]);
  if (!type) return undefined;
  
  const params = tokens.length > 1 ? parseParams(tokens[1]) : {};
  
  return { type: type.toLowerCase(), params };
}

/**
 * Parses a language list
 */
function parseLanguage(token: Token): string[] | undefined {
  if (isNil(token)) return undefined;
  if (typeof token === 'string') return [token];
  if (Array.isArray(token)) {
    return token.filter((t): t is string => typeof t === 'string');
  }
  return undefined;
}

/**
 * Parses a basic (non-multipart) body structure
 */
function parseBasicBody(tokens: Token[]): BodyStructure {
  // Basic body: (type subtype params id description encoding size [lines] [md5] [disposition] [language] [location])
  const type = tokenToString(tokens[0]) || 'text';
  const subtype = tokenToString(tokens[1]) || 'plain';
  const params = parseParams(tokens[2]);
  const id = tokenToString(tokens[3]);
  const description = tokenToString(tokens[4]);
  const encoding = tokenToString(tokens[5]) || '7bit';
  const size = typeof tokens[6] === 'string' ? parseInt(tokens[6], 10) : 0;
  
  const body: BodyStructure = {
    type: type.toLowerCase(),
    subtype: subtype.toLowerCase(),
    params,
    id,
    description,
    encoding: encoding.toLowerCase(),
    size,
  };
  
  let idx = 7;
  
  // For text types, next is lines
  if (type.toLowerCase() === 'text' && idx < tokens.length) {
    const lines = tokens[idx];
    if (typeof lines === 'string' && !isNaN(parseInt(lines, 10))) {
      body.lines = parseInt(lines, 10);
      idx++;
    }
  }
  
  // For message/rfc822, there's envelope, body, lines
  if (type.toLowerCase() === 'message' && subtype.toLowerCase() === 'rfc822') {
    // Skip envelope (idx), body (idx+1), lines (idx+2)
    idx += 3;
  }
  
  // MD5 (optional extension)
  if (idx < tokens.length && !isNil(tokens[idx])) {
    body.md5 = tokenToString(tokens[idx]) || undefined;
  }
  idx++;
  
  // Disposition (optional extension)
  if (idx < tokens.length && !isNil(tokens[idx])) {
    body.disposition = parseDisposition(tokens[idx]);
  }
  idx++;
  
  // Language (optional extension)
  if (idx < tokens.length && !isNil(tokens[idx])) {
    body.language = parseLanguage(tokens[idx]);
  }
  idx++;
  
  // Location (optional extension)
  if (idx < tokens.length && !isNil(tokens[idx])) {
    body.location = tokenToString(tokens[idx]) || undefined;
  }
  
  return body;
}

/**
 * Parses a body structure from tokenized input
 */
export function parseBodyStructureTokens(tokens: Token[]): BodyStructure {
  if (tokens.length === 0) {
    return {
      type: 'text',
      subtype: 'plain',
      params: {},
      id: null,
      description: null,
      encoding: '7bit',
      size: 0,
    };
  }
  
  // Check if this is a multipart body
  // Multipart bodies start with nested lists (the parts)
  const firstToken = tokens[0];
  
  if (Array.isArray(firstToken)) {
    // This is a multipart body
    const parts: BodyStructure[] = [];
    let idx = 0;
    
    // Collect all the part lists
    while (idx < tokens.length && Array.isArray(tokens[idx])) {
      parts.push(parseBodyStructureTokens(tokens[idx] as Token[]));
      idx++;
    }
    
    // Next is the subtype
    const subtype = idx < tokens.length ? tokenToString(tokens[idx]) || 'mixed' : 'mixed';
    idx++;
    
    const body: BodyStructure = {
      type: 'multipart',
      subtype: subtype.toLowerCase(),
      params: {},
      id: null,
      description: null,
      encoding: '7bit',
      size: 0,
      parts,
    };
    
    // Extension data: params, disposition, language, location
    if (idx < tokens.length) {
      body.params = parseParams(tokens[idx]);
      idx++;
    }
    
    if (idx < tokens.length && !isNil(tokens[idx])) {
      body.disposition = parseDisposition(tokens[idx]);
      idx++;
    }
    
    if (idx < tokens.length && !isNil(tokens[idx])) {
      body.language = parseLanguage(tokens[idx]);
      idx++;
    }
    
    if (idx < tokens.length && !isNil(tokens[idx])) {
      body.location = tokenToString(tokens[idx]) || undefined;
    }
    
    return body;
  }
  
  // Basic (non-multipart) body
  return parseBasicBody(tokens);
}

/**
 * Parses an IMAP BODYSTRUCTURE response
 * 
 * @param bodystructure - Raw BODYSTRUCTURE string from IMAP response
 * @returns Parsed BodyStructure object
 */
export function parseBodyStructure(bodystructure: string): BodyStructure {
  const tokens = tokenizeBodyStructure(bodystructure);
  
  // The bodystructure is typically wrapped in parentheses
  if (tokens.length === 1 && Array.isArray(tokens[0])) {
    return parseBodyStructureTokens(tokens[0] as Token[]);
  }
  
  return parseBodyStructureTokens(tokens);
}
