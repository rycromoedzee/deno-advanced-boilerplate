/**
 * @file services/public-sharing/secure-link-generator.service.ts
 * @description Pure link generation service with Proton Drive-inspired zero-knowledge security
 * Handles only cryptographic link generation, no database operations
 *
 * ARCHITECTURE:
 * - shareId: Stored in database, used for share lookups (sent in URL path/query)
 * - shareKey: NEVER stored in database, placed in URL fragment (#), used to encrypt master key
 * - The URL fragment is never sent to the server by browsers, ensuring zero-knowledge
 */

import { encodeBase64 } from "@std/encoding/base64";
import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { randomBytes } from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { generateSecureTokenBase64Url } from "@utils/security/secure-token.ts";

/** Configuration for secure link generation */
export interface SecureLinkConfig {
  /** Custom share ID (optional, replaces shareId) */
  customShareId?: string;
  /** Custom share key (optional, replaces shareKey) */
  customShareKey?: string;
  /** Share ID entropy in bits (default: 512) */
  shareIdBits?: number;
  /** Share key entropy in bits (default: 512) */
  shareKeyBits?: number;
}

/** Result of secure link generation */
export interface SecureLinkResult {
  /** Complete shareable URI with shareId in query and shareKey in fragment */
  publicUri: string;
  /** Full share ID with environmentId prefix (encodedEnvId.actualToken) - use in URLs */
  shareId: string;
  /** Actual token for database storage (without environmentId prefix) */
  shareToken: string;
  /** Share key for encryption (NEVER store this in the database!) */
  shareKey: string;
  /** @deprecated Use shareId instead. Kept for backward compatibility */
  volumeId: string;
  /** @deprecated Use shareKey instead. Kept for backward compatibility */
  linkId: string;
}

/** Context for share ID generation */
export interface ShareIdContext {
  /** User ID creating the share */
  userId: string;
  /** Resource ID being shared */
  resourceId: string;
  /** Timestamp */
  timestamp: number;
  /** Environment ID for tenant DB routing (required for public shares) */
  environmentId: string;
}

/**
 * @deprecated Use ShareIdContext instead. Kept for backward compatibility
 */
export type VolumeIdContext = ShareIdContext;

/** Bit range validation constants */
const _MIN_BITS = 1;
const MAX_BITS = 4096;

/**
 * Validates bit range for secure ID generation
 */
function validateBitRange(bits: number): void {
  if (bits <= 0 || bits > MAX_BITS) {
    throwHttpError("VALIDATION.VALUE_OUT_OF_RANGE");
  }
}

/**
 * Converts bytes to base64url encoding (URL-safe)
 */
