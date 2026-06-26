/**
 * @file services/encryption/encryption-sharing.service.ts
 * @description Generic, table-agnostic encryption-aware sharing service for *DataKeys tables
 *
 * This service centralizes the encryption-specific sharing logic that handles
 * the two encryption modes:
 * - APP_CONTROLLED: Copy the encrypted master key directly (symmetric)
 * - USER_CONTROLLED: Re-encrypt via ECIES with the recipient's public key
 *
 * Generalized from services/documents/utils/encryption-sharing.service.ts.
 *
 * Usage:
 * ```typescript
 * const svc = new EncryptionSharingService(
 *   { tableName: tenantTables.documentsDataKeys, resourceIdColumn: "documentId" }
 * );
 * await svc.shareAppEncrypted(documentId, ownerId, recipientId, permissionLevel);
 * ```
 */

import { getTenantDB } from "@db/index.ts";
import { and, eq, inArray } from "@deps";
import { DB_ENUM_ENCRYPTION_MODE } from "@db/enums/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getEncryptionKeySharingService } from "@services/encryption/singletons.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";

/**
 * Generic Encryption-Aware Sharing Service
 *
 * Handles the cryptographic sharing operations for any *DataKeys table.
 * Automatically selects the correct sharing strategy based on encryption mode.
 */
export class EncryptionSharingService {
  private get dbPromise() {
    return getTenantDB();
  }
  private keySharingService = getEncryptionKeySharingService();
  private asymmetricKeysService = getUserAsymmetricKeysService();

  constructor(private readonly tableConfig: IEncryptionTableConfig) {}

  /**
   * Gets the encryption mode for a resource.
   */
  async getEncryptionMode(resourceId: string): Promise<string> {
    return await tracedWithServiceErrorHandling(
      "EncryptionSharingService.getEncryptionMode",
      {
        service: "EncryptionSharingService",
        method: "getEncryptionMode",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["resource_id"] = resourceId;

        const db = await this.dbPromise;
        const [dataKey] = await db
          .select({ encryptionMode: this.tableConfig.tableName.encryptionMode })
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (!dataKey) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        span.attributes["encryption_mode"] = dataKey.encryptionMode;
        return dataKey.encryptionMode;
      },
    );
  }

