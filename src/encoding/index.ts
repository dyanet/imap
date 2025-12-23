/**
 * Content encoding/decoding utilities for IMAP message handling
 * 
 * Implements base64 and quoted-printable encoding/decoding using only
 * Node.js built-in modules (zero dependencies).
 * 
 * @packageDocumentation
 */

export { base64Encode, base64Decode } from './base64.js';
export { quotedPrintableEncode, quotedPrintableDecode } from './quoted-printable.js';
