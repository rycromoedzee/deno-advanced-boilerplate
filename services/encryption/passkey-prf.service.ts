/**
 * @file services/encryption/passkey-prf.service.ts
 * @description Service for handling WebAuthn PRF (Pseudo-Random Function) extension
 * for passkey-derived encryption keys.
 *
 * The PRF extension allows deriving deterministic encryption keys from the authenticator,
 * enabling passkey-only users to have user-key encryption without a password.
 */

import { randomBytes } from "@deps";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { HASHING_CONTEXTS, TextHashing, TextTransformations } from "@utils/text/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { tokenHashString } from "@services/token/index.ts";
import { ITokensEncryptionData, ITokensSessionData } from "@services/token/config.ts";
import { getTimeNow } from "@utils/shared/index.ts";

/**
 * Interface for PRF output received from the client
 */
export interface IPRFOutput {
  /** The first PRF output (32 bytes as base64) */
  first: string;
}

/**
 * Interface for PRF evaluation request to send to client
 */
export interface IPRFEvaluationRequest {
  /** The salt to use for PRF evaluation (base64-encoded) */
  salt?: string;
  /** Optional per-credential salts for PRF evaluation */
  saltsByCredential?: Record<string, string>;
}

/**
 * PasskeyPRFService
 * ------------------------------------------------
 * Handles PRF extension operations for passkey-derived encryption keys.
 *
 * Key characteristics:
 * 1. Deterministic: Same credential + same salt = same output always
 * 2. User-bound: Requires user verification - biometric/PIN
 * 3. Hardware-protected: Private key never leaves authenticator
 * 4. No storage needed: Key is derived, not stored
 *
 * Note: This is a utility class with all static methods. Do not instantiate.
 * @example
 * ```typescript
 * // Correct usage - call static methods directly
 * const salt = PasskeyPRFService.generatePRFSalt();
 * const key = await PasskeyPRFService.deriveKeyFromPRF(output, userId);
 *
 * // Incorrect - do not instantiate
 * const service = new PasskeyPRFService(); // Don't do this
 * ```
 */
export class PasskeyPRFService {
  /**
   * Private constructor to prevent instantiation - this is a static utility class
   * @private
   */
  private constructor() {
    // This class uses only static methods and should not be instantiated
  }

  /**
   * Generates a new 32-byte salt for PRF key derivation
   * @returns Base64-encoded salt
   */
  static generatePRFSalt(): string {
    const saltBytes = randomBytes(32);
    return TextTransformations.fromBufferToBase64(saltBytes);
  }

  /**
   * Decodes a base64 or base64url string to Uint8Array.
   * WebAuthn authenticators return PRF output in Base64URL format,
   * while internal cached values use standard Base64.
   * This helper handles both formats transparently.
   *
   * @param input - Base64 or Base64URL encoded string
   * @returns Decoded bytes as Uint8Array
   */
  private static decodeBase64OrURL(input: string): Uint8Array {
    // Check if this looks like Base64URL (contains - or _ but no + or /)
    const isBase64URL = (input.includes("-") || input.includes("_")) &&
      !input.includes("+") &&
      !input.includes("/");

    if (isBase64URL) {
      // Use the Base64URL decoder
      return new Uint8Array(TextTransformations.fromBase64URLStringToBuffer(input));
    } else {
      // Use standard Base64 decoder
      return TextTransformations.base64ToBuffer(input);
    }
  }

