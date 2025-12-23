/**
 * IMAP Response Tokenizer
 * 
 * Tokenizes IMAP server responses into structured tokens.
 * Handles quoted strings, literals, atoms, and parenthesized lists.
 * 
 * @packageDocumentation
 */

/**
 * Token types in IMAP responses
 */
export type TokenType = 'atom' | 'quoted' | 'literal' | 'list' | 'nil';

/**
 * A token from an IMAP response
 */
export interface Token {
  type: TokenType;
  value: string | Token[] | null;
}

/**
 * Result of tokenization
 */
export interface TokenizeResult {
  tokens: Token[];
  remaining: string;
}

/**
 * IMAP special characters that delimit atoms
 * Note: Backslash is NOT a delimiter for atoms - it's used in flags like \Seen, \Flagged
 * Backslash is only special inside quoted strings
 */
const ATOM_SPECIALS = new Set(['(', ')', '{', ' ', '\r', '\n', '"', '[', ']']);

/**
 * Checks if a character is an atom special
 */
function isAtomSpecial(char: string): boolean {
  return ATOM_SPECIALS.has(char);
}

/**
 * Tokenizes an IMAP response string into structured tokens
 * 
 * @param input - The IMAP response string to tokenize
 * @returns TokenizeResult with tokens and any remaining unparsed input
 */
export function tokenize(input: string): TokenizeResult {
  const tokens: Token[] = [];
  let pos = 0;

  while (pos < input.length) {
    // Skip whitespace
    while (pos < input.length && (input[pos] === ' ' || input[pos] === '\t')) {
      pos++;
    }

    if (pos >= input.length) break;

    const char = input[pos];

    // Handle CRLF - end of response line
    if (char === '\r' || char === '\n') {
      break;
    }

    // Handle quoted string
    if (char === '"') {
      const result = parseQuotedString(input, pos);
      tokens.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle literal {n}
    if (char === '{') {
      const result = parseLiteral(input, pos);
      tokens.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle parenthesized list
    if (char === '(') {
      const result = parseList(input, pos);
      tokens.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle closing paren (shouldn't happen at top level, but handle gracefully)
    if (char === ')') {
      break;
    }

    // Handle square brackets (for response codes like [UIDVALIDITY 123])
    if (char === '[') {
      const result = parseBracketedList(input, pos);
      tokens.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle atom (including NIL)
    const result = parseAtom(input, pos);
    tokens.push(result.token);
    pos = result.pos;
  }

  return {
    tokens,
    remaining: input.slice(pos)
  };
}


/**
 * Parses a quoted string starting at the given position
 */
function parseQuotedString(input: string, startPos: number): { token: Token; pos: number } {
  let pos = startPos + 1; // Skip opening quote
  let value = '';
  let escaped = false;

  while (pos < input.length) {
    const char = input[pos];

    if (escaped) {
      // Handle escaped characters (\" and \\)
      value += char;
      escaped = false;
      pos++;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      pos++;
      continue;
    }

    if (char === '"') {
      // End of quoted string
      pos++; // Skip closing quote
      return {
        token: { type: 'quoted', value },
        pos
      };
    }

    value += char;
    pos++;
  }

  // Unterminated quoted string - return what we have
  return {
    token: { type: 'quoted', value },
    pos
  };
}

/**
 * Parses a literal {n} marker
 * Note: The actual literal data follows on the next line
 */
function parseLiteral(input: string, startPos: number): { token: Token; pos: number } {
  let pos = startPos + 1; // Skip opening brace
  let sizeStr = '';

  while (pos < input.length && input[pos] !== '}') {
    sizeStr += input[pos];
    pos++;
  }

  if (pos < input.length && input[pos] === '}') {
    pos++; // Skip closing brace
  }

  // The literal marker contains the size; actual data follows
  // For now, we return the size as the value
  // The caller must handle reading the actual literal data
  return {
    token: { type: 'literal', value: sizeStr },
    pos
  };
}

/**
 * Parses a parenthesized list
 */
function parseList(input: string, startPos: number): { token: Token; pos: number } {
  let pos = startPos + 1; // Skip opening paren
  const items: Token[] = [];

  while (pos < input.length) {
    // Skip whitespace
    while (pos < input.length && (input[pos] === ' ' || input[pos] === '\t')) {
      pos++;
    }

    if (pos >= input.length) break;

    const char = input[pos];

    // End of list
    if (char === ')') {
      pos++; // Skip closing paren
      return {
        token: { type: 'list', value: items },
        pos
      };
    }

    // Handle nested quoted string
    if (char === '"') {
      const result = parseQuotedString(input, pos);
      items.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle nested literal
    if (char === '{') {
      const result = parseLiteral(input, pos);
      items.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle nested list
    if (char === '(') {
      const result = parseList(input, pos);
      items.push(result.token);
      pos = result.pos;
      continue;
    }

    // Handle atom
    const result = parseAtom(input, pos);
    items.push(result.token);
    pos = result.pos;
  }

  // Unterminated list
  return {
    token: { type: 'list', value: items },
    pos
  };
}

/**
 * Parses a bracketed list [...]
 */
function parseBracketedList(input: string, startPos: number): { token: Token; pos: number } {
  let pos = startPos + 1; // Skip opening bracket
  let content = '';

  while (pos < input.length && input[pos] !== ']') {
    content += input[pos];
    pos++;
  }

  if (pos < input.length && input[pos] === ']') {
    pos++; // Skip closing bracket
  }

  // Return bracketed content as an atom with brackets preserved
  return {
    token: { type: 'atom', value: `[${content}]` },
    pos
  };
}

/**
 * Parses an atom (unquoted string)
 */
function parseAtom(input: string, startPos: number): { token: Token; pos: number } {
  let pos = startPos;
  let value = '';

  while (pos < input.length && !isAtomSpecial(input[pos])) {
    value += input[pos];
    pos++;
  }

  // Check for NIL
  if (value.toUpperCase() === 'NIL') {
    return {
      token: { type: 'nil', value: null },
      pos
    };
  }

  return {
    token: { type: 'atom', value },
    pos
  };
}

/**
 * Extracts the string value from a token
 * 
 * @param token - The token to extract value from
 * @returns The string value, or null for NIL tokens
 */
export function getTokenValue(token: Token): string | null {
  if (token.type === 'nil') {
    return null;
  }
  if (token.type === 'list') {
    return null; // Lists don't have a simple string value
  }
  return token.value as string;
}

/**
 * Checks if a token is a list
 */
export function isListToken(token: Token): token is Token & { value: Token[] } {
  return token.type === 'list' && Array.isArray(token.value);
}
