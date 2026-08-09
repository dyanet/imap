/**
 * Minimal `Buffer` stand-in for the browser.
 *
 * The MIME and encoding modules use exactly five Buffer operations:
 *
 *   Buffer.from(bytes)             Buffer.from(str, 'base64')
 *   Buffer.from(str, 'utf-8')      buf.toString('base64')
 *                                  buf.toString(encoding)
 *
 * That is a small enough surface to satisfy honestly with platform APIs
 * (`atob`/`btoa`, `TextDecoder`/`TextEncoder`) rather than pulling in a
 * full Buffer polyfill, which would be an order of magnitude larger than
 * the library being demonstrated.
 *
 * This exists only so the demo can run the library's real parsing code
 * unmodified in a browser. It is not part of @dyanet/imap and is not a
 * general-purpose Buffer.
 */

const encoder = new TextEncoder();

function labelFor(encoding) {
  // Node accepts 'utf-8'/'utf8'/'latin1'/'binary'; TextDecoder wants the
  // canonical label. Anything unrecognised falls back to utf-8, matching
  // how the library's callers use it.
  const e = String(encoding || "utf-8").toLowerCase();
  if (e === "utf8" || e === "utf-8") return "utf-8";
  if (e === "latin1" || e === "binary" || e === "iso-8859-1") return "iso-8859-1";
  if (e === "ascii" || e === "us-ascii") return "windows-1252";
  return e;
}

class BrowserBuffer extends Uint8Array {
  toString(encoding = "utf-8") {
    if (String(encoding).toLowerCase() === "base64") {
      let binary = "";
      for (const byte of this) binary += String.fromCharCode(byte);
      return btoa(binary);
    }
    try {
      return new TextDecoder(labelFor(encoding)).decode(this);
    } catch {
      // Unknown label -- decode as utf-8 rather than throwing, so a weird
      // charset in an encoded word degrades instead of blanking the page.
      return new TextDecoder("utf-8").decode(this);
    }
  }

  static from(value, encoding) {
    if (typeof value !== "string") return new BrowserBuffer(value);

    const enc = String(encoding || "utf-8").toLowerCase();
    if (enc === "base64") {
      // Tolerate missing padding and whitespace, which real encoded words
      // and folded headers both produce.
      const cleaned = value.replace(/[^A-Za-z0-9+/=]/g, "");
      const padded = cleaned + "=".repeat((4 - (cleaned.length % 4)) % 4);
      let binary;
      try {
        binary = atob(padded);
      } catch {
        return new BrowserBuffer(0);
      }
      const out = new BrowserBuffer(binary.length);
      for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
      return out;
    }

    if (enc === "latin1" || enc === "binary") {
      const out = new BrowserBuffer(value.length);
      for (let i = 0; i < value.length; i++) out[i] = value.charCodeAt(i) & 0xff;
      return out;
    }

    return new BrowserBuffer(encoder.encode(value));
  }

  static isBuffer(value) {
    return value instanceof BrowserBuffer;
  }
}

export { BrowserBuffer as Buffer };
