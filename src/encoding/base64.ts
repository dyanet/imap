/**
 * Base64 encoding/decoding using Node.js Buffer
 * 
 * Provides zero-dependency base64 encoding and decoding for IMAP
 * attachment and content handling.
 */

/**
 * Encodes a string or Buffer to base64
 * 
 * @param data - The data to encode (string or Buffer)
 * @returns Base64 encoded string
 */
export function base64Encode(data: string | Buffer): string {
  const buffer = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
  return buffer.toString('base64');
}

/**
 * Decodes a base64 string to a Buffer
 * 
 * @param encoded - The base64 encoded string
 * @returns Decoded Buffer
 */
export function base64Decode(encoded: string): Buffer {
  // Remove any whitespace (MIME base64 can have line breaks)
  const cleaned = encoded.replace(/\s/g, '');
  return Buffer.from(cleaned, 'base64');
}

/**
 * Decodes a base64 string to a UTF-8 string
 * 
 * @param encoded - The base64 encoded string
 * @returns Decoded UTF-8 string
 */
export function base64DecodeToString(encoded: string): string {
  return base64Decode(encoded).toString('utf-8');
}