  /**
   * Derives an encryption key from PRF output
   * The PRF output is stretched using HKDF to create a 32-byte encryption key
   *
   * @param prfOutput - The PRF output from the authenticator (base64url or base64-encoded)
   * @param userId - The user ID for context
   * @returns Promise resolving to 32-byte encryption key
   */
  static async deriveKeyFromPRF(
    prfOutput: string,
    userId: string,
  ): Promise<Uint8Array> {
    return await tracedWithServiceErrorHandling(
      "PasskeyPRFService.deriveKeyFromPRF",
      {
        service: "PasskeyPRFService",
        method: "deriveKeyFromPRF",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "ENCRYPTION.KEY_GENERATION_FAILED",
      // Callback typed (span) => Promise<T> by tracedWithServiceErrorHandling.
      // deno-lint-ignore require-await
      async (span) => {
        span.attributes["user_id"] = userId;

        // Validate prfOutput exists
        if (!prfOutput || typeof prfOutput !== "string" || prfOutput.length === 0) {
          throwHttpError("ENCRYPTION.KEY_GENERATION_FAILED", new Error("Invalid PRF output: empty or not a string"));
        }

        // Decode the PRF output - handles both Base64URL (from authenticators) and Base64 (from cache)
        const prfBytes = this.decodeBase64OrURL(prfOutput);

        // Stretch the PRF output using context-specific hashing
        const derivedKey = TextHashing.generateHashFromKey(
          prfBytes,
          HASHING_CONTEXTS.PASSKEY_ENCRYPTION,
          32,
        );

        span.attributes["success"] = true;
        return derivedKey;
      },
    );
  }

  /**
   * Encrypts the user master key with a PRF-derived key
   *
   * @param userMasterKey - The user's master encryption key
   * @param prfDerivedKey - The key derived from PRF output
   * @param userId - The user ID
   * @returns Promise resolving to encrypted master key
   */
  static async encryptMasterKeyWithPRF(
    userMasterKey: Uint8Array,
    prfDerivedKey: Uint8Array,
    userId: string,
  ): Promise<Uint8Array> {
    return await tracedWithServiceErrorHandling(
      "PasskeyPRFService.encryptMasterKeyWithPRF",
      {
        service: "PasskeyPRFService",
        method: "encryptMasterKeyWithPRF",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "ENCRYPTION.ENCRYPTION_FAILED",
      async (span) => {
        span.attributes["user_id"] = userId;

        const encryptedMasterKey = await useSymmetricEncrypt({
          key: prfDerivedKey,
          data: userMasterKey,
        });

        span.attributes["success"] = true;
        return encryptedMasterKey;
      },
    );
  }

  /**
   * Caches a PRF-derived key in the session for the duration of the access token
   * This allows subsequent encryption operations without re-authenticating
   *
   * @param accessToken - The JWT access token
   * @param ttl - Time-to-live in seconds
   * @param prfDerivedKey - The PRF-derived key (base64-encoded)
   * @returns Promise that resolves when cached
   */
  static async cachePRFDerivedKey(
    accessToken: string,
    ttl: number,
    prfDerivedKey: string,
    credentialId?: string,
    sessionKey?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PasskeyPRFService.cachePRFDerivedKey",
      {
        service: "PasskeyPRFService",
        method: "cachePRFDerivedKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { ttl },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["ttl"] = ttl;
        span.attributes["has_derived_key"] = !!prfDerivedKey;
        span.attributes["has_session_key"] = !!sessionKey;

        // Early return if no key provided
        if (!prfDerivedKey || prfDerivedKey === "") {
          useLogger(LoggerLevels.info, {
            message: "Skipping PRF-derived key caching - no key provided",
            messageKey: "encryption.skip_prf_key_cache.no_key",
            section: loggerAppSections.USER_ENCRYPTED,
            details: { reason: "no_prf_output" },
          });
          return;
        }

        const cache = await getCache();
        const tokenHash = tokenHashString(accessToken);
        span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

        // Get current session data
        const currentSession = await cache.get<ITokensSessionData>(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
        );

        if (!currentSession) {
          span.attributes["session_not_found"] = true;
          throwHttpError("SESSION.INVALID_SESSION");
        }

        span.attributes["user_id"] = currentSession!.userId;

        // Create encryption key for storing the PRF-derived key (client-bound via sessionKey)
        const encryptionKey = this.generateEncryptionKeyForPRFKeyStorage(tokenHash, sessionKey);

        // Convert base64-encoded string to Uint8Array
        const derivedKeyBytes = TextTransformations.base64ToBuffer(prfDerivedKey);

        // Encrypt the PRF-derived key
        const encryptedData = await useSymmetricEncrypt({
          key: encryptionKey,
          data: derivedKeyBytes,
        });

        // Create or update encryption data
        const encryptionData = {
          ...currentSession!.encryptionData,
          encryptedPRFDerivedKey: TextTransformations.fromBufferToBase64(encryptedData),
          lastAccessedAt: getTimeNow(),
          ipAddress: currentSession!.ipAddress,
          userAgent: currentSession!.deviceInfo.userAgent,
          prfCredentialId: credentialId,
        } as ITokensEncryptionData & { encryptedPRFDerivedKey: string };

        // Update session with encryption data
        const updatedSession: ITokensSessionData = {
          ...currentSession!,
          encryptionData,
        };

        await cache.set(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
          updatedSession,
          { ttl },
        );

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Retrieves a PRF-derived key from the session cache
   *
   * @param accessToken - The JWT access token
   * @returns Promise resolving to the PRF-derived key (base64-encoded) or null
   */
  static async fetchPRFDerivedKeyFromSession(
    accessToken: string,
    sessionKey?: string,
  ): Promise<string | null> {
    // PRF keys in session are encrypted using the same session-key mechanism as password keys
    // If no session key provided, we cannot decrypt
    if (!sessionKey) {
      return null;
    }

    return await traced("PasskeyPRFService.fetchPRFDerivedKeyFromSession", "service", async (span) => {
      try {
        const cache = await getCache();
        const tokenHash = tokenHashString(accessToken);
        span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";
        span.attributes["has_session_key"] = true;

        const sessionData = await cache.get<ITokensSessionData>(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
        );

        if (!sessionData?.encryptionData) {
          span.attributes["no_encryption_data"] = true;
          return null;
        }

        const encryptionData = sessionData.encryptionData as ITokensEncryptionData & {
          encryptedPRFDerivedKey?: string;
        };

        if (!encryptionData.encryptedPRFDerivedKey) {
          span.attributes["no_prf_key"] = true;
          return null;
        }

        // Decrypt the PRF-derived key using sessionKey (client-bound)
        const encryptionKey = this.generateEncryptionKeyForPRFKeyStorage(tokenHash, sessionKey);
        const encryptedBytes = TextTransformations.base64ToBuffer(
          encryptionData.encryptedPRFDerivedKey,
        );

        const decryptedKey = await useSymmetricDecrypt({
          key: encryptionKey,
          data: encryptedBytes,
        });

        const result = TextTransformations.fromBufferToBase64(decryptedKey);
        span.attributes["success"] = true;
        return result;
      } catch (error) {
        span.attributes["error"] = true;
        useLogger(LoggerLevels.error, {
          message: "Failed to fetch PRF-derived key from session",
          messageKey: "encryption.fetch_prf_key.error",
          section: loggerAppSections.USER_ENCRYPTED,
          raw: error,
        });
        return null;
      }
    });
  }

  /**
   * Retrieves the credential ID associated with the cached PRF-derived key
   */
  static async fetchPRFCredentialIdFromSession(
    accessToken: string,
  ): Promise<string | null> {
    return await traced("PasskeyPRFService.fetchPRFCredentialIdFromSession", "service", async (span) => {
      try {
        const cache = await getCache();
        const tokenHash = tokenHashString(accessToken);
        span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

        const sessionData = await cache.get<ITokensSessionData>(
          CACHE_NAMESPACES.AUTH.JWT_SESSION,
          tokenHash,
        );

        if (!sessionData?.encryptionData) {
          span.attributes["no_encryption_data"] = true;
          return null;
        }

        const encryptionData = sessionData.encryptionData as ITokensEncryptionData & {
          prfCredentialId?: string;
        };

        return encryptionData.prfCredentialId ?? null;
      } catch (error) {
        useLogger(LoggerLevels.error, {
          message: "Failed to fetch PRF credential ID from session",
          messageKey: "encryption.fetch_prf_credential_id.error",
          section: loggerAppSections.USER_ENCRYPTED,
          raw: error,
        });
        return null;
      }
    });
  }

  /**
   * Generates a session-specific encryption key for storing PRF-derived keys
   * Uses a different context than password-derived key storage for isolation
   *
   * @param tokenHash - The hashed session token
   * @returns The session-specific encryption key as a Uint8Array
   */
  private static generateEncryptionKeyForPRFKeyStorage(
    tokenHash: string,
    sessionKey?: string,
  ): Uint8Array {
    // Use client-held sessionKey if provided (same pattern as password-derived key storage)
    // Falls back to tokenHash-only (less secure, server can decrypt) if no session key
    const keyMaterial = sessionKey ? `${sessionKey}:prf:${tokenHash}` : `prf:${tokenHash}`;
    return TextHashing.generateHashFromString(
      keyMaterial,
      HASHING_CONTEXTS.AUTH_SESSION_ENCRYPTION,
      32,
    );
  }
}