  /**
   * Shares an APP_CONTROLLED encrypted resource with a user.
   *
   * Copies the owner's encrypted master key to a new entry for the target user.
   * Both users share the same app-managed symmetric key.
   */
  async shareAppEncrypted(
    resourceId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "EncryptionSharingService.shareAppEncrypted",
      {
        service: "EncryptionSharingService",
        method: "shareAppEncrypted",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, fromUserId, toUserId, permissionLevel },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["resource_id"] = resourceId;
        span.attributes["from_user_id"] = fromUserId;
        span.attributes["to_user_id"] = toUserId;

        const db = await this.dbPromise;
        const [ownerKey] = await db
          .select()
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, fromUserId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (!ownerKey) {
          await useLogger(LoggerLevels.error, {
            message: "Owner data key not found for app-encrypted sharing",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.app_owner_key_not_found",
            details: { resourceId, fromUserId, toUserId },
          });
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (ownerKey.encryptionMode !== DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
          await useLogger(LoggerLevels.error, {
            message: "Expected APP_CONTROLLED encryption mode but found different mode",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.app_wrong_encryption_mode",
            details: {
              resourceId,
              fromUserId,
              actualMode: ownerKey.encryptionMode,
              expectedMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
            },
          });
          throwHttpError("COMMON.NOT_FOUND");
        }

        const [existingKey] = await db
          .select()
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, toUserId),
            ),
          )
          .limit(1);

        const now = Math.floor(getTimeNow() / 1000);

        if (existingKey) {
          await db
            .update(this.tableConfig.tableName)
            .set({
              isActive: true,
              permissionLevel,
              revokedAt: null,
              // Copy thumbnail key from owner — for APP_CONTROLLED, same app key wraps it
              thumbnailEncryptedMasterKey: ownerKey.thumbnailEncryptedMasterKey ?? null,
            })
            .where(eq(this.tableConfig.tableName.id, existingKey.id));

          span.attributes["action"] = "reactivated";
        } else {
          await databaseCreateWithRetry(
            async (generatedId) => {
              const [record] = await db
                .insert(this.tableConfig.tableName)
                .values({
                  id: generatedId,
                  [this.tableConfig.resourceIdColumn]: resourceId,
                  userId: toUserId,
                  encryptedMasterKey: ownerKey.encryptedMasterKey,
                  // Copy thumbnail key from owner — for APP_CONTROLLED, same app key wraps it
                  thumbnailEncryptedMasterKey: ownerKey.thumbnailEncryptedMasterKey ?? null,
                  encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
                  permissionLevel,
                  isActive: true,
                  keyVersion: ownerKey.keyVersion,
                  grantedAt: now,
                  grantedBy: fromUserId,
                })
                .returning();

              if (!record) throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              return record;
            },
            generateIdRandom,
          );

          span.attributes["action"] = "created";

          await useLogger(LoggerLevels.info, {
            message: "Shared app-encrypted resource successfully",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.app_success",
            details: { resourceId, fromUserId, toUserId, permissionLevel },
          });
        }
      },
    );
  }

  /**
   * Shares a USER_CONTROLLED encrypted resource via ECIES asymmetric encryption.
   *
   * Decrypts the owner's data master key with their user master key, then
   * re-encrypts it with the recipient's public key. The recipient decrypts
   * it with their private key.
   */
  async shareUserEncrypted(
    resourceId: string,
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
    ownerUserMasterKey: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "EncryptionSharingService.shareUserEncrypted",
      {
        service: "EncryptionSharingService",
        method: "shareUserEncrypted",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, fromUserId, toUserId, permissionLevel },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["resource_id"] = resourceId;
        span.attributes["from_user_id"] = fromUserId;
        span.attributes["to_user_id"] = toUserId;

        const dbOwner = await this.dbPromise;
        const [ownerKey] = await dbOwner
          .select()
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, fromUserId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .limit(1);

        if (!ownerKey) {
          await useLogger(LoggerLevels.error, {
            message: "Owner data key not found for user-encrypted sharing",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.owner_key_not_found",
            details: { resourceId, fromUserId, toUserId },
          });
          throwHttpError("COMMON.NOT_FOUND");
        }

        if (ownerKey.encryptionMode !== DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED) {
          await useLogger(LoggerLevels.error, {
            message: "Expected USER_CONTROLLED encryption mode but found different mode",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.wrong_encryption_mode",
            details: {
              resourceId,
              fromUserId,
              actualMode: ownerKey.encryptionMode,
              expectedMode: DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED,
            },
          });
          throwHttpError("COMMON.NOT_FOUND");
        }

        const recipientPublicKey = await this.asymmetricKeysService.getPublicKey(toUserId);

        if (!recipientPublicKey) {
          await useLogger(LoggerLevels.error, {
            message: "Recipient public key not found for user-encrypted sharing",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.recipient_key_not_found",
            details: { resourceId, fromUserId, toUserId },
          });
          throwHttpError("COMMON.NOT_FOUND");
        }

        // ECIES: decrypt master key with owner's key, re-encrypt with recipient's public key
        const eciesEncryptedKey = await this.keySharingService.shareDataMasterKeyAsymmetric(
          ownerKey.encryptedMasterKey as Uint8Array,
          ownerUserMasterKey,
          recipientPublicKey,
        );

        // ECIES: also re-encrypt thumbnail key if present
        let eciesEncryptedThumbnailKey: Uint8Array | null = null;
        const ownerThumbnailKey = ownerKey.thumbnailEncryptedMasterKey as Uint8Array | null | undefined;
        if (ownerThumbnailKey) {
          try {
            eciesEncryptedThumbnailKey = await this.keySharingService.shareDataMasterKeyAsymmetric(
              ownerThumbnailKey,
              ownerUserMasterKey,
              recipientPublicKey,
            );
            span.attributes["has_thumbnail_key"] = true;
          } catch (error) {
            // Thumbnail key sharing failed — non-fatal but log for debugging
            span.attributes["thumbnail_key_share_failed"] = true;
            await useLogger(LoggerLevels.warn, {
              message: "Failed to share thumbnail encryption key during user-encrypted sharing",
              section: loggerAppSections.ENCRYPTION,
              messageKey: "encryption_sharing_service.thumbnail_share_failed",
              details: {
                resourceId,
                fromUserId,
                toUserId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        } else {
          // No thumbnail key on owner's record - this is expected if document has no thumbnail
          span.attributes["has_thumbnail_key"] = false;
        }

        const dbSharing = await this.dbPromise;
        const [existingKey] = await dbSharing
          .select()
          .from(this.tableConfig.tableName)
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, toUserId),
            ),
          )
          .limit(1);

        const now = Math.floor(getTimeNow() / 1000);

        if (existingKey) {
          await dbSharing
            .update(this.tableConfig.tableName)
            .set({
              encryptedMasterKey: eciesEncryptedKey,
              thumbnailEncryptedMasterKey: eciesEncryptedThumbnailKey,
              encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
              isActive: true,
              permissionLevel,
              revokedAt: null,
            })
            .where(eq(this.tableConfig.tableName.id, existingKey.id));

          span.attributes["action"] = "updated";
        } else {
          await databaseCreateWithRetry(
            async (generatedId) => {
              const [record] = await dbSharing
                .insert(this.tableConfig.tableName)
                .values({
                  id: generatedId,
                  [this.tableConfig.resourceIdColumn]: resourceId,
                  userId: toUserId,
                  encryptedMasterKey: eciesEncryptedKey,
                  thumbnailEncryptedMasterKey: eciesEncryptedThumbnailKey,
                  encryptionMode: DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC,
                  permissionLevel,
                  isActive: true,
                  keyVersion: ownerKey.keyVersion,
                  grantedAt: now,
                  grantedBy: fromUserId,
                })
                .returning();

              if (!record) throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              return record;
            },
            generateIdRandom,
          );

          span.attributes["action"] = "created";

          await useLogger(LoggerLevels.info, {
            message: "Shared user-encrypted resource successfully",
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption_sharing_service.user_success",
            details: { resourceId, fromUserId, toUserId, permissionLevel },
          });
        }
      },
    );
  }

  /**
   * Batch shares multiple resources with a user.
   * Handles mixed encryption modes (APP_CONTROLLED and USER_CONTROLLED).
   * Processes in batches of 100 to avoid overloading the DB.
   */
  async batchShare(
    resourceIds: string[],
    fromUserId: string,
    toUserId: string,
    permissionLevel: string | number,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<unknown[]> {
    return await tracedWithServiceErrorHandling(
      "EncryptionSharingService.batchShare",
      {
        service: "EncryptionSharingService",
        method: "batchShare",
        section: loggerAppSections.ENCRYPTION,
        details: { fromUserId, toUserId, resourceCount: resourceIds.length, permissionLevel },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const results: Array<{ success: boolean; [key: string]: unknown }> = [];
        const BATCH_SIZE = 100;

        span.attributes["total_resources"] = resourceIds.length;
        span.attributes["from_user_id"] = fromUserId;
        span.attributes["to_user_id"] = toUserId;

        const db = await this.dbPromise;
        for (let i = 0; i < resourceIds.length; i += BATCH_SIZE) {
          const batch = resourceIds.slice(i, i + BATCH_SIZE);

          // Get encryption modes only for the current batch (not all user resources)
          const documentModes = await db
            .select({
              resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
              encryptionMode: this.tableConfig.tableName.encryptionMode,
            })
            .from(this.tableConfig.tableName)
            .where(
              and(
                eq(this.tableConfig.tableName.userId, fromUserId),
                eq(this.tableConfig.tableName.isActive, true),
                inArray(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], batch),
              ),
            );

          const modeMap = new Map(
            documentModes.map((dm) => [dm.resourceId as string, dm.encryptionMode]),
          );

          for (const resourceId of batch) {
            try {
              const encryptionMode = modeMap.get(resourceId);

              if (encryptionMode === undefined) {
                results.push({
                  documentId: resourceId,
                  originalEncryptionMode: "unknown",
                  success: false,
                  action: "error",
                  error: "Resource not found or owner has no access",
                });
                continue;
              }

              if (encryptionMode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED) {
                await this.shareAppEncrypted(resourceId, fromUserId, toUserId, permissionLevel);
                results.push({
                  documentId: resourceId,
                  originalEncryptionMode: encryptionMode,
                  success: true,
                  action: "added_to_acl",
                });
              } else if (encryptionMode === DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED) {
                if (!ownerUserMasterKey) {
                  await useLogger(LoggerLevels.warn, {
                    message: "Skipping USER_CONTROLLED resource sharing: no owner master key available",
                    section: loggerAppSections.ENCRYPTION,
                    messageKey: "encryption_sharing_service.skip_no_key",
                    details: {
                      resourceId,
                      fromUserId,
                      toUserId,
                      encryptionMode,
                      reason: "The sharing user does not own this resource or does not have enhanced encryption enabled",
                    },
                  });
                  results.push({
                    documentId: resourceId,
                    originalEncryptionMode: encryptionMode,
                    success: false,
                    action: "error",
                    error: "Owner user master key required for user-encrypted resources",
                  });
                  continue;
                }

                await this.shareUserEncrypted(
                  resourceId,
                  fromUserId,
                  toUserId,
                  permissionLevel,
                  ownerUserMasterKey,
                );
                results.push({
                  documentId: resourceId,
                  originalEncryptionMode: encryptionMode,
                  success: true,
                  action: "asymmetric_shared",
                });
              } else {
                results.push({
                  documentId: resourceId,
                  originalEncryptionMode: encryptionMode,
                  success: false,
                  action: "skipped",
                  error: `Unsupported encryption mode: ${encryptionMode}`,
                });
              }
            } catch (error) {
              await useLogger(LoggerLevels.error, {
                message: "Error sharing resource in batch",
                section: loggerAppSections.ENCRYPTION,
                messageKey: "encryption_sharing_service.batch_resource_error",
                details: { resourceId, fromUserId, toUserId, error },
              });

              results.push({
                documentId: resourceId,
                originalEncryptionMode: modeMap.get(resourceId) ?? "unknown",
                success: false,
                action: "error",
                error: error instanceof Error ? error.message : "Unknown error",
              });
            }
          }
        }

        const successCount = results.filter((r) => r.success).length;
        span.attributes["successful"] = successCount;
        span.attributes["failed"] = results.length - successCount;

        await useLogger(LoggerLevels.info, {
          message: "Batch resource sharing completed",
          section: loggerAppSections.ENCRYPTION,
          messageKey: "encryption_sharing_service.batch_complete",
          details: {
            totalResources: resourceIds.length,
            successful: successCount,
            failed: results.length - successCount,
          },
        });

        return results;
      },
    );
  }
}
