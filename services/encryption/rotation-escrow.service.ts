/**
 * @file services/encryption/rotation-escrow.service.ts
 * @description DB-backed escrow service for master key rotation deferred re-wrap
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import type { TenantDB } from "@db/index.ts";
import { eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@services/logger/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "./encryption.helper.ts";
import { HASHING_CONTEXTS, TextHashing, TextTransformations } from "@utils/text/index.ts";
import { envConfig } from "@config/env.ts";
import { randomBytes } from "@deps";
import { z } from "@deps";
import type { Span } from "@interfaces/tracing.ts";

/**
 * The drizzle transaction object passed to a `TenantDB.transaction` callback.
 * Derived from the actual method signature so it tracks the tenant schema.
 */
type TenantTransaction =
  // [0] of transaction() is the callback; [0] of that callback is the tx
  Parameters<NonNullable<Parameters<TenantDB["transaction"]>[0]>>[0];

/** Escrow TTL in seconds (7 days) */
const ESCROW_TTL_SECONDS = 7 * 24 * 60 * 60;

/** Zod schema for validating pendingCredentialIds from DB */
const PendingCredentialIdsSchema = z.array(z.string().min(1).max(256));

export type PendingCredentialIds = z.infer<typeof PendingCredentialIdsSchema>;

interface IEscrowData {
  encryptedNewMasterKey: Uint8Array;
  keyDerivationNonce: string;
  pendingCredentialIds: PendingCredentialIds;
  masterKeyVersion: number;
  expiresAt: number;
}

/**
 * RotationEscrowService
 *
 * Handles DB operations for the master key rotation escrow.
 * The escrow is a temporary, server-encrypted copy of the new master key
 * that allows deferred re-wrapping of passkey PRF keys on next login.
 */
export class RotationEscrowService {
  /**
   * Derives the escrow encryption key using domain-separated Blake3 context
   * This mirrors the structure of generateEncryptionKeyForPasswordDerivedKeyStorage
   * but uses a dedicated context for rotation escrow
   */
  private static deriveEscrowKey(nonce: string, userId: string): Uint8Array {
    return TextHashing.generateHashFromString(
      `${
        Array.from(
          TextHashing.generateHashFromKeyForCacheEncryption(
            envConfig.auth.generalEncryptionKey!,
          ),
        ).map((b) => b.toString(16).padStart(2, "0")).join("")
      }:${userId}:${nonce}`,
      HASHING_CONTEXTS.MASTER_KEY_ROTATION_ESCROW,
      32,
    );
  }

