import { BufferEncoding } from "./buffer-encoding.ts";

/**
 * @file utils/text/transformations.ts
 * @description String sanitization, casing, and SQL-pattern escaping.
 *
 * Buffer/base64/base64url (de)serialization now lives in {@link BufferEncoding}.
 * Its methods are re-exposed here as static delegates so existing
 * `TextTransformations.base64ToBuffer(...)` call sites continue to resolve; new
 * code should import `BufferEncoding` directly.
 */
export class TextTransformations {
  /**
   * Convert string to camelCase
   */
  static toCamelCase(str: string): string {
    return str
      .toLowerCase()
      .replace(/[-_\s]+(.)?/g, (_, char) => char ? char.toUpperCase() : "");
  }

  /**
   * Extract and clean text from HTML
   */
  static stripHtml(str: string): string {
    return str.replace(/<[^>]*>/g, "").trim();
  }

  /**
   * Truncate text with ellipsis
   */
  static truncate(
    str: string,
    maxLength: number,
    suffix: string = "...",
  ): string {
    if (str.length <= maxLength) return str;
    return str.substring(0, maxLength - suffix.length) + suffix;
  }

  /**
   * Generate slug from text
   */
  static slugify(str: string): string {
    return str
      .toLowerCase()
      .trim()
      .replace(/[^\w\s-]/g, "")
      .replace(/[\s_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  /**
   * Escape special characters for safe use in SQL LIKE/ILIKE patterns
   * Escapes: % (match any), _ (match single), and \ (escape char)
   * @param str - The string to escape
   * @param maxLength - Optional max length to truncate to (default: 100)
   * @returns Escaped string safe for LIKE pattern matching
   */
  static escapeLikePattern(str: string, maxLength: number = 100): string {
    if (!str || typeof str !== "string") return "";
    // Truncate to prevent overly long patterns
    const truncated = str.slice(0, maxLength);
    // Escape backslash first, then % and _
    return truncated.replace(/\\/g, "\\\\").replace(/[%_]/g, "\\$&");
  }

  // ---- Buffer/base64 (de)serialization delegates (see BufferEncoding) ----
  // @deprecated import BufferEncoding directly for new code
  static fromBufferToBase64UrlString = BufferEncoding.fromBufferToBase64UrlString;
  /** @deprecated import BufferEncoding directly */
  static fromBufferToBase64 = BufferEncoding.fromBufferToBase64;
  /** @deprecated import BufferEncoding directly */
  static base64ToBuffer = BufferEncoding.base64ToBuffer;
  /** @deprecated import BufferEncoding directly */
  static fromBase64URLStringToBuffer = BufferEncoding.fromBase64URLStringToBuffer;
}
