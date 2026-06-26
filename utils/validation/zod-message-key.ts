/**
 * @file utils/validation/zod-message-key.ts
 * @description zod-message-key helper for localized validation errors
 */
/**
 * Utilities for embedding and parsing messageKeys in Zod error messages.
 * This enables consistent i18n error handling across the API.
 *
 * @module utils/validation/zod-message-key
 */

// Regex to validate messageKey format: word.word-word (dot-separated, kebab-case segments)
const MESSAGE_KEY_PATTERN = /^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)+$/;

/**
 * Creates a Zod error message string with an embedded messageKey.
 * Format: "messageKey|Human-readable message"
 *
 * @param messageKey - The i18n key for the error message (e.g., "encryption.password-required")
 * @param message - The human-readable error message
 * @returns A pipe-delimited string with the messageKey and message
 *
 * @example
 * ```typescript
 * z.string().min(1, withKey("encryption.password-required", "Password is required"))
 * // Produces: "encryption.password-required|Password is required"
 * ```
 */
export function withKey(messageKey: string, message: string): string {
  return `${messageKey}|${message}`;
}

/**
 * Parse a messageKey from a Zod error message.
 * Returns { messageKey, message } if pipe-delimited with valid key format,
 * or { messageKey: fallback, message: raw } otherwise.
 *
 * @param raw - The raw error message string from Zod
 * @param fallbackKey - The fallback messageKey to use if parsing fails (default: "validation.schema-validation-failed")
 * @returns An object with messageKey and message properties
 *
 * @example
 * ```typescript
 * parseMessageKey("encryption.password-required|Password is required")
 * // Returns: { messageKey: "encryption.password-required", message: "Password is required" }
 *
 * parseMessageKey("Password is required")
 * // Returns: { messageKey: "validation.schema-validation-failed", message: "Password is required" }
 * ```
 */
export function parseMessageKey(
  raw: string,
  fallbackKey = "validation.schema-validation-failed",
): { messageKey: string; message: string } {
  const pipeIndex = raw.indexOf("|");
  if (pipeIndex > 0 && pipeIndex < raw.length - 1) {
    const candidateKey = raw.substring(0, pipeIndex);
    if (MESSAGE_KEY_PATTERN.test(candidateKey)) {
      return {
        messageKey: candidateKey,
        message: raw.substring(pipeIndex + 1),
      };
    }
  }
  return { messageKey: fallbackKey, message: raw };
}