  /**
   * Creates or updates an escrow entry for a user
   * Must be called within a transaction
   *
   * @param userId - The user ID
   * @param newMasterKey - The new master key to encrypt
   * @param pendingCredentialIds - Credential IDs that still need re-wrap
   * @param masterKeyVersion - The master key version this escrow is for
   * @param tx - Database transaction
   */
  static async createEscrow(
    userId: string,
    newMasterKey: Uint8Array,
    pendingCredentialIds: string[],
    masterKeyVersion: number,
    tx: TenantTransaction,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "RotationEscrowService.createEscrow",
      {
        service: "RotationEscrowService",
        method: "createEscrow",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["user_id"] = userId;
        span.attributes["pending_count"] = pendingCredentialIds.length;
        span.attributes["master_key_version"] = masterKeyVersion;

        // Generate random nonce for key derivation
        const nonceBytes = randomBytes(32);
        const keyDerivationNonce = TextTransformations.fromBufferToBase64(nonceBytes);

        // Derive escrow encryption key
        const escrowKey = this.deriveEscrowKey(keyDerivationNonce, userId);

        // Encrypt the new master key
        const encryptedNewMasterKey = await useSymmetricEncrypt({
          key: escrowKey,
          data: newMasterKey,
        });

        const now = Math.floor(Date.now() / 1000);
        const expiresAt = now + ESCROW_TTL_SECONDS;

        // Upsert the escrow row
        await tx
          .insert(tenantTables.masterKeyRotationEscrow)
          .values({
            userId,
            encryptedNewMasterKey,
            keyDerivationNonce,
            pendingCredentialIds,
            masterKeyVersion,
            expiresAt,
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: tenantTables.masterKeyRotationEscrow.userId,
            set: {
              encryptedNewMasterKey,
              keyDerivationNonce,
              pendingCredentialIds,
              masterKeyVersion,
              expiresAt,
              updatedAt: now,
            },
          });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Gets the escrow for a user
   * Returns null if escrow doesn't exist or has expired
   * Validates pendingCredentialIds with Zod on read
   *
   * @param userId - The user ID
   * @returns The escrow data with decrypted master key, or null if not found/expired
   */
  static async getEscrow(userId: string): Promise<
    {
      newMasterKey: Uint8Array;
      pendingCredentialIds: PendingCredentialIds;
      masterKeyVersion: number;
    } | null
  > {
    return await tracedWithServiceErrorHandling(
      "RotationEscrowService.getEscrow",
      {
        service: "RotationEscrowService",
        method: "getEscrow",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        const now = Math.floor(Date.now() / 1000);

        const rows = await db
          .select()
          .from(tenantTables.masterKeyRotationEscrow)
          .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId))
          .limit(1);

        if (rows.length === 0) {
          span.attributes["not_found"] = true;
          return null;
        }

        const row = rows[0];

        // Check expiry
        if (row.expiresAt < now) {
          span.attributes["expired"] = true;
          // Delete expired escrow
          await db
            .delete(tenantTables.masterKeyRotationEscrow)
            .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));
          return null;
        }

        // Validate pendingCredentialIds with Zod
        let pendingCredentialIds: PendingCredentialIds;
        try {
          pendingCredentialIds = PendingCredentialIdsSchema.parse(row.pendingCredentialIds);
        } catch {
          span.attributes["invalid_pending_ids"] = true;
          // Delete escrow with invalid data
          await db
            .delete(tenantTables.masterKeyRotationEscrow)
            .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));
          return null;
        }

        // Derive escrow key and decrypt
        const escrowKey = this.deriveEscrowKey(row.keyDerivationNonce, userId);

        // Decrypt the new master key
        let newMasterKey: Uint8Array;
        try {
          newMasterKey = await useSymmetricDecrypt({
            key: escrowKey,
            data: row.encryptedNewMasterKey,
          });
        } catch (_error) {
          span.attributes["decryption_failed"] = true;
          // Delete escrow with undecryptable data
          await db
            .delete(tenantTables.masterKeyRotationEscrow)
            .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));
          return null;
        }

        span.attributes["success"] = true;
        span.attributes["pending_count"] = pendingCredentialIds.length;

        return {
          newMasterKey,
          pendingCredentialIds,
          masterKeyVersion: row.masterKeyVersion,
        };
      },
    );
  }

  /**
   * Removes a credential from the escrow's pending list
   * Deletes the escrow if no credentials remain pending
   *
   * @param userId - The user ID
   * @param credentialId - The credential ID to remove from pending list
   */
  static async removeCredentialFromEscrow(
    userId: string,
    credentialId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "RotationEscrowService.removeCredentialFromEscrow",
      {
        service: "RotationEscrowService",
        method: "removeCredentialFromEscrow",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["user_id"] = userId;
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";

        const db = await getTenantDB();

        await db.transaction(async (tx) => {
          // Get current escrow
          const rows = await tx
            .select({
              pendingCredentialIds: tenantTables.masterKeyRotationEscrow.pendingCredentialIds,
            })
            .from(tenantTables.masterKeyRotationEscrow)
            .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId))
            .limit(1);

          if (rows.length === 0) {
            span.attributes["not_found"] = true;
            return;
          }

          const row = rows[0];
          const pendingList = row.pendingCredentialIds as string[];

          // Remove credential from list
          const updatedList = pendingList.filter((id) => id !== credentialId);

          if (updatedList.length === 0) {
            // No more pending credentials - delete the escrow
            await tx
              .delete(tenantTables.masterKeyRotationEscrow)
              .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));
            span.attributes["escrow_deleted"] = true;
          } else {
            // Update pending list
            await tx
              .update(tenantTables.masterKeyRotationEscrow)
              .set({
                pendingCredentialIds: updatedList,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));
            span.attributes["list_updated"] = true;
          }
        });

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Deletes the escrow for a user
   *
   * @param userId - The user ID
   */
  static async deleteEscrow(userId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "RotationEscrowService.deleteEscrow",
      {
        service: "RotationEscrowService",
        method: "deleteEscrow",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        span.attributes["user_id"] = userId;

        const db = await getTenantDB();
        await db
          .delete(tenantTables.masterKeyRotationEscrow)
          .where(eq(tenantTables.masterKeyRotationEscrow.userId, userId));

        span.attributes["success"] = true;
      },
    );
  }
}
