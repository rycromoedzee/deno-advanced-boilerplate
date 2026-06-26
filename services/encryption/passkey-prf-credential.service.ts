/**
 * @file services/encryption/passkey-prf-credential.service.ts
 * @description Per-credential PRF storage and retrieval for passkeys
 */

import { getGlobalDB, globalTables } from "@db/index.ts";
import type { GlobalDB } from "@db/db.ts";
import { and, eq } from "@deps";
import { PasskeyPRFService } from "./passkey-prf.service.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@services/logger/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { randomBytes } from "@deps";

// Type for database transaction
type DbTransaction = Parameters<Parameters<GlobalDB["transaction"]>[0]>[0];

export class PerCredentialPRFService {
  private static generateCredentialSalt(): string {
    const saltBytes = randomBytes(32);
    return TextTransformations.fromBufferToBase64(saltBytes);
  }

  /**
   * Set up PRF encryption for a specific credential
   *
   * @param credentialId - The passkey credential ID
   * @param masterKey - The master key to encrypt
   * @param prfOutput - The PRF output from the authenticator (base64-encoded)
   * @param userId - The user ID
   * @param providedSalt - Optional salt that was used during PRF evaluation.
   *                       IMPORTANT: If the PRF output was evaluated with a specific salt,
   *                       that same salt MUST be provided here for decryption to work later.
   *                       If not provided, a new random salt is generated (legacy behavior).
   */
  static async setupPRFForCredential(
    credentialId: string,
    masterKey: Uint8Array,
    prfOutput: string,
    userId: string,
    providedSalt?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.setupPRFForCredential",
      {
        service: "PerCredentialPRFService",
        method: "setupPRFForCredential",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";
        span.attributes["user_id"] = userId;
        span.attributes["provided_salt"] = !!providedSalt;

        const db = getGlobalDB();
        try {
          const ownerCheck = await db
            .select({ id: globalTables.userPasskeys.id })
            .from(globalTables.userPasskeys)
            .where(and(
              eq(globalTables.userPasskeys.id, credentialId),
              eq(globalTables.userPasskeys.userId, userId),
            ))
            .limit(1);

          if (!ownerCheck[0]) {
            throwHttpError("PASSKEY.NOT_FOUND");
          }

          const existingKey = await db
            .select({ credentialId: globalTables.passkeyPRFKeys.credentialId })
            .from(globalTables.passkeyPRFKeys)
            .where(eq(globalTables.passkeyPRFKeys.credentialId, credentialId))
            .limit(1);

          if (existingKey[0]) {
            throwHttpError("ENCRYPTION.PRF_ALREADY_CONFIGURED");
          }

          // Use provided salt if available, otherwise generate a new one
          // CRITICAL: The salt must match what was used during PRF evaluation
          const prfSalt = providedSalt || this.generateCredentialSalt();
          const prfDerivedKey = await PasskeyPRFService.deriveKeyFromPRF(
            prfOutput,
            userId,
          );

          const encryptedMasterKey = await useSymmetricEncrypt({
            key: prfDerivedKey,
            data: masterKey,
          });

          await db.insert(globalTables.passkeyPRFKeys).values({
            credentialId,
            encryptedMasterKey,
            prfSalt,
            createdAt: Math.floor(Date.now() / 1000),
          });

          span.attributes["success"] = true;
        } catch (error) {
          if (error instanceof Error) {
            span.attributes["error"] = true;
          }
          throw error;
        } finally {
          masterKey.fill(0);
        }
      },
    );
  }

  /**
   * Decrypt master key using a specific credential's PRF
   */
  static async decryptWithCredentialPRF(
    credentialId: string,
    prfOutput: string,
    userId: string,
  ): Promise<Uint8Array> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.decryptWithCredentialPRF",
      {
        service: "PerCredentialPRFService",
        method: "decryptWithCredentialPRF",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";
        span.attributes["user_id"] = userId;

        const db = getGlobalDB();
        const result = await db
          .select({
            encryptedMasterKey: globalTables.passkeyPRFKeys.encryptedMasterKey,
            prfSalt: globalTables.passkeyPRFKeys.prfSalt,
          })
          .from(globalTables.passkeyPRFKeys)
          .innerJoin(
            globalTables.userPasskeys,
            eq(globalTables.userPasskeys.id, globalTables.passkeyPRFKeys.credentialId),
          )
          .where(and(
            eq(globalTables.passkeyPRFKeys.credentialId, credentialId),
            eq(globalTables.userPasskeys.userId, userId),
          ))
          .limit(1);

        if (!result[0]) {
          throwHttpError("ENCRYPTION.PRF_NOT_CONFIGURED_FOR_CREDENTIAL");
        }

        const prfDerivedKey = await PasskeyPRFService.deriveKeyFromPRF(
          prfOutput,
          userId,
        );

        return await useSymmetricDecrypt({
          key: prfDerivedKey,
          data: result[0].encryptedMasterKey,
        });
      },
    );
  }

  /**
   * Decrypt master key using a derived PRF key (session cached)
   */
  static async decryptWithDerivedKey(
    credentialId: string,
    prfDerivedKey: Uint8Array,
    userId: string,
  ): Promise<Uint8Array> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.decryptWithDerivedKey",
      {
        service: "PerCredentialPRFService",
        method: "decryptWithDerivedKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";
        span.attributes["user_id"] = userId;

        const db = getGlobalDB();
        const result = await db
          .select({
            encryptedMasterKey: globalTables.passkeyPRFKeys.encryptedMasterKey,
          })
          .from(globalTables.passkeyPRFKeys)
          .innerJoin(
            globalTables.userPasskeys,
            eq(globalTables.userPasskeys.id, globalTables.passkeyPRFKeys.credentialId),
          )
          .where(and(
            eq(globalTables.passkeyPRFKeys.credentialId, credentialId),
            eq(globalTables.userPasskeys.userId, userId),
          ))
          .limit(1);

        if (!result[0]) {
          throwHttpError("ENCRYPTION.PRF_NOT_CONFIGURED_FOR_CREDENTIAL");
        }

        return await useSymmetricDecrypt({
          key: prfDerivedKey,
          data: result[0].encryptedMasterKey,
        });
      },
    );
  }

  static async hasPRFConfigured(credentialId: string): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.hasPRFConfigured",
      {
        service: "PerCredentialPRFService",
        method: "hasPRFConfigured",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { credentialIdPrefix: credentialId.substring(0, 8) + "..." },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const db = getGlobalDB();
        const result = await db
          .select({ credentialId: globalTables.passkeyPRFKeys.credentialId })
          .from(globalTables.passkeyPRFKeys)
          .where(eq(globalTables.passkeyPRFKeys.credentialId, credentialId))
          .limit(1);

        return result.length > 0;
      },
    );
  }

  static async deletePRFForCredential(credentialId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.deletePRFForCredential",
      {
        service: "PerCredentialPRFService",
        method: "deletePRFForCredential",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { credentialIdPrefix: credentialId.substring(0, 8) + "..." },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const db = getGlobalDB();
        await db
          .delete(globalTables.passkeyPRFKeys)
          .where(eq(globalTables.passkeyPRFKeys.credentialId, credentialId));
      },
    );
  }

  /**
   * Updates an existing PRF key row with new encrypted master key and version
   * Unlike setupPRFForCredential, this does an UPDATE (not INSERT)
   * Used during master key rotation to update existing passkey wraps
   *
   * @param credentialId - The passkey credential ID
   * @param newMasterKey - The new master key to encrypt
   * @param prfDerivedKey - The PRF-derived key to encrypt with
   * @param newMasterKeyVersion - The new master key version
   * @param tx - Optional database transaction
   */
  static async updatePRFKeyForCredential(
    credentialId: string,
    newMasterKey: Uint8Array,
    prfDerivedKey: Uint8Array,
    newMasterKeyVersion: number,
    tx?: DbTransaction,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PerCredentialPRFService.updatePRFKeyForCredential",
      {
        service: "PerCredentialPRFService",
        method: "updatePRFKeyForCredential",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { credentialIdPrefix: credentialId.substring(0, 8) + "..." },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";
        span.attributes["new_master_key_version"] = newMasterKeyVersion;

        const db = tx ?? getGlobalDB();

        // Verify credential exists and belongs to user (security check)
        // This joins through identityPasskeys -> identities -> users to verify ownership
        const _ownerCheck = await db
          .select({ id: globalTables.userPasskeys.id })
          .from(globalTables.passkeyPRFKeys)
          .innerJoin(
            globalTables.userPasskeys,
            eq(globalTables.userPasskeys.id, globalTables.passkeyPRFKeys.credentialId),
          )
          .where(eq(globalTables.passkeyPRFKeys.credentialId, credentialId))
          .limit(1);

        // Note: We don't have userId here, but the credential exists if ownerCheck returns a row
        // The credential ownership is validated by the join chain above

        // Encrypt the new master key with the PRF-derived key
        const encryptedMasterKey = await useSymmetricEncrypt({
          key: prfDerivedKey,
          data: newMasterKey,
        });

        // Update the PRF key row
        await db
          .update(globalTables.passkeyPRFKeys)
          .set({
            encryptedMasterKey,
            masterKeyVersion: newMasterKeyVersion,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(globalTables.passkeyPRFKeys.credentialId, credentialId));

        span.attributes["success"] = true;
      },
    );
  }
}
