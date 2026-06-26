/**
 * @file services/documents-sharing/document-sharing.service.ts
 * @description Service for internal document sharing operations
 *
 * This service handles sharing documents with internal users only.
 * It manages encryption keys, permissions, and access control for documents.
 * For public sharing functionality, use DocumentSharingPublicService.
 */

import { eq } from "@deps";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { DocumentEncryptionSharingService } from "@services/documents-encryption/encryption-sharing.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { SharingService } from "@services/encryption/sharing.service.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

const DOC_TABLE_CONFIG = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
} as const;

/**
 * Document Internal Sharing Service
 *
 * Handles internal document sharing operations:
 * - Share documents with internal users
 * - Manage user permissions
 * - Revoke user access
 * - Update user permission levels
 * - List shared users
 */
export class DocumentSharingService {
  private async getDB() {
    return await getTenantDB();
  }
  private encryptionSharingService: DocumentEncryptionSharingService;
  private accessLogService: DocumentAccessLogService;
  private permissionService: DocumentPermissionService;
  private sharingService: SharingService;
  private dataAccessService = new DataAccessService(DOC_TABLE_CONFIG);

  constructor() {
    this.encryptionSharingService = new DocumentEncryptionSharingService();
    this.accessLogService = new DocumentAccessLogService();
    this.permissionService = new DocumentPermissionService();
    this.sharingService = new SharingService(DOC_TABLE_CONFIG);
  }

