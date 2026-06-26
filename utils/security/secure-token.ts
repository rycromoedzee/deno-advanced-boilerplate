/**
 * @file utils/security/secure-token.ts
 * @description Secure random token generation
 */
import { TextTransformations } from "@utils/text/index.ts";

/**
 * Centralized cryptographically-secure randomness for tokens, salts, and nonces.
 *
 * These wrappers are kept deliberately (rather than inlining `crypto.getRandomValues`
 * at each call site) because they each pin a single security decision in one place:
 *
 * - {@link generateSecureRandomBytes} — the sole sanctioned source of randomness for
 *   salts/nonces; forbids `Math.random` and weak fallbacks everywhere else.
 * - {@link generateSecureTokenBase64Url} — tokens are `byteLength` random bytes
 *   encoded as base64url (URL-safe, no padding), the only shape this codebase uses
 *   for opaque tokens (jti, reauth tokens, magic-link tokens).
 */

/**
 * Generate a cryptographically secure random token encoded as base64url (no padding).
 *
 * @param byteLength - Number of random bytes (default 32 = 256 bits)
 * @returns URL-safe base64url-encoded token string
 */
export function generateSecureTokenBase64Url(byteLength: number = 32): string {
  return TextTransformations.fromBufferToBase64UrlString(
    crypto.getRandomValues(new Uint8Array(byteLength)).buffer,
  );
}

/**
 * Generate a cryptographically secure random byte sequence.
 * Use this (not Math.random) for any salt, nonce, or key material.
 *
 * @param byteLength - Number of random bytes (default 32 = 256 bits)
 * @returns Uint8Array of random bytes
 */
export function generateSecureRandomBytes(byteLength: number = 32): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(byteLength));
}
