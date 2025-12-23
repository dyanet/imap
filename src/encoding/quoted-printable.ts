/**
 * Quoted-Printable encoding/decoding
 * 
 * Implements RFC 2045 quoted-printable encoding for IMAP message content.
 * Zero dependencies - uses only Node.js built-in modules.
 */

/**
 * Encodes a string or Buffer to quoted-printable format
 * 
 * @param data - The data to encode (string or Buffer)
 * @returns Quoted-printable encoded string
 */
export function quotedPrintableEncode(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  let result = '';
  let lineLength = 0;
  const MAX_LINE_LENGTH = 76;

  for (let i = 0; i < buffer.length; i++) {
    const byte = buffer[i];
    let encoded: string;

    // Printable ASCII characters (33-126) except '=' (61) can be literal
    // Space (32) and tab (9) can be literal unless at end of line
    if ((byte >= 33 && byte <= 126 && byte !== 61) ||
        (byte === 32 || byte === 9)) {
      encoded = String.fromCharCode(byte);
    } else {
      // Encode as =XX where XX is uppercase hex
      encoded = '=' + byte.toString(16).toUpperCase().padStart(2, '0');
    }

    // Check if we need a soft line break
    if (lineLength + encoded.length > MAX_LINE_LENGTH - 1) {
      result += '=\r\n';
      lineLength = 0;
    }

    result += encoded;
    lineLength += encoded.length;
  }

  return result;
}

/**
 * Decodes a quoted-printable string to a Buffer
 * 
 * @param encoded - The quoted-printable encoded string
 * @returns Decoded Buffer
 */
export function quotedPrintableDecode(encoded: string): Buffer {
  const bytes: number[] = [];
  let i = 0;

  while (i < encoded.length) {
    const char = encoded[i];

    if (char === '=') {
      // Check for soft line break (=\r\n or =\n)
      if (encoded[i + 1] === '\r' && encoded[i + 2] === '\n') {
        i += 3;
        continue;
      }
      if (encoded[i + 1] === '\n') {
        i += 2;
        continue;
      }

      // Decode hex sequence =XX
      const hex = encoded.substring(i + 1, i + 3);
      if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
        bytes.push(parseInt(hex, 16));
        i += 3;
      } else {
        // Invalid sequence, keep the '=' as literal
        bytes.push(char.charCodeAt(0));
        i++;
      }
    } else if (char === '\r' && encoded[i + 1] === '\n') {
      // Hard line break
      bytes.push(0x0D, 0x0A);
      i += 2;
    } else if (char === '\n') {
      // Bare LF (normalize to CRLF)
      bytes.push(0x0D, 0x0A);
      i++;
    } else {
      bytes.push(char.charCodeAt(0));
      i++;
    }
  }

  return Buffer.from(bytes);
}

/**
 * Decodes a quoted-printable string to a UTF-8 string
 * 
 * @param encoded - The quoted-printable encoded string
 * @returns Decoded UTF-8 string
 */
export function quotedPrintableDecodeToString(encoded: string): string {
  return quotedPrintableDecode(encoded).toString('utf-8');
}
