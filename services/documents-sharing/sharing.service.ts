/**
 * @file services/documents-sharing/sharing.service.ts
 * @description Service for managing folder sharing operations
 *
 * This service handles core folder sharing functionality including:
 * - Sharing folders with internal users
 * - Revoking user access
 * - Listing folder permissions
 * - Managing public shares
 * - Change tracking for permissions
 */

import { and, eq, sql } from "@deps";

import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { DocumentFolderPermissionService } from "@services/document-folders/folder-permission.service.ts";
import { DocumentPermissionInheritanceService } from "@services/documents-permission/permission-inheritance.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { ChangeTrackingService, getChangeTrackingService } from "@services/documents-operations/change-tracking.helpers.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { GlobalCacheService } from "@services/cache/cache.service.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { PublicSharingService } from "@services/public-sharing/public-sharing.service.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { envConfig } from "@config/env.ts";
import type { IFolderSharedUser, IFolderShareResult, IPublicFolderShareOptions } from "@models/documents/folder-sharing.model.ts";
import { getTenantDB, requestContext, tenantTables } from "@db/index.ts";

/**
 * Document Folder Sharing Service
 *
 * Core service for managing folder sharing operations:
 * - Share folders with internal users
 * - Revoke user access
 * - List folder permissions
 * - Create and manage public shares
 */
export class DocumentFolderSharingService {
  private folderPermissionService: DocumentFolderPermissionService;
  private permissionInheritanceService: DocumentPermissionInheritanceService;
  private accessLogService: DocumentAccessLogService;
  private publicSharingService: PublicSharingService;
  private changeTrackingService: ChangeTrackingService;
  private folderEncryptionConfig: IEncryptionTableConfig;

  /**
   * Constructor
   *
   * @param cacheService - Optional global cache service for permission caching
   */
  constructor(cacheService?: GlobalCacheService) {
    this.folderPermissionService = new DocumentFolderPermissionService(
      cacheService,
    );
    this.permissionInheritanceService = new DocumentPermissionInheritanceService();
    this.accessLogService = new DocumentAccessLogService();
    this.changeTrackingService = getChangeTrackingService();

    // Create encryption table config for folders
    this.folderEncryptionConfig = {
      tableName: tenantTables.documentFolders,
      resourceIdColumn: "id",
    };

    // Initialize the centralized public sharing service
    this.publicSharingService = new PublicSharingService(
      this.folderEncryptionConfig,
    );
  }

