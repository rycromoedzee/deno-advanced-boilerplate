/**
 * @file services/user/asymmetric-keys.service.ts
 * @description Service for managing user asymmetric key pairs
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { eq, inArray } from "@deps";
import { decryptPrivateKey, encryptPrivateKey, generateECIESKeyPair } from "@services/encryption/index.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { Span } from "@interfaces/tracing.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";

/**
 * Result type for getUserKeyPair method
 */
export interface IUserKeyPair {
  publicKey: string;
  encryptedPrivateKey: Uint8Array;
}

/**
 * Result type for getDecryptedKeyPair method
 */
export interface IDecryptedKeyPair {
  publicKey: string;
  privateKey: string;
}

/**
 * Service for managing user asymmetric key pairs
 */
export class AsymmetricKeysService {
  /**
   * Generates and stores ECIES key pair for a user
   * @param userId - The user ID
   * @param userMasterKey - The user's master key for encrypting the private key
   */
  async generateAndStoreKeyPairWithMasterKey(
    userId: string,
    userMasterKey: Uint8Array,
    environmentId?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "AsymmetricKeysService.generateAndStoreKeyPairWithMasterKey",
      {
        service: "AsymmetricKeysService",
        method: "generateAndStoreKeyPairWithMasterKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: {
          userId,
          // DO NOT log: userMasterKey, privateKey, publicKey
        },
      },
      "ENCRYPTION.KEY_GENERATION_FAILED",
      async (_span: Span) => {
        const db = await getTenantDB(environmentId);

        // Generate new ECIES key pair (X25519)
        const { publicKey, privateKey } = generateECIESKeyPair();

        // Encrypt the private key with user's master key
        const encryptedPrivateKey = await encryptPrivateKey(
          privateKey,
          userMasterKey,
        );

        // Store both keys in the database (encryptedPrivateKey is stored as blob)
        const existing = await db.select().from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId));

        if (existing.length > 0) {
          await db.update(tenantTables.userEncryption)
            .set({
              publicKey,
              encryptedPrivateKey: encryptedPrivateKey,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(tenantTables.userEncryption.userId, userId));
        } else {
          await db.insert(tenantTables.userEncryption)
            .values({
              userId,
              publicKey,
              encryptedPrivateKey: encryptedPrivateKey,
              updatedAt: Math.floor(Date.now() / 1000),
              createdAt: Math.floor(Date.now() / 1000),
            });
        }
      },
    );
  }

  /**
   * Gets a user's decrypted private key
   * @param userId - The user ID
   * @param userMasterKey - The user's master key for decryption
   * @returns The private key as hex string or null if not found
   */
  async getPrivateKey(
    userId: string,
    userMasterKey: Uint8Array,
  ): Promise<string | null> {
    try {
      const db = await getTenantDB();

      const result = await db.select({
        encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length === 0 || !result[0].encryptedPrivateKey) {
        return null;
      }

      // encryptedPrivateKey is now stored as blob (Uint8Array)
      return await decryptPrivateKey(
        result[0].encryptedPrivateKey,
        userMasterKey,
      );
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to get user decrypted private key",
        section: loggerAppSections.USER_ENCRYPTED,
        messageKey: "asymmetric_keys.get_private_key_failed",
        details: { userId, error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  /**
   * Ensures the user has an asymmetric key pair using a master key fetched from session
   * @param userId - The user ID
   * @param accessToken - The access token for session-based master key retrieval
   * @param audience - Optional JWT audience for session validation
   * @param tokenType - Optional JWT token type for session validation
   */
  async ensureKeyPairFromSession(
    userId: string,
    accessToken: string,
    audience: string = JWT_TOKEN_CONFIG.audiences.auth,
    tokenType: JWT_TOKEN_TYPES = JWT_TOKEN_TYPES.AUTH,
    sessionKey?: string,
    environmentId?: string,
  ): Promise<void> {
    const db = await getTenantDB(environmentId);

    const result = await db.select({
      publicKey: tenantTables.userEncryption.publicKey,
      encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
    })
      .from(tenantTables.userEncryption)
      .where(eq(tenantTables.userEncryption.userId, userId))
      .limit(1);

    if (
      result.length > 0 &&
      result[0].publicKey !== null &&
      result[0].encryptedPrivateKey !== null
    ) {
      return;
    }

    let userMasterKey: Uint8Array | null = null;
    try {
      userMasterKey = await EncryptionSystemUserService
        .getUserMasterKeyForDataEncryptionWithPRF(
          userId,
          accessToken,
          audience,
          tokenType,
          sessionKey,
          environmentId,
        );

      await this.generateAndStoreKeyPairWithMasterKey(userId, userMasterKey, environmentId);
    } catch (error) {
      // Non-fatal: log and skip if master key is unavailable
      useLogger(LoggerLevels.info, {
        message: "Skipping asymmetric key pair generation (master key unavailable)",
        messageKey: "asymmetric_keys.ensure_from_session.key_not_found",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
        raw: error,
      });
    } finally {
      if (userMasterKey) {
        userMasterKey.fill(0);
      }
    }
  }

  // ============================================================================
  // NEW METHODS: Key Fetching Operations
  // ============================================================================

  /**
   * Gets a user's public key
   * @param userId - The user ID
   * @returns The public key as hex string or null if not found
   */
  async getPublicKey(userId: string): Promise<string | null> {
    try {
      const db = await getTenantDB();

      const result = await db.select({
        publicKey: tenantTables.userEncryption.publicKey,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length === 0 || !result[0].publicKey) {
        return null;
      }

      return result[0].publicKey;
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to get user public key",
        section: loggerAppSections.USER_ENCRYPTED,
        messageKey: "asymmetric_keys.get_public_key_failed",
        details: { userId, error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  /**
   * Gets a user's encrypted private key (raw, not decrypted)
   * @param userId - The user ID
   * @returns The encrypted private key as Uint8Array or null if not found
   */
  async getEncryptedPrivateKey(userId: string): Promise<Uint8Array | null> {
    try {
      const db = await getTenantDB();

      const result = await db.select({
        encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length === 0 || !result[0].encryptedPrivateKey) {
        return null;
      }

      return result[0].encryptedPrivateKey;
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to get user encrypted private key",
        section: loggerAppSections.USER_ENCRYPTED,
        messageKey: "asymmetric_keys.get_encrypted_private_key_failed",
        details: { userId, error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  /**
   * Gets both public key and encrypted private key in one query
   * @param userId - The user ID
   * @returns Object with publicKey and encryptedPrivateKey, or null if not found
   */
  async getUserKeyPair(userId: string): Promise<IUserKeyPair | null> {
    try {
      const db = await getTenantDB();

      const result = await db.select({
        publicKey: tenantTables.userEncryption.publicKey,
        encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length === 0) {
        return null;
      }

      const { publicKey, encryptedPrivateKey } = result[0];

      // Return null if either key is missing
      if (!publicKey || !encryptedPrivateKey) {
        return null;
      }

      return {
        publicKey,
        encryptedPrivateKey,
      };
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to get user key pair",
        section: loggerAppSections.USER_ENCRYPTED,
        messageKey: "asymmetric_keys.get_user_key_pair_failed",
        details: { userId, error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  /**
   * Checks if a user has an asymmetric key pair initialized
   * @param userId - The user ID
   * @returns true if both public and private keys exist
   */
  async hasKeyPair(userId: string): Promise<boolean> {
    try {
      const db = await getTenantDB();

      const result = await db.select({
        publicKey: tenantTables.userEncryption.publicKey,
        encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (result.length === 0) {
        return false;
      }

      const { publicKey, encryptedPrivateKey } = result[0];
      return publicKey !== null && encryptedPrivateKey !== null;
    } catch (_error) {
      return false;
    }
  }

  /**
   * Gets decrypted private key along with public key
   * Useful for operations that need both keys
   * @param userId - The user ID
   * @param userMasterKey - The user's master key for decryption
   * @returns Object with decrypted privateKey and publicKey, or null if not found
   */
  async getDecryptedKeyPair(
    userId: string,
    userMasterKey: Uint8Array,
  ): Promise<IDecryptedKeyPair | null> {
    try {
      const keyPair = await this.getUserKeyPair(userId);

      if (!keyPair) {
        return null;
      }

      // Decrypt the private key
      const privateKey = await decryptPrivateKey(
        keyPair.encryptedPrivateKey,
        userMasterKey,
      );

      return {
        publicKey: keyPair.publicKey,
        privateKey,
      };
    } catch (_error) {
      useLogger(LoggerLevels.warn, {
        message: "Failed to get decrypted user key pair",
        section: loggerAppSections.USER_ENCRYPTED,
        messageKey: "asymmetric_keys.get_decrypted_key_pair_failed",
        details: { userId, error: _error instanceof Error ? _error.message : String(_error) },
      });
      return null;
    }
  }

  /**
   * Batch checks if multiple users have key pairs initialized
   * Optimized for checking multiple recipients at once
   * @param userIds - Array of user IDs to check
   * @returns Map of userId -> hasKeyPair (true if both keys exist)
   */
  async batchHasKeyPair(userIds: string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();

    if (userIds.length === 0) {
      return result;
    }

    try {
      const db = await getTenantDB();

      // Initialize all to false
      for (const userId of userIds) {
        result.set(userId, false);
      }

      // Single batch query
      const users = await db.select({
        userId: tenantTables.userEncryption.userId,
        publicKey: tenantTables.userEncryption.publicKey,
        encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey,
      })
        .from(tenantTables.userEncryption)
        .where(inArray(tenantTables.userEncryption.userId, userIds));

      // Update results for users that have both keys
      for (const user of users) {
        if (user.publicKey !== null && user.encryptedPrivateKey !== null) {
          result.set(user.userId, true);
        }
      }

      return result;
    } catch (_error) {
      // Return map with all false on error
      return result;
    }
  }

  /**
   * Batch gets public keys for multiple users
   * @param userIds - Array of user IDs to fetch public keys for
   * @returns Map of userId -> publicKey (null if not found or user doesn't have a key)
   */
  async batchGetPublicKeys(userIds: string[]): Promise<Map<string, string | null>> {
    const result = new Map<string, string | null>();

    if (userIds.length === 0) {
      return result;
    }

    try {
      const db = await getTenantDB();

      // Initialize all to null
      for (const userId of userIds) {
        result.set(userId, null);
      }

      // Single batch query
      const users = await db.select({
        userId: tenantTables.userEncryption.userId,
        publicKey: tenantTables.userEncryption.publicKey,
      })
        .from(tenantTables.userEncryption)
        .where(inArray(tenantTables.userEncryption.userId, userIds));

      // Update results
      for (const user of users) {
        result.set(user.userId, user.publicKey);
      }

      return result;
    } catch (_error) {
      // Return map with all null on error
      return result;
    }
  }
}
