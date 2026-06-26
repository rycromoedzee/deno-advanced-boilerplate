import { Buffer } from "@deps";

/**
 * @file utils/text/buffer-encoding.ts
 * @description Binary/base64/base64url buffer encoding utilities.
 *
 * Split out of {@link TextTransformations} because buffer (de)serialization is a
 * distinct responsibility from string sanitization/casing. Encryption, auth, and
 * upload code use these to move key material, nonces, and ciphertext between
 * `Uint8Array`/`ArrayBuffer` and string representations.
 */
export class BufferEncoding {
  /**
   * Convert buffer to Base64URL string (RFC 4648 §5, no padding).
   * Adapted from simplewebauthn/browser utils.
   */
  static fromBufferToBase64UrlString(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let str = "";

    for (const charCode of bytes) {
      str += String.fromCharCode(charCode);
    }

    const base64String = btoa(str);

    return base64String.replace(/\+/g, "-").replace(/\//g, "_").replace(
      /=/g,
      "",
    );
  }

  static fromBufferToBase64(buffer: Buffer | Uint8Array): string {
    const bytes = new Uint8Array(buffer);
    let str = "";

    for (const charCode of bytes) {
      str += String.fromCharCode(charCode);
    }

    return btoa(str);
  }

  static base64ToBuffer(base64String: string): Uint8Array {
    const binaryString = atob(base64String);
    const buffer = new Uint8Array(binaryString.length);

    for (let i = 0; i < binaryString.length; i++) {
      buffer[i] = binaryString.charCodeAt(i);
    }

    return buffer;
  }

  /**
   * Convert Base64URL string to buffer.
   * Adapted from simplewebauthn/browser utils.
   */
  static fromBase64URLStringToBuffer(base64URLString: string): ArrayBuffer {
    // Convert from Base64URL to Base64
    const base64 = base64URLString.replace(/-/g, "+").replace(/_/g, "/");
    /**
     * Pad with '=' until it's a multiple of four
     * (4 - (85 % 4 = 1) = 3) % 4 = 3 padding
     * (4 - (86 % 4 = 2) = 2) % 4 = 2 padding
     * (4 - (87 % 4 = 3) = 1) % 4 = 1 padding
     * (4 - (88 % 4 = 0) = 4) % 4 = 0 padding
     */
    const padLength = (4 - (base64.length % 4)) % 4;
    const padded = base64.padEnd(base64.length + padLength, "=");

    // Convert to a binary string
    const binary = atob(padded);

    // Convert binary string to buffer
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    return buffer;
  }
}