  /**
   * Shares a folder with internal users
   *
   * This method:
   * 1. Validates the owner has admin permissions on the folder
   * 2. Validates all user IDs exist in the users table
   * 3. Creates or updates documentFoldersSharedUsers entries
   * 4. Sets hasInternalSharing flag to true
   * 5. Applies sharing to existing documents in the folder
   * 6. Recursively applies sharing to all subfolders
   *
   * @param folderId - ID of the folder to share
   * @param shareData - Sharing request data (userIds, permissionLevel, notifyUsers)
   * @param ownerId - ID of the user sharing the folder
   * @param environmentId - Environment ID
   * @param ownerUserMasterKey - Optional owner's user master key for user-encrypted documents
   * @returns Promise<IFolderShareResult> - Summary of sharing results
   *
   * @throws Error if owner lacks admin permissions
   * @throws Error if any user ID is invalid
   * @throws Error if folder doesn't exist
   */
  async shareWithUsers(
    folderId: string,
    sharedUserIds: string[],
    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    ownerId: string,
    environmentId: string,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<IFolderShareResult> {
    return await tracedWithServiceErrorHandling(
      "SharingService.shareWithUsers",
      {
        service: "SharingService",
        method: "shareWithUsers",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, ownerId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async () => {
        const tenantDb = await getTenantDB();
        const userPermission = await this.folderPermissionService.getAccessLevel(
          folderId,
          ownerId,
        );

        if (userPermission === null) {
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (!permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.SHARE)) {
          throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
        }

        const userCheckPromises = sharedUserIds.map(async (userId) => {
          const [user] = await tenantDb
            .select({ userId: tenantTables.userProfiles.userId })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, userId))
            .limit(1);
          return { userId, exists: !!user };
        });

        const userChecks = await Promise.all(userCheckPromises);
        const invalidUsers = userChecks.filter((check) => !check.exists);

        if (invalidUsers.length > 0) {
          throwHttpError("DOCUMENT_FOLDER.SHARE_INVALID_USERIDS", {
            users: invalidUsers.map((u) => u.userId),
          });
        }

        // 3. Create or update documentFoldersSharedUsers entries
        const now = getTimeNowForStorage();
        const sharedWithResults: IFolderShareResult["sharedWith"] = [];

        for (const userId of sharedUserIds) {
          try {
            const [existingEntry] = await tenantDb
              .select()
              .from(tenantTables.documentFoldersSharedUsers)
              .where(
                and(
                  eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
                  eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                ),
              )
              .limit(1);

            if (existingEntry) {
              // Track permission changes
              const changes = this.changeTrackingService.trackPermissionChanges(
                existingEntry,
                { permissionLevel, isActive: true },
              );

              await tenantDb
                .update(tenantTables.documentFoldersSharedUsers)
                .set({
                  permissionLevel: permissionLevel,
                  isActive: true,
                  updatedAt: now,
                })
                .where(eq(tenantTables.documentFoldersSharedUsers.id, existingEntry.id));

              // Log permission change if there were changes
              if (changes.length > 0) {
                this.accessLogService.logFolderAccess(
                  folderId,
                  ownerId,
                  "update_permission",
                  "direct",
                  true,
                  { changes },
                ).catch((err) => {
                  useLogger(LoggerLevels.warn, {
                    message: "Failed to log permission change",
                    section: loggerAppSections.DOCUMENTS_FOLDERS,
                    messageKey: "permission_change_log_failed",
                    details: { folderId, userId, error: err },
                  });
                });
              }
            } else {
              await databaseCreateWithRetry(
                async (folderSharedUserId) => {
                  const [env] = await tenantDb.insert(tenantTables.documentFoldersSharedUsers)
                    .values({
                      id: folderSharedUserId,
                      folderId,
                      userId,
                      permissionLevel: permissionLevel,
                      grantedById: ownerId,
                      grantedAt: now,
                      isActive: true,
                      createdAt: now,
                      updatedAt: now,
                    })
                    .returning({ id: tenantTables.documentFoldersSharedUsers.id });
                  if (!env) {
                    throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
                  }
                  return env;
                },
                generateIdRandomWithTimestamp,
              );
            }

            this.folderPermissionService.invalidatePermissionCache(
              folderId,
              userId,
            );

            sharedWithResults.push({
              userId,
              permissionLevel: permissionLevel as unknown as number,
              success: true,
            });
          } catch (error) {
            await useLogger(LoggerLevels.error, {
              message: "Failed to share folder with user",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "folder_sharing_user_error",
              details: { folderId, userId, error },
            });

            sharedWithResults.push({
              userId,
              permissionLevel: permissionLevel as unknown as number,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        await tenantDb
          .update(tenantTables.documentFolders)
          .set({
            hasInternalSharing: true,
            updatedAt: now,
          })
          .where(eq(tenantTables.documentFolders.id, folderId));

        const allSharedUsers = await tenantDb
          .select()
          .from(tenantTables.documentFoldersSharedUsers)
          .where(
            and(
              eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
              eq(tenantTables.documentFoldersSharedUsers.isActive, true),
            ),
          );

        let documentsShared = 0;
        try {
          const documentResults = await this.permissionInheritanceService
            .applyToExistingDocuments(
              folderId,
              allSharedUsers as unknown as IFolderSharedUser[],
              ownerUserMasterKey,
              ownerId,
            );
          documentsShared = documentResults.filter((r) => r.success).length;
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Failed to apply sharing to existing documents",
            section: loggerAppSections.DOCUMENTS_FOLDERS,
            messageKey: "folder_sharing_documents_error",
            details: { folderId, error },
          });
        }

        let subfoldersShared = 0;
        try {
          subfoldersShared = await this.permissionInheritanceService
            .applyToSubfolders(
              folderId,
              allSharedUsers as unknown as IFolderSharedUser[],
            );
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Failed to apply sharing to subfolders",
            section: loggerAppSections.DOCUMENTS_FOLDERS,
            messageKey: "folder_sharing_subfolders_error",
            details: { folderId, error },
          });
        }

        this.accessLogService.logFolderAccess(
          folderId,
          ownerId,
          "share",
          "direct",
          true,
          {},
        );

        // Emit notifications for each successful share
        try {
          const { getNotificationCreateService } = await import("@services/notifications/index.ts");
          const { NOTIFICATION_EVENT_TYPES } = await import("@config/notification-event-types.ts");

          const [ownerUser] = await tenantDb
            .select({ displayName: sql<string>`${tenantTables.userProfiles.firstName} || ' ' || ${tenantTables.userProfiles.lastName}` })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, ownerId))
            .limit(1);
          const ownerName = ownerUser?.displayName ?? null;

          const notificationService = getNotificationCreateService();
          for (const result of sharedWithResults) {
            if (!result.success) continue;
            notificationService.createAndEmit({
              userId: result.userId,
              environmentId,
              type: NOTIFICATION_EVENT_TYPES.FOLDER_SHARED,
              titleKey: "notifications.sharing.folder.shared",
              bodyKey: "notifications.sharing.folder.shared.body",
              actionRoute: "folders.view",
              resourceId: folderId,
              actorId: ownerId,
              actorName: ownerName,
            }).catch((err) => {
              useLogger(LoggerLevels.error, {
                messageKey: "notifications.emit_failed",
                message: "Failed to emit folder sharing notification",
                section: loggerAppSections.NOTIFICATIONS,
                details: { userId: result.userId, folderId, error: err instanceof Error ? err.message : String(err) },
              });
            });
          }
        } catch (err) {
          useLogger(LoggerLevels.error, {
            messageKey: "notifications.setup_failed",
            message: "Failed to emit folder sharing notifications",
            section: loggerAppSections.NOTIFICATIONS,
            details: { error: err instanceof Error ? err.message : String(err) },
          });
        }

        const result: IFolderShareResult = {
          folderId,
          sharedWith: sharedWithResults,
          documentsShared,
          subfoldersShared,
        };

        return result;
      },
    );
  }

  /**
   * Revokes a user's access to a folder
   *
   * This method:
   * 1. Validates the revoking user has admin permissions
   * 2. Sets isActive to false in documentFoldersSharedUsers
   * 3. Invalidates cached permissions
   * 4. Logs the revocation
   *
   * @param folderId - ID of the folder
   * @param userId - ID of the user whose access is being revoked
   * @param revokedBy - ID of the user performing the revocation
   * @returns Promise<void>
   *
   * @throws Error if revoking user lacks admin permissions
   * @throws Error if folder or user doesn't exist
   */
  async revokeUserAccess(
    folderId: string,
    userId: string,
    revokedBy: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "SharingService.revokeUserAccess",
      {
        service: "SharingService",
        method: "revokeUserAccess",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, revokedBy },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async () => {
        const tenantDb = await getTenantDB();
        const userPermission = await this.folderPermissionService.getAccessLevel(
          folderId,
          revokedBy,
        );

        if (userPermission === null) {
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (!permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
        }

        // Check if target user is the folder owner
        const [folderRecord] = await tenantDb
          .select({ ownerId: tenantTables.documentFolders.ownerId })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, folderId))
          .limit(1);

        if (folderRecord && folderRecord.ownerId === userId) {
          throwHttpError("DOCUMENT_FOLDER.CANNOT_REVOKE_OWNER_ACCESS");
        }

        // Get current permission state for change tracking
        const [currentPermission] = await tenantDb
          .select()
          .from(tenantTables.documentFoldersSharedUsers)
          .where(
            and(
              eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
              eq(tenantTables.documentFoldersSharedUsers.userId, userId),
            ),
          )
          .limit(1);

        if (currentPermission) {
          // Track the revocation change
          const changes = this.changeTrackingService.trackPermissionChanges(
            currentPermission,
            { isActive: false },
          );

          await tenantDb
            .update(tenantTables.documentFoldersSharedUsers)
            .set({
              isActive: false,
            })
            .where(
              and(
                eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
              ),
            );

          // Log revocation with changes
          this.accessLogService.logFolderAccess(
            folderId,
            revokedBy,
            "revoke",
            "direct",
            true,
            { changes },
          ).catch((err) => {
            useLogger(LoggerLevels.warn, {
              message: "Failed to log permission revocation",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "permission_revoke_log_failed",
              details: { folderId, userId, error: err },
            });
          });
        }

        // Cascade revocation to all descendant subfolders and documents
        try {
          await this.permissionInheritanceService.revokeFromDocumentsAndSubfolders(
            folderId,
            userId,
          );
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Failed to cascade access revocation to documents and subfolders",
            section: loggerAppSections.DOCUMENTS_FOLDERS,
            messageKey: "folder_revoke_cascade_error",
            details: { folderId, userId, error },
          });
          // Non-fatal: the main folder access has been revoked; log and continue
        }

        // Check if there are any remaining active shared users
        const remainingSharedUsers = await tenantDb
          .select({
            id: tenantTables.documentFoldersSharedUsers.id,
          })
          .from(tenantTables.documentFoldersSharedUsers)
          .where(
            and(
              eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
              eq(tenantTables.documentFoldersSharedUsers.isActive, true),
            ),
          )
          .limit(1);

        // If no remaining shared users, set hasInternalSharing to false
        if (remainingSharedUsers.length === 0) {
          await tenantDb
            .update(tenantTables.documentFolders)
            .set({
              hasInternalSharing: false,
            })
            .where(eq(tenantTables.documentFolders.id, folderId));
        }

        this.folderPermissionService.invalidatePermissionCache(
          folderId,
          userId,
        );
      },
    );
  }

  /**
   * Lists all permissions for a folder
   *
   * Returns:
   * - All active internal users with their permission levels and names
   * - Public share configuration (if enabled)
   *
   * @param folderId - ID of the folder
   * @param requesterId - ID of the user requesting the permissions list
   * @returns Promise<{ internalUsers: IFolderSharedUser[]; publicShare: {...} }>
   *
   * @throws Error if requester doesn't have access to the folder
   */
  async listFolderPermissions(
    folderId: string,
    requesterId: string,
  ): Promise<{
    internalUsers: IFolderSharedUser[];
    publicShare: {
      isEnabled: boolean;
      token: string | null;
      expiresAt: number | null;
    };
  }> {
    return await tracedWithServiceErrorHandling(
      "SharingService.listFolderPermissions",
      {
        service: "SharingService",
        method: "listFolderPermissions",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, requesterId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async () => {
        const tenantDb = await getTenantDB();
        const hasAccess = await this.folderPermissionService.checkFolderAccess(
          folderId,
          requesterId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );

        if (!hasAccess) {
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        // Join with users table to get user names
        const internalUsersRaw = await tenantDb
          .select({
            id: tenantTables.documentFoldersSharedUsers.id,
            folderId: tenantTables.documentFoldersSharedUsers.folderId,
            userId: tenantTables.documentFoldersSharedUsers.userId,
            userName: sql<string | null>`${tenantTables.userProfiles.firstName} || ' ' || ${tenantTables.userProfiles.lastName}`,
            permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
            grantedById: tenantTables.documentFoldersSharedUsers.grantedById,
            grantedByName: tenantTables.documentFoldersSharedUsers.grantedByName,
            grantedAt: tenantTables.documentFoldersSharedUsers.grantedAt,
            isActive: tenantTables.documentFoldersSharedUsers.isActive,
            createdAt: tenantTables.documentFoldersSharedUsers.createdAt,
            updatedAt: tenantTables.documentFoldersSharedUsers.updatedAt,
          })
          .from(tenantTables.documentFoldersSharedUsers)
          .leftJoin(
            tenantTables.userProfiles,
            eq(tenantTables.documentFoldersSharedUsers.userId, tenantTables.userProfiles.userId),
          )
          .where(
            and(
              eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
              eq(tenantTables.documentFoldersSharedUsers.isActive, true),
            ),
          );

        const [folder] = await tenantDb
          .select({
            isPublicShared: tenantTables.documentFolders.isPublicShared,
            publicShareToken: tenantTables.documentFolders.publicShareToken,
            publicShareExpiresAt: tenantTables.documentFolders.publicShareExpiresAt,
          })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, folderId))
          .limit(1);

        const publicShare = {
          isEnabled: folder?.isPublicShared ?? false,
          token: folder?.publicShareToken ?? null,
          expiresAt: folder?.publicShareExpiresAt ?? null,
        };

        return {
          internalUsers: internalUsersRaw as unknown as IFolderSharedUser[],
          publicShare,
        };
      },
    );
  }

  /**
   * Creates a public share link for a folder
   *
   * This method:
   * 1. Uses the centralized PublicSharingService for consistent security
   * 2. Leverages advanced cryptographic link generation (512+ bit entropy)
   * 3. Provides proper encryption key management
   * 4. Maintains backward compatibility with existing folder structure
   *
   * @param folderId - ID of the folder to share publicly
   * @param options - Public share options (password, expiresAt)
   * @param ownerId - ID of the user creating the public share
   * @returns Promise<{ shareUrl: string; token: string; expiresAt?: number }>
   *
   * @throws Error if owner lacks admin permissions
   * @throws Error if folder doesn't exist
   */
  async createPublicShare(
    folderId: string,
    options: IPublicFolderShareOptions,
    ownerId: string,
    encryptionKey: Uint8Array,
  ): Promise<{ shareUrl: string; token: string; expiresAt?: number }> {
    return await tracedWithServiceErrorHandling(
      "SharingService.createPublicShare",
      {
        service: "SharingService",
        method: "createPublicShare",
        section: loggerAppSections.DEBUG,
        details: { folderId, ownerId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async () => {
        const tenantDb = await getTenantDB();
        // Get environmentId from request context for tenant DB routing
        const environmentId = requestContext.getStore()?.environmentId;

        const result = await this.publicSharingService.createPublicShare(
          folderId,
          ownerId,
          {
            permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
            password: options.password,
            expiresAt: options.expiresAt,
            recipientName: undefined,
            recipientEmail: undefined,
            recipientLanguage: "en",
            notifyOnAccess: false,
          },
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          encryptionKey,
          environmentId,
        );

        await tenantDb
          .update(tenantTables.documentFolders)
          .set({
            isPublicShared: true,
            publicShareToken: result.shareToken,
            publicShareExpiresAt: options.expiresAt ?? null,
          })
          .where(eq(tenantTables.documentFolders.id, folderId));

        this.accessLogService.logFolderAccess(
          folderId,
          ownerId,
          "create_public_share",
          "direct",
          true,
          {},
        );

        const finalResult = {
          shareUrl: `${envConfig.public.frontURL}/public/documents${result.publicUri}`,
          token: result.shareToken,
          ...(options.expiresAt && { expiresAt: options.expiresAt }),
        };

        return finalResult;
      },
    );
  }

  /**
   * Disables public sharing for a folder
   *
   * This method:
   * 1. Validates the owner has admin permissions on the folder
   * 2. Sets isPublicShared to false
   * 3. Clears publicShareToken, expiresAt, and passwordHash
   * 4. Invalidates cached public access
   *
   * @param folderId - ID of the folder
   * @param ownerId - ID of the user disabling the public share
   * @returns Promise<void>
   *
   * @throws Error if owner lacks admin permissions
   * @throws Error if folder doesn't exist
   */
  async disablePublicShare(
    folderId: string,
    ownerId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "SharingService.disablePublicShare",
      {
        service: "SharingService",
        method: "disablePublicShare",
        section: loggerAppSections.DEBUG,
        details: { folderId, ownerId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async () => {
        const tenantDb = await getTenantDB();
        const userPermission = await this.folderPermissionService.getAccessLevel(
          folderId,
          ownerId,
        );

        if (userPermission === null) {
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (!permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
        }

        // Check if public sharing is actually enabled before disabling
        const [folder] = await tenantDb
          .select({
            isPublicShared: tenantTables.documentFolders.isPublicShared,
            publicShareToken: tenantTables.documentFolders.publicShareToken,
          })
          .from(tenantTables.documentFolders)
          .where(eq(tenantTables.documentFolders.id, folderId))
          .limit(1);

        if (!folder) {
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (!folder.isPublicShared || !folder.publicShareToken) {
          return;
        }

        await tenantDb
          .update(tenantTables.documentFolders)
          .set({
            isPublicShared: false,
            publicShareToken: null,
            publicShareExpiresAt: null,
          })
          .where(eq(tenantTables.documentFolders.id, folderId));

        this.accessLogService.logFolderAccess(
          folderId,
          ownerId,
          "disable_public_share",
          "direct",
          true,
          {},
        );
      },
    );
  }

  /**
   * Lists documents for a public folder share after validating access
   */
  async listPublicFolderDocuments(
    token: string,
    shareKey: string,
    password?: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
    },
  ): Promise<{
    folder: { name: string; color: string; icon: string };
    documents: Array<{ name: string; contentType: string | null; fileSize: number }>;
  }> {
    const tenantDb = await getTenantDB();
    const publicShare = await this.publicSharingService.getPublicShare(token);
    const folderId = publicShare.resourceId;

    if (publicShare.isPasswordProtected) {
      if (!password) {
        this.accessLogService.logFolderAccess(
          folderId,
          null,
          "list",
          "public_share",
          false,
          { ...metadata, errorMessage: "Password required for public share" },
        );
        throwHttpError("DOCUMENT_FOLDER.PUBLIC_SHARE_PASSWORD_REQUIRED");
      }

      const isPasswordValid = await this.publicSharingService.verifyPublicSharePassword(
        token,
        shareKey,
        password,
        HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
        {
          ipAddress: metadata?.ipAddress,
          userAgent: metadata?.userAgent,
        },
      );

      if (!isPasswordValid) {
        this.accessLogService.logFolderAccess(
          folderId,
          null,
          "list",
          "public_share",
          false,
          { ...metadata, errorMessage: "Invalid password for public share" },
        );
        throwHttpError("DOCUMENT_FOLDER.PUBLIC_SHARE_INVALID_PASSWORD");
      }
    }

    const [folder] = await tenantDb
      .select({
        id: tenantTables.documentFolders.id,
        name: tenantTables.documentFolders.name,
        color: tenantTables.documentFolders.color,
        icon: tenantTables.documentFolders.icon,
        isPublicShared: tenantTables.documentFolders.isPublicShared,
        publicShareToken: tenantTables.documentFolders.publicShareToken,
        isArchived: tenantTables.documentFolders.isArchived,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.id, folderId),
          eq(tenantTables.documentFolders.isPublicShared, true),
          eq(tenantTables.documentFolders.isArchived, false),
          eq(tenantTables.documentFolders.publicShareToken, token),
        ),
      )
      .limit(1);

    if (!folder || !folder.isPublicShared || folder.isArchived) {
      this.accessLogService.logFolderAccess(
        folderId,
        null,
        "list",
        "public_share",
        false,
        { ...metadata, errorMessage: "Public share not found or invalid" },
      );
      throwHttpError("DOCUMENT_FOLDER.PUBLIC_SHARE_NOT_FOUND");
    }

    const documents = await this.folderPermissionService.getAccessibleDocuments(
      folderId,
      {
        userId: null,
        environmentId: null,
        isPublicAccess: true,
        accessMethod: "public_share",
        shareToken: token,
      },
    );

    this.accessLogService.logFolderAccess(
      folderId,
      null,
      "list",
      "public_share",
      true,
      metadata,
    );

    return {
      folder: {
        name: folder.name,
        color: folder.color || "#3b82f6",
        icon: folder.icon || "folder",
      },
      documents: documents.map((doc) => ({
        name: doc.name,
        contentType: doc.contentType ?? null,
        fileSize: doc.originalFileSize ?? 0,
      })),
    };
  }
}