  /**
   * Shares a document with internal users
   *
   * @param documentId - Document ID to share
   * @param userIds - Array of user IDs to share with
   * @param permissionLevel - Permission level to grant
   * @param ownerId - ID of the user sharing the document
   * @param ownerUserMasterKey - Optional owner's master key (required for USER_CONTROLLED documents)
   * @returns Promise with sharing results
   */
  async shareWithUsers(
    documentId: string,
    userIds: string[],
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL | string,
    ownerId: string,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<{
    documentId: string;
    sharedWith: {
      userId: string;
      permissionLevel: string;
      success: boolean;
      error?: string;
    }[];
  }> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingService.shareWithUsers",
      {
        service: "DocumentSharingService",
        method: "shareWithUsers",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, ownerId, userCount: userIds.length },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        // Check owner's permission to share
        const ownerPermission = await this.permissionService.getAccessLevel(
          documentId,
          ownerId,
        );

        // Implement 404 vs 403 strategy: if no permission at all, document doesn't exist for this user
        if (ownerPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // Owner has access but insufficient permission to share
        if (
          !permissionLevelMeets(ownerPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE) &&
          !permissionLevelMeets(ownerPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)
        ) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        // Cannot grant higher permission than owner has
        if (!permissionLevelMeets(ownerPermission, permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        const encryptionMode = await this.encryptionSharingService.getDocumentEncryptionMode(
          documentId,
        );

        const results = [];
        for (const userId of userIds) {
          try {
            const existingAccess = await this.permissionService.getAccessLevel(
              documentId,
              userId,
            );

            if (existingAccess !== null) {
              results.push({
                userId,
                permissionLevel,
                success: false,
                error: "User already has access",
              });
              continue;
            }

            if (
              encryptionMode === DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED
            ) {
              await this.encryptionSharingService.shareAppEncryptedDocument(
                documentId,
                ownerId,
                userId,
                permissionLevel,
              );
            } else {
              if (!ownerUserMasterKey) {
                results.push({
                  userId,
                  permissionLevel,
                  success: false,
                  error: "Owner's master key required for user-encrypted documents",
                });
                continue;
              }

              await this.dataAccessService.ensureUserControlledDataKey(
                documentId,
                ownerId,
                ownerUserMasterKey,
              );

              await this.encryptionSharingService.shareUserEncryptedDocument(
                documentId,
                ownerId,
                userId,
                permissionLevel,
                ownerUserMasterKey,
              );
            }

            await this.accessLogService.logDocumentAccess(
              documentId,
              ownerId,
              "share",
              "direct",
            );

            results.push({
              userId,
              permissionLevel,
              success: true,
            });
          } catch (error) {
            // Re-throw AppHttpException instances
            if (error instanceof AppHttpException) {
              throw error;
            }

            // Log unexpected errors for individual user sharing
            useLogger(LoggerLevels.error, {
              message: "Failed to share document with user",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "document_share_user_error",
              details: { documentId, userId, ownerId },
              raw: error,
            });

            results.push({
              userId,
              permissionLevel,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        return {
          documentId,
          sharedWith: results,
        };
      },
    );
  }

  /**
   * Revokes a user's access to a document
   *
   * @param documentId - Document ID
   * @param requesterId - ID of the user revoking access
   * @param targetUserId - ID of the user whose access is being revoked
   * @returns Promise<void>
   */
  async revokeUserAccess(
    documentId: string,
    requesterId: string,
    targetUserId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingService.revokeUserAccess",
      {
        service: "DocumentSharingService",
        method: "revokeUserAccess",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, requesterId, targetUserId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        // Check requester's permission
        const requesterPermission = await this.permissionService.getAccessLevel(
          documentId,
          requesterId,
        );

        if (requesterPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionLevelMeets(requesterPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        // Check if target user is the document owner
        const db = await this.getDB();
        const [documentRecord] = await db
          .select({ ownerId: tenantTables.documents.ownerId })
          .from(tenantTables.documents)
          .where(eq(tenantTables.documents.id, documentId))
          .limit(1);

        if (documentRecord && documentRecord.ownerId === targetUserId) {
          throwHttpError("DOCUMENT.CANNOT_REVOKE_OWNER_ACCESS");
        }

        // Attempt to revoke access via generic SharingService
        const revoked = await this.sharingService.revokeAccess(documentId, targetUserId);

        // No matching access record found
        if (!revoked) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        this.accessLogService.logDocumentAccess(
          documentId,
          requesterId,
          "revoke_access",
          "direct",
        );
      },
    );
  }

  /**
   * Updates a user's permission level for a document
   *
   * @param documentId - Document ID
   * @param requesterId - ID of the user updating permissions
   * @param targetUserId - ID of the user whose permission is being updated
   * @param newPermissionLevel - New permission level
   * @returns Promise with updated permission info
   */
  async updatePermission(
    documentId: string,
    requesterId: string,
    targetUserId: string,
    newPermissionLevel: string | number,
  ): Promise<{
    userId: string;
    permissionLevel: string | number;
    updatedAt: number;
  }> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingService.updatePermission",
      {
        service: "DocumentSharingService",
        method: "updatePermission",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, requesterId, targetUserId, newPermissionLevel },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        // Check requester's permission
        const requesterPermission = await this.permissionService.getAccessLevel(
          documentId,
          requesterId,
        );

        // Implement 404 vs 403 strategy: if no permission, document doesn't exist for this user
        if (requesterPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // Requester has access but insufficient permission to update permissions
        if (!permissionLevelMeets(requesterPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        // Cannot grant higher permission than requester has
        if (!permissionLevelMeets(requesterPermission, newPermissionLevel as unknown as DB_ENUM_PERMISSION_ACCESS_LEVEL)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        const updated = await this.sharingService.updatePermission(
          documentId,
          targetUserId,
          newPermissionLevel,
        );

        // No matching permission record found
        if (!updated) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        await this.accessLogService.logDocumentAccess(
          documentId,
          requesterId,
          "update_permission",
          "direct",
        );

        return {
          userId: targetUserId,
          permissionLevel: newPermissionLevel,
          updatedAt: updated!.updatedAt,
        };
      },
    );
  }

  /**
   * Lists all internal users with access to a document
   *
   * @param documentId - Document ID
   * @param requesterId - ID of the user requesting the list
   * @returns Promise with shared users list
   */
  async listSharedUsers(
    documentId: string,
    requesterId: string,
  ): Promise<{
    internalUsers: {
      userId: string;
      permissionLevel: number;
      grantedAt: number;
      grantedBy: string | null;
    }[];
  }> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingService.listSharedUsers",
      {
        service: "DocumentSharingService",
        method: "listSharedUsers",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, requesterId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        // Check requester's permission
        const requesterPermission = await this.permissionService.getAccessLevel(
          documentId,
          requesterId,
        );

        // Implement 404 vs 403 strategy: if no permission, document doesn't exist for this user
        if (requesterPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const internalUsers = await this.sharingService.listSharedUsers(documentId);

        return {
          internalUsers,
        };
      },
    );
  }
}
