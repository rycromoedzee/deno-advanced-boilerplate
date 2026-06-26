/**
 * @file services/token/token-utils.ts
 * @description Token Utils service module (token)
 */
import { bytesToHex } from "@deps";
import { getUserAgentInfo } from "@utils/network/index.ts";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";

/**
 * Creates a fingerprint hash for a user session based on user-agent and accept headers.
 *
 * @param {string} userAgent - The user's user-agent string.
 * @param {string} acceptHeaders - The Accept headers from the request.
 * @param {string} lang - The language preference from the request.
 * @returns {string} The fingerprint hash (hex-encoded blake3).
 * @remarks Pure utility function for creating session fingerprints
 */
export function JWTAuthTokenCreateFingerprint(
  userAgent: string,
  acceptHeaders: string,
  lang: string,
): string {
  return bytesToHex(TextHashing.generateHashFromString(
    `${getUserAgentInfo(userAgent)}-${acceptHeaders}-${lang}`,
    HASHING_CONTEXTS.AUTH_FINGERPRINT,
  ));
}

/**
 * Hashes a token using blake3 for secure cache storage and lookup.
 * @param token - The token to hash (JWT, API key, or other token types).
 * @returns string The hashed token (hex-encoded, 24 bytes).
 */
export function tokenHashString(token: string): string {
  return bytesToHex(
    TextHashing.generateHashFromString(
      token,
      HASHING_CONTEXTS.AUTH_TOKEN_HASH,
      24,
    ),
  );
}

/**
 * Generates a secure, random refresh token as raw bytes.
 * Use `encodeTokenBytes()` to convert to a storable string format.
 * @returns Uint8Array The random token bytes (64 bytes).
 */
export function generateRefreshTokenBytes(): Uint8Array {
  return TextHashing.generateKeyFromRandom(
    64,
    HASHING_CONTEXTS.AUTH_REFRESH_TOKEN,
  );
}

/**
 * Encodes token bytes to a URL-safe base64 string for storage and transmission.
 * @param token - The raw token bytes to encode.
 * @returns string URL-safe base64 encoded string.
 */
export function encodeTokenBytes(token: Uint8Array): string {
  return btoa(String.fromCharCode(...token))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