function bytesToBase64Url(bytes: Uint8Array): string {
  return encodeBase64(bytes)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Encodes a string to base64url (URL-safe, no padding)
 * Used for encoding environmentId prefix in share tokens
 */
function stringToBase64Url(str: string): string {
  return encodeBase64(new TextEncoder().encode(str))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Decodes a base64url string back to original string
 * Used for decoding environmentId prefix from share tokens
 */
function base64UrlToString(b64url: string): string {
  // Restore padding if needed
  const b64 = b64url
    .replace(/-/g, "+")
    .replace(/_/g, "/");
  const padding = b64.length % 4;
  const paddedB64 = padding ? b64 + "=".repeat(4 - padding) : b64;
  return new TextDecoder().decode(Uint8Array.from(atob(paddedB64), (c) => c.charCodeAt(0)));
}

/** Separator between encoded environmentId and actual share token */
export const SHARE_ID_SEPARATOR = ".";

/**
 * Parses a shareId to extract the environmentId and actual token
 * @param shareId - Full shareId with optional environmentId prefix (encodedEnvId.actualToken)
 * @returns Object with environmentId (if present) and the actual token for DB lookup
 */
export function parseShareId(shareId: string): { environmentId: string | null; token: string } {
  const separatorIndex = shareId.indexOf(SHARE_ID_SEPARATOR);

  if (separatorIndex === -1) {
    // Legacy format: no environmentId prefix
    return { environmentId: null, token: shareId };
  }

  const encodedEnvId = shareId.slice(0, separatorIndex);
  const token = shareId.slice(separatorIndex + 1);

  try {
    const environmentId = base64UrlToString(encodedEnvId);
    return { environmentId, token };
  } catch {
    // If decoding fails, treat entire thing as token (legacy fallback)
    useLogger(LoggerLevels.warn, {
      message: "Failed to decode environmentId from shareId, treating as legacy token",
      messageKey: "public_share.parse_share_id.decode_failed",
      section: loggerAppSections.PUBLIC_SHARE,
      details: { shareIdPrefix: shareId.substring(0, 8) + "..." },
    });
    return { environmentId: null, token: shareId };
  }
}

/**
 * Pure secure link generation service
 * No database dependencies - only cryptographic operations
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * The shareKey is placed in the URL fragment (#) which browsers never send to the server.
 * This ensures the server never has access to the decryption key in transit or logs.
 */
export class SecureLinkGeneratorService {
  /**
   * Generates a cryptographically secure ID with specified entropy
   * @param bits - Entropy in bits (default: 512)
   * @returns Base64url-encoded secure ID
   */
  generateSecureId(bits = 512): string {
    validateBitRange(bits);

    return generateSecureTokenBase64Url(Math.ceil(bits / 8))
  }

  /**
   * Generates a contextual share ID using environment and user context
   * Combines secure randomness with contextual hashing for uniqueness
   * @param context - Context for share ID generation
   * @param bits - Entropy in bits (default: 512)
   * @returns Contextual share ID
   */
  async generateContextualShareId(context: ShareIdContext, bits = 512): Promise<string> {
    if (!context.userId || !context.resourceId) {
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }
    validateBitRange(bits);

    return await tracedWithServiceErrorHandling(
      "SecureLinkGenerator.generateContextualShareId",
      {
        service: "SecureLinkGenerator",
        method: "generateContextualShareId",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { userId: context.userId, resourceId: context.resourceId, bits },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      // Callback typed (span) => Promise<T> by tracedWithServiceErrorHandling.
      // deno-lint-ignore require-await
      async () => {
        // Create contextual data for hashing
        const contextualData = [context.userId, context.resourceId, context.timestamp.toString()].join(":");

        // Generate hash from contextual data (32 bytes)
        const contextualHash = TextHashing.generateHashFromString(
          contextualData,
          HASHING_CONTEXTS.PUBLIC_SHARE,
          32,
        );

        // Generate additional secure random bytes
        const randomBytesCount = Math.ceil(bits / 8) - 32;
        const randomPart = randomBytes(randomBytesCount);

        // Combine contextual hash with random bytes
        const combinedBytes = new Uint8Array(contextualHash.length + randomPart.length);
        combinedBytes.set(contextualHash);
        combinedBytes.set(randomPart, contextualHash.length);

        return bytesToBase64Url(combinedBytes);
      },
    );
  }

  /**
   * @deprecated Use generateContextualShareId instead
   */
  async generateContextualVolumeId(context: VolumeIdContext, bits = 512): Promise<string> {
    return await this.generateContextualShareId(context, bits);
  }

  /**
   * Creates a zero-knowledge secure public URI
   *
   * The shareId format: encodedEnvId.actualToken
   * - encodedEnvId: base64url-encoded environmentId (for tenant DB routing)
   * - actualToken: stored in DB, used for lookups
   * The shareKey is placed in the URL fragment (NEVER sent to server)
   *
   * @param context - Context for share ID generation (must include environmentId)
   * @param config - Configuration options
   * @returns Secure link result with shareId and shareKey
   */
  async createSecurePublicUri(context: ShareIdContext, config: SecureLinkConfig = {}): Promise<SecureLinkResult> {
    if (!context.userId || !context.resourceId) {
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }

    if (!context.environmentId) {
      useLogger(LoggerLevels.error, {
        message: "environmentId is required in ShareIdContext for public shares",
        messageKey: "public_share.create_secure_public_uri.missing_environment_id",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { userId: context.userId, resourceId: context.resourceId },
      });
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }

    return await tracedWithServiceErrorHandling(
      "SecureLinkGenerator.createSecurePublicUri",
      {
        service: "SecureLinkGenerator",
        method: "createSecurePublicUri",
        section: loggerAppSections.PUBLIC_SHARE,
        details: { userId: context.userId, resourceId: context.resourceId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const { customShareId, customShareKey, shareIdBits = 512, shareKeyBits = 512 } = config;

        // Generate or use provided share token (stored in DB, used for lookups)
        const shareToken = customShareId ?? await this.generateContextualShareId(context, shareIdBits);

        // Encode environmentId and prefix to shareToken: encodedEnvId.actualToken
        const encodedEnvId = stringToBase64Url(context.environmentId);
        const shareId = `${encodedEnvId}${SHARE_ID_SEPARATOR}${shareToken}`;

        // Generate or use provided share key (NEVER stored in DB, used for encryption)
        const shareKey = customShareKey ?? await this.generateSecureId(shareKeyBits);

        // Build the URI:
        // - shareId goes in query string (server receives this for lookups)
        // - shareKey goes in fragment (browser NEVER sends this to server)
        const publicUri = `?shareId=${encodeURIComponent(shareId)}#${encodeURIComponent(shareKey)}`;

        return {
          publicUri,
          shareId,
          shareToken,
          shareKey,
          // Backward compatibility aliases
          volumeId: shareId,
          linkId: shareKey,
        };
      },
    );
  }

  /**
   * Validates a secure ID format
   * @param id - ID to validate
   * @returns True if ID appears to be a valid secure ID
   */
  validateSecureId(id: string): boolean {
    if (!id || typeof id !== "string") return false;
    if (id.length < 10 || id.length > 200) return false;
    return /^[A-Za-z0-9_-]+$/.test(id);
  }

  /**
   * Validates a share key format
   * @param key - Key to validate
   * @returns True if key appears to be a valid share key
   */
  validateShareKey(key: string): boolean {
    return this.validateSecureId(key);
  }
}
