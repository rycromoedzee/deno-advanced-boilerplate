/**
 * @file services/document-folders/folder-permission.service.ts
 * @description Service for managing folder permissions and access control
 *
 * This service handles permission verification for both internal user sharing
 * and public share access. It provides methods for checking folder access,
 * calculating effective permissions, and verifying public share tokens.
 */

import { and, desc, eq, inArray, sql } from "@deps";

import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { DocumentFolderPermissionCacheService } from "./folder-permission-cache.service.ts";
import type { GlobalCacheService } from "@services/cache/cache.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/index.ts";
import { PublicSharingService } from "@services/public-sharing/public-sharing.service.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import type { IFolderAccessContext } from "@interfaces/documents.ts";
import { IDocumentResponse } from "@models/documents/index.ts";
import type { IDocumentFolder } from "@models/documents/folder.model.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Document Folder Permission Service
 *
 * Provides permission verification and access control for folders:
 * - Checks if users have access to folders (ownership or shared access)
 * - Calculates effective permission levels
 * - Verifies public share tokens
 * - Supports caching for performance optimization
 */
export class DocumentFolderPermissionService {
  private cacheService: DocumentFolderPermissionCacheService | null;
  private accessLogService: DocumentAccessLogService;

  /**
   * Constructor
   *
   * @param cacheService - Optional cache service for permission caching.
   *                       Can be either a DocumentFolderPermissionCacheService (preferred)
   *                       or a GlobalCacheService (deprecated, will be wrapped).
   */
  constructor(cacheService?: DocumentFolderPermissionCacheService | GlobalCacheService) {
    // Handle both new cache service type and legacy GlobalCacheService
    if (cacheService instanceof DocumentFolderPermissionCacheService) {
      this.cacheService = cacheService;
    } else if (cacheService) {
      // Legacy: wrap GlobalCacheService in DocumentFolderPermissionCacheService
      this.cacheService = new DocumentFolderPermissionCacheService(cacheService);
    } else {
      this.cacheService = null;
    }
    this.accessLogService = new DocumentAccessLogService();
  }

  /**
   * Checks if a user has access to a folder with the required permission level
   *
   * @param folderId - Folder ID to check access for
   * @param userId - User ID requesting access
   * @param requiredPermission - Minimum required permission level (default: READ)
   * @returns Promise<boolean> - True if user has access, false otherwise
   */
  async checkFolderAccess(
    folderId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL = DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
    },
  ): Promise<boolean> {
    return await tracedWithServiceErrorHandling(
      "DocumentFolderPermissionService.checkFolderAccess",
      {
        service: "DocumentFolderPermissionService",
        method: "checkFolderAccess",
        section: loggerAppSections.DOCUMENTS,
        details: { folderId, userId, requiredPermission },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;
        span.attributes["required_level"] = requiredPermission;

        let accessGranted = false;
        let accessMethod = "direct";
        let errorMessage: string | undefined;

        if (this.cacheService) {
          const cachedPermission = await this.cacheService.getCachedPermission(
            folderId,
            userId,
          );
          if (cachedPermission !== null) {
            span.attributes["cache_hit"] = true;
            span.attributes["permission_level"] = cachedPermission !== -1 ? cachedPermission : "none";

            accessGranted = cachedPermission !== -1 &&
              permissionLevelMeets(cachedPermission as DB_ENUM_PERMISSION_ACCESS_LEVEL, requiredPermission);
            span.attributes["has_access"] = accessGranted;

            this.accessLogService.logFolderAccess(
              folderId,
              userId,
              "view",
              "direct",
              accessGranted,
              {
                ...metadata,
                errorMessage: accessGranted ? undefined : "Insufficient permissions (cached)",
              },
            );
            return accessGranted;
          }
        }

        span.attributes["cache_hit"] = false;

        const folderResult = await traced("checkFolderAccess.queryFolder", "db.query", async (dbSpan) => {
          const result = await (await getTenantDB())
            .select({
              id: tenantTables.documentFolders.id,
              ownerId: tenantTables.documentFolders.ownerId,
              isArchived: tenantTables.documentFolders.isArchived,
            })
            .from(tenantTables.documentFolders)
            .where(
              and(
                eq(tenantTables.documentFolders.id, folderId),
              ),
            )
            .limit(1);

          dbSpan.attributes["folder_found"] = result.length > 0;
          return result;
        });

        if (folderResult.length === 0) {
          errorMessage = "Folder not found";
          span.attributes["folder_found"] = false;
          span.attributes["has_access"] = false;

          await useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "folder_permission_not_found",
            details: { folderId, userId },
          });

          // Do not log folder access when the folder doesn't exist —
          // the FK constraint on folder_access_logs.folder_id would fail.

          return false;
        }

        const folder = folderResult[0];

        if (folder.ownerId === userId) {
          accessGranted = permissionLevelMeets(DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN, requiredPermission);
          accessMethod = "direct";

          span.attributes["is_owner"] = true;
          span.attributes["permission_level"] = DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN;
          span.attributes["has_access"] = accessGranted;

          if (this.cacheService) {
            await this.cacheService.cachePermission(
              folderId,
              userId,
              DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
            );
          }

          this.accessLogService.logFolderAccess(
            folderId,
            userId,
            "view",
            accessMethod,
            accessGranted,
            metadata,
          );

          return accessGranted;
        }

        const sharedAccessResult = await traced("checkFolderAccess.sharedAccess", "db.query", async (dbSpan) => {
          const result = await (await getTenantDB())
            .select({
              permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
              isActive: tenantTables.documentFoldersSharedUsers.isActive,
            })
            .from(tenantTables.documentFoldersSharedUsers)
            .where(
              and(
                eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            )
            .limit(1);

          dbSpan.attributes["shared_access_found"] = result.length > 0;
          return result;
        });

        if (sharedAccessResult.length === 0) {
          errorMessage = "User does not have shared access to folder";
          span.attributes["is_owner"] = false;
          span.attributes["has_shared_access"] = false;
          span.attributes["has_access"] = false;

          await useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "folder_permission_no_shared_access",
            details: { folderId, userId },
          });

          // Cache the no-access result (permission level -1)
          if (this.cacheService) {
            await this.cacheService.cachePermission(folderId, userId, -1);
          }

          // Log failed access attempt
          this.accessLogService.logFolderAccess(
            folderId,
            userId,
            "view",
            "direct",
            false,
            { ...metadata, errorMessage },
          );

          return false;
        }

        const sharedAccess = sharedAccessResult[0];
        accessMethod = "internal_share";

        span.attributes["is_owner"] = false;
        span.attributes["has_shared_access"] = true;
        span.attributes["permission_level"] = sharedAccess.permissionLevel;

        // Cache the permission
        if (this.cacheService) {
          await this.cacheService.cachePermission(
            folderId,
            userId,
            sharedAccess.permissionLevel,
          );
        }

        const hasRequiredPermission = permissionLevelMeets(
          sharedAccess.permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
          requiredPermission,
        );
        accessGranted = hasRequiredPermission;

        span.attributes["has_access"] = accessGranted;
        span.attributes["access_method"] = accessMethod;

        if (!hasRequiredPermission) {
          errorMessage = `Insufficient permission level: has ${sharedAccess.permissionLevel}, requires ${requiredPermission}`;
          await useLogger(LoggerLevels.debug, {
            message: "User has insufficient permission level",
            section: loggerAppSections.DEBUG,
            messageKey: "folder_permission_insufficient",
            details: {
              folderId,
              userId,
              userPermission: sharedAccess.permissionLevel,
              requiredPermission,
            },
          });
        }

        // Log access attempt (success or failure)
        this.accessLogService.logFolderAccess(
          folderId,
          userId,
          "view",
          accessMethod,
          accessGranted,
          { ...metadata, errorMessage },
        );

        return hasRequiredPermission;
      },
    );
  }

  /**
   * Retrieves the user's permission level for a specific folder
   *
   * Similar to DocumentPermissionService.getAccessLevel, this method returns the
   * actual permission level rather than just a boolean check. Useful when you need
   * to know the exact permission level for multiple checks or conditional logic.
   *
   * @param folderId - Folder ID to check
   * @param userId - User ID to check permissions for
   * @returns Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null> - The user's permission level or null if no access
   *
   * @example
   * ```typescript
   * const service = new DocumentFolderPermissionService(cacheService);
   * const permissionLevel = await service.getAccessLevel('folder_123', 'user_456');
   * if (permissionLevel === DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN) {
   *   // User has admin access
   * } else if (permissionLevel === DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE) {
   *   // User has write access
   * } else if (permissionLevel === null) {
   *   // User has no access
   * }
   * ```
   */
  async getAccessLevel(
    folderId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentFolderPermissionService.getAccessLevel",
      {
        service: "DocumentFolderPermissionService",
        method: "getAccessLevel",
        section: loggerAppSections.DOCUMENTS,
        details: { folderId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;

        // Try to get from cache first
        if (this.cacheService) {
          const cached = await this.cacheService.getCachedPermission(
            folderId,
            userId,
          );
          if (cached !== null) {
            span.attributes["cache_hit"] = true;
            // Cache stores -1 for no access, convert to null for consistency with document service
            const permissionLevel = cached === -1 ? null : cached as unknown as DB_ENUM_PERMISSION_ACCESS_LEVEL;
            span.attributes["permission_level"] = permissionLevel !== null ? permissionLevel : "none";
            return permissionLevel;
          }
        }

        span.attributes["cache_hit"] = false;

        const result = await traced("getAccessLevel.dbQuery", "db.query", async (dbSpan) => {
          // Check if folder exists and get owner
          const folderResult = await (await getTenantDB())
            .select({
              id: tenantTables.documentFolders.id,
              ownerId: tenantTables.documentFolders.ownerId,
            })
            .from(tenantTables.documentFolders)
            .where(
              and(
                eq(tenantTables.documentFolders.id, folderId),
              ),
            )
            .limit(1);

          dbSpan.attributes["folder_found"] = folderResult.length > 0;

          if (folderResult.length === 0) {
            return { folder: null, permissionLevel: null };
          }

          const folder = folderResult[0];

          // Owner has ADMIN permission
          if (folder.ownerId === userId) {
            return { folder, permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN };
          }

          // Check shared access
          const sharedAccessResult = await (await getTenantDB())
            .select({
              permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
              isActive: tenantTables.documentFoldersSharedUsers.isActive,
            })
            .from(tenantTables.documentFoldersSharedUsers)
            .where(
              and(
                eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            )
            .limit(1);

          dbSpan.attributes["shared_access_found"] = sharedAccessResult.length > 0;

          if (sharedAccessResult.length === 0) {
            return { folder, permissionLevel: null };
          }

          return {
            folder,
            permissionLevel: sharedAccessResult[0].permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
          };
        });

        const permissionLevel = result.permissionLevel;

        // Cache the permission level (use -1 for no access to match cache service convention)
        if (this.cacheService) {
          await this.cacheService.cachePermission(
            folderId,
            userId,
            permissionLevel === null ? -1 : permissionLevel,
          );
        }

        span.attributes["permission_level"] = permissionLevel !== null ? permissionLevel : "none";
        return permissionLevel;
      },
    );
  }

  /**
   * Gets the effective permission level for a user on a folder
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @returns Promise<string | number> - Permission level (ADMIN for owner, shared level for others, -1 for no access)
   */
  async getEffectivePermission(
    folderId: string,
    userId: string,
  ): Promise<string | number> {
    return await tracedWithServiceErrorHandling(
      "DocumentFolderPermissionService.getEffectivePermission",
      {
        service: "DocumentFolderPermissionService",
        method: "getEffectivePermission",
        section: loggerAppSections.DOCUMENTS,
        details: { folderId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;

        // Try to get from cache first
        if (this.cacheService) {
          const cachedPermission = await this.cacheService.getCachedPermission(
            folderId,
            userId,
          );
          if (cachedPermission !== null) {
            span.attributes["cache_hit"] = true;
            span.attributes["permission_level"] = cachedPermission !== -1 ? cachedPermission : "none";
            return cachedPermission;
          }
        }

        span.attributes["cache_hit"] = false;

        // Check if folder exists
        const folderResult = await traced("getEffectivePermission.dbQueryFolder", "db.query", async (dbSpan) => {
          const result = await (await getTenantDB())
            .select({
              id: tenantTables.documentFolders.id,
              ownerId: tenantTables.documentFolders.ownerId,
            })
            .from(tenantTables.documentFolders)
            .where(
              and(
                eq(tenantTables.documentFolders.id, folderId),
              ),
            )
            .limit(1);

          dbSpan.attributes["folder_found"] = result.length > 0;
          return result;
        });

        if (folderResult.length === 0) {
          span.attributes["folder_found"] = false;
          span.attributes["permission_level"] = "none";

          await useLogger(LoggerLevels.debug, {
            message: "Folder not found when getting effective permission",
            section: loggerAppSections.DEBUG,
            messageKey: "folder_permission_effective_not_found",
            details: { folderId, userId },
          });
          // Cache the no-access result
          if (this.cacheService) {
            await this.cacheService.cachePermission(folderId, userId, -1);
          }
          return -1; // No access
        }

        const folder = folderResult[0];

        // Owner has ADMIN permission
        if (folder.ownerId === userId) {
          span.attributes["is_owner"] = true;
          span.attributes["permission_level"] = DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN;

          // Cache the permission
          if (this.cacheService) {
            await this.cacheService.cachePermission(
              folderId,
              userId,
              DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
            );
          }
          return DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN;
        }

        // Check documentFoldersSharedUsers table
        const sharedAccessResult = await traced("getEffectivePermission.dbQueryShared", "db.query", async (dbSpan) => {
          const result = await (await getTenantDB())
            .select({
              permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
            })
            .from(tenantTables.documentFoldersSharedUsers)
            .where(
              and(
                eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            )
            .limit(1);

          dbSpan.attributes["shared_access_found"] = result.length > 0;
          return result;
        });

        if (sharedAccessResult.length === 0) {
          span.attributes["is_owner"] = false;
          span.attributes["has_shared_access"] = false;
          span.attributes["permission_level"] = "none";

          // Cache the no-access result
          if (this.cacheService) {
            await this.cacheService.cachePermission(folderId, userId, -1);
          }
          return -1; // No access
        }

        const permissionLevel = sharedAccessResult[0].permissionLevel;

        span.attributes["is_owner"] = false;
        span.attributes["has_shared_access"] = true;
        span.attributes["permission_level"] = permissionLevel;

        // Cache the permission
        if (this.cacheService) {
          await this.cacheService.cachePermission(
            folderId,
            userId,
            permissionLevel,
          );
        }

        return permissionLevel;
      },
    );
  }

  /**
   * Verifies public share access using a share token
   *
   * @param token - Public share token
   * @param password - Optional password for password-protected shares
   * @returns Promise<{ folderId: string; isValid: boolean; folder: IDocumentFolder | null }>
   */
  async verifyPublicShareAccess(
    token: string,
    shareKey: string,
    password?: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
    },
  ): Promise<
    { folderId: string; isValid: boolean; folder: IDocumentFolder | null }
  > {
    let errorMessage: string | undefined;
    let folderId = "";

    try {
      // Query folder by publicShareToken
      const folderResult = await (await getTenantDB())
        .select()
        .from(tenantTables.documentFolders)
        .where(
          and(
            eq(tenantTables.documentFolders.publicShareToken, token),
            eq(tenantTables.documentFolders.isPublicShared, true),
            eq(tenantTables.documentFolders.isArchived, false),
          ),
        )
        .limit(1);

      if (folderResult.length === 0) {
        errorMessage = "Public share token not found or invalid";
        await useLogger(LoggerLevels.debug, {
          message: errorMessage,
          section: loggerAppSections.DEBUG,
          messageKey: "folder_public_share_invalid_token",
          details: { token: token.substring(0, 8) + "..." },
        });

        // Can't log to specific folder since we don't know the folderId
        // This is a security feature - don't reveal if token exists

        return { folderId: "", isValid: false, folder: null };
      }

      const folder = folderResult[0] as IDocumentFolder;
      folderId = folder.id;

      // Check expiration if set
      if (folder.publicShareExpiresAt) {
        const now = Math.floor(Date.now() / 1000);
        if (now > folder.publicShareExpiresAt) {
          errorMessage = "Public share token has expired";
          await useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "folder_public_share_expired",
            details: {
              folderId: folder.id,
              expiresAt: folder.publicShareExpiresAt,
              now,
            },
          });

          // Log failed access attempt
          this.accessLogService.logFolderAccess(
            folder.id,
            null, // Anonymous access
            "view",
            "public_share",
            false,
            { ...metadata, errorMessage },
          );

          return { folderId: folder.id, isValid: false, folder };
        }
      }

      // Verify password if required using decryption-based validation
      // Note: passwordHash removed - password validation is done via decryption attempt
      // This maintains zero-knowledge architecture where no password hashes are stored
      if (password) {
        // Use PublicSharingService for decryption-based password validation
        const publicSharingService = new PublicSharingService({
          tableName: tenantTables.documentFolders,
          resourceIdColumn: "id",
        });

        const isPasswordValid = await publicSharingService.verifyPublicSharePassword(
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
          errorMessage = "Invalid password for public share";
          await useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "folder_public_share_invalid_password",
            details: { folderId: folder.id },
          });

          // Log failed access attempt
          this.accessLogService.logFolderAccess(
            folder.id,
            null,
            "view",
            "public_share",
            false,
            { ...metadata, errorMessage },
          );

          return { folderId: folder.id, isValid: false, folder };
        }
      }

      // All checks passed
      await useLogger(LoggerLevels.debug, {
        message: "Public share access verified successfully",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_public_share_verified",
        details: { folderId: folder.id },
      });

      // Log successful access
      this.accessLogService.logFolderAccess(
        folder.id,
        null, // Anonymous access
        "view",
        "public_share",
        true,
        metadata,
      );

      return { folderId: folder.id, isValid: true, folder };
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : "Unknown error";

      await useLogger(LoggerLevels.error, {
        message: "Error verifying public share access",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_public_share_verify_error",
        details: { token: token.substring(0, 8) + "...", error },
      });

      // Log failed access attempt if we have a folderId
      if (folderId) {
        this.accessLogService.logFolderAccess(
          folderId,
          null,
          "view",
          "public_share",
          false,
          { ...metadata, errorMessage },
        );
      }

      throw error;
    }
  }

  /**
   * Invalidates cached permissions for a folder
   * Should be called when folder sharing configuration changes
   *
   * @param folderId - Folder ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderPermissionService(cacheService);
   * // After granting or revoking access
   * await service.invalidateFolderCache('folder_123');
   * ```
   */
  async invalidateFolderCache(folderId: string): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.invalidateFolderPermissions(folderId);
    }
  }

  /**
   * Invalidates cached permissions for a user
   * Should be called when user's permissions change across multiple folders
   *
   * @param userId - User ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderPermissionService(cacheService);
   * await service.invalidateUserCache('user_456');
   * ```
   */
  async invalidateUserCache(userId: string): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.invalidateUserPermissions(userId);
    }
  }

  /**
   * Invalidates a specific permission cache entry
   *
   * @param folderId - Folder ID
   * @param userId - User ID
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new FolderPermissionService(cacheService);
   * await service.invalidatePermissionCache('folder_123', 'user_456');
   * ```
   */
  async invalidatePermissionCache(
    folderId: string,
    userId: string,
  ): Promise<void> {
    if (this.cacheService) {
      await this.cacheService.invalidatePermission(folderId, userId);
    }
  }

  /**
   * Gets all accessible documents in a folder
   *
   * For internal users: Returns all documents recursively from nested folders
   * For public access: Returns only direct child documents
   *
   * @param folderId - Folder ID
   * @param context - Access context (user ID, access method, etc.)
   * @returns Promise<IDocument[]> - Array of accessible documents
   *
   * @example
   * ```typescript
   * const service = new FolderPermissionService();
   * // Internal user access
   * const docs = await service.getAccessibleDocuments('folder_123', {
   *   userId: 'user_456',
   *   isPublicAccess: false,
   *   accessMethod: 'internal_share'
   * });
   *
   * // Public access
   * const publicDocs = await service.getAccessibleDocuments('folder_123', {
   *   userId: null,
   *   isPublicAccess: true,
   *   accessMethod: 'public_share',
   *   shareToken: 'abc123'
   * });
   * ```
   */
  async getAccessibleDocuments(
    folderId: string,
    context: IFolderAccessContext,
  ): Promise<IDocumentResponse[]> {
    try {
      type DocumentRow = {
        id: string;
        name: string;
        description: string | null;
        folderId: string | null;
        ownerId: string;
        contentType: string | null;
        isArchived: boolean;
        archivedAt: number | null;
        downloadCount: number;
        viewCount: number;
        lastAccessedAt: number | null;
        metadata: unknown;
        createdAt: number;
        updatedAt: number;
        folderName: string | null;
        ownerFirstName: string | null;
        ownerLastName: string | null;
        favoriteDocumentId: string | null;
        thumbnailPath: string | null;
        originalFileSize: number | null;
      };
      let dbDocs: DocumentRow[];

      if (context.isPublicAccess) {
        // Public access: return only direct child documents
        // Note: Public access doesn't have userId, so favorites are always false
        dbDocs = await (await getTenantDB())
          .select({
            id: tenantTables.documents.id,
            name: tenantTables.documents.name,
            description: tenantTables.documents.description,
            folderId: tenantTables.documents.folderId,
            ownerId: tenantTables.documents.ownerId,
            contentType: tenantTables.documents.contentType,
            isArchived: tenantTables.documents.isArchived,
            archivedAt: tenantTables.documents.archivedAt,
            downloadCount: tenantTables.documents.downloadCount,
            viewCount: tenantTables.documents.viewCount,
            lastAccessedAt: tenantTables.documents.lastAccessedAt,
            metadata: tenantTables.documents.metadata,
            createdAt: tenantTables.documents.createdAt,
            updatedAt: tenantTables.documents.updatedAt,
            folderName: tenantTables.documentFolders.name,
            ownerFirstName: sql<string | null>`NULL`.as("ownerFirstName"),
            ownerLastName: sql<string | null>`NULL`.as("ownerLastName"),
            favoriteDocumentId: sql<string | null>`NULL`.as("favoriteDocumentId"), // Public access has no favorites
            thumbnailPath: tenantTables.storageMetadata.thumbnailPath,
            originalFileSize: tenantTables.storageMetadata.originalFileSize,
          })
          .from(tenantTables.documents)
          .leftJoin(
            tenantTables.documentFolders,
            eq(tenantTables.documents.folderId, tenantTables.documentFolders.id),
          )
          .leftJoin(
            tenantTables.storageMetadata,
            eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
          )
          .where(
            and(
              eq(tenantTables.documents.folderId, folderId),
              eq(tenantTables.documents.isArchived, false),
            ),
          );

        // Fetch owner names from tenant userProfiles (avoids cross-DB call to global)
        if (dbDocs.length > 0) {
          const ownerIds = [...new Set(dbDocs.map((d) => d.ownerId))];
          const tenantDb = await getTenantDB();
          const ownerResults = await tenantDb
            .select({
              userId: tenantTables.userProfiles.userId,
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.userProfiles)
            .where(inArray(tenantTables.userProfiles.userId, ownerIds));

          const ownerMap = new Map(ownerResults.map((u) => [u.userId, u]));
          dbDocs = dbDocs.map((doc) => {
            const owner = ownerMap.get(doc.ownerId);
            return {
              ...doc,
              ownerFirstName: owner?.firstName ?? null,
              ownerLastName: owner?.lastName ?? null,
            };
          });
        }

        await useLogger(LoggerLevels.debug, {
          message: "Retrieved direct child documents for public access",
          section: loggerAppSections.DEBUG,
          messageKey: "folder_permission_public_documents",
          details: {
            folderId,
            documentCount: dbDocs.length,
          },
        });
      } else {
        // Internal user access: return all documents recursively
        // Use type-safe iterative approach instead of recursive CTE
        const { DocumentFolderCrudHelpers } = await import("./folder-crud.helpers.ts");

        // Get all descendant folder IDs (type-safe, iterative)
        // userId is guaranteed to be non-null for internal access (isPublicAccess = false)
        const descendantIds = await DocumentFolderCrudHelpers.getDescendantFolderIds(
          folderId,
          context.userId!,
        );

        // Include the root folder itself
        const allFolderIds = [folderId, ...descendantIds];

        // Query documents in all folders with a single query (tenant DB only)
        dbDocs = await (await getTenantDB())
          .select({
            id: tenantTables.documents.id,
            name: tenantTables.documents.name,
            description: tenantTables.documents.description,
            folderId: tenantTables.documents.folderId,
            ownerId: tenantTables.documents.ownerId,
            contentType: tenantTables.documents.contentType,
            isArchived: tenantTables.documents.isArchived,
            archivedAt: tenantTables.documents.archivedAt,
            downloadCount: tenantTables.documents.downloadCount,
            viewCount: tenantTables.documents.viewCount,
            lastAccessedAt: tenantTables.documents.lastAccessedAt,
            metadata: tenantTables.documents.metadata,
            createdAt: tenantTables.documents.createdAt,
            updatedAt: tenantTables.documents.updatedAt,
            folderName: tenantTables.documentFolders.name,
            ownerFirstName: sql<string | null>`NULL`.as("ownerFirstName"),
            ownerLastName: sql<string | null>`NULL`.as("ownerLastName"),
            favoriteDocumentId: tenantTables.documentFavorites.documentId,
            thumbnailPath: tenantTables.storageMetadata.thumbnailPath,
            originalFileSize: tenantTables.storageMetadata.originalFileSize,
          })
          .from(tenantTables.documents)
          .leftJoin(
            tenantTables.documentFolders,
            eq(tenantTables.documents.folderId, tenantTables.documentFolders.id),
          )
          .leftJoin(
            tenantTables.storageMetadata,
            eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
          )
          .leftJoin(
            tenantTables.documentFavorites,
            and(
              eq(tenantTables.documentFavorites.documentId, tenantTables.documents.id),
              eq(tenantTables.documentFavorites.userId, context.userId!),
            ),
          )
          .where(
            and(
              inArray(tenantTables.documents.folderId, allFolderIds),
              eq(tenantTables.documents.isArchived, false),
            ),
          )
          .orderBy(desc(tenantTables.documents.createdAt));

        // Fetch owner names from tenant userProfiles (avoids cross-DB call to global)
        if (dbDocs.length > 0) {
          const ownerIds = [...new Set(dbDocs.map((d) => d.ownerId))];
          const tenantDb = await getTenantDB();
          const ownerResults = await tenantDb
            .select({
              userId: tenantTables.userProfiles.userId,
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.userProfiles)
            .where(inArray(tenantTables.userProfiles.userId, ownerIds));

          const ownerMap = new Map(ownerResults.map((u) => [u.userId, u]));
          dbDocs = dbDocs.map((doc) => {
            const owner = ownerMap.get(doc.ownerId);
            return {
              ...doc,
              ownerFirstName: owner?.firstName ?? null,
              ownerLastName: owner?.lastName ?? null,
            };
          });
        }

        await useLogger(LoggerLevels.debug, {
          message: "Retrieved recursive documents for internal user access",
          section: loggerAppSections.DEBUG,
          messageKey: "folder_permission_recursive_documents",
          details: {
            folderId,
            userId: context.userId,
            documentCount: dbDocs.length,
            folderCount: allFolderIds.length,
          },
        });
      }

      // Populate tags for all documents
      const { getDocumentTagService } = await import("@services/documents-tags/index.ts");
      const tagService = getDocumentTagService();
      const documentIds = dbDocs.map((d: { id: string }) => d.id);
      const tagsByDocument = await tagService.getTagsForDocuments(documentIds);

      // Merge tags into documents (favorites already loaded via JOIN)
      const documentsWithTags: IDocumentResponse[] = dbDocs.map((dbDoc) => {
        // Construct owner name from firstName and lastName
        const ownerName = `${dbDoc.ownerFirstName || ""} ${dbDoc.ownerLastName || ""}`.trim();

        return {
          id: dbDoc.id,
          name: dbDoc.name,
          description: dbDoc.description,
          folderId: dbDoc.folderId,
          ownerId: dbDoc.ownerId,
          contentType: dbDoc.contentType,
          isFavorite: dbDoc.favoriteDocumentId !== null,
          isArchived: dbDoc.isArchived,
          archivedAt: dbDoc.archivedAt,
          downloadCount: dbDoc.downloadCount,
          viewCount: dbDoc.viewCount,
          lastAccessedAt: dbDoc.lastAccessedAt,
          tags: tagsByDocument[dbDoc.id] || [],
          metadata: (dbDoc.metadata as Record<string, unknown>) ?? {},
          createdAt: dbDoc.createdAt,
          updatedAt: dbDoc.updatedAt,
          folderName: dbDoc.folderName || null,
          ownerName,
          thumbnailUrl: dbDoc.thumbnailPath ? `/api/documents/${dbDoc.id}/preview` : null,
          originalFileSize: dbDoc.originalFileSize,
        };
      });

      return documentsWithTags;
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Error getting accessible documents",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_documents_error",
        details: { folderId, context, error },
      });
      throw error;
    }
  }

  /**
   * Gets all accessible subfolders in a folder
   *
   * For internal users: Returns all subfolders recursively
   * For public access: Returns empty array (public shares don't grant subfolder access)
   *
   * @param folderId - Folder ID
   * @param context - Access context (user ID, access method, etc.)
   * @returns Promise<IDocumentFolder[]> - Array of accessible subfolders
   *
   * @example
   * ```typescript
   * const service = new FolderPermissionService();
   * // Internal user access
   * const folders = await service.getAccessibleSubfolders('folder_123', {
   *   userId: 'user_456',
   *   isPublicAccess: false,
   *   accessMethod: 'internal_share'
   * });
   *
   * // Public access (returns empty array)
   * const publicFolders = await service.getAccessibleSubfolders('folder_123', {
   *   userId: null,
   *   isPublicAccess: true,
   *   accessMethod: 'public_share'
   * });
   * ```
   */
  async getAccessibleSubfolders(
    folderId: string,
    context: IFolderAccessContext,
  ): Promise<IDocumentFolder[]> {
    try {
      if (context.isPublicAccess) {
        // Public access: return empty array (no subfolder access)
        await useLogger(LoggerLevels.debug, {
          message: "Public access does not grant subfolder access",
          section: loggerAppSections.DEBUG,
          messageKey: "folder_permission_public_no_subfolders",
          details: { folderId },
        });

        return [];
      } else {
        // Internal user access: return all subfolders recursively
        // Use type-safe iterative approach instead of recursive CTE
        const { DocumentFolderCrudHelpers } = await import("./folder-crud.helpers.ts");

        // Get all descendant folders (type-safe, iterative)
        // userId is guaranteed to be non-null for internal access (isPublicAccess = false)
        const envId = context.environmentId ?? "";
        const descendants = await DocumentFolderCrudHelpers.getAllDescendants(
          folderId,
          context.userId!,
          envId,
        );

        await useLogger(LoggerLevels.debug, {
          message: "Retrieved recursive subfolders for internal user access",
          section: loggerAppSections.DEBUG,
          messageKey: "folder_permission_recursive_subfolders",
          details: {
            folderId,
            userId: context.userId,
            subfolderCount: descendants.length,
          },
        });

        return descendants;
      }
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Error getting accessible subfolders",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_permission_subfolders_error",
        details: { folderId, context, error },
      });
      throw error;
    }
  }

  /**
   * Batch checks folder access for multiple folders for a single user
   *
   * More efficient than calling checkFolderAccess multiple times as it:
   * - Fetches all folder ownership and sharing data in fewer queries
   * - Leverages cache for already-cached permissions
   * - Reduces database round trips
   *
   * @param folderIds - Array of folder IDs to check
   * @param userId - The user ID requesting access
   * @param environmentId - The environment ID
   * @param requiredPermission - The minimum permission level required
   * @returns Promise<Map<string, boolean>> - Map of folderId to access result
   */
  async batchCheckFolderAccess(
    folderIds: string[],
    userId: string,
    environmentId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>> {
    return await tracedWithServiceErrorHandling(
      "DocumentFolderPermissionService.batchCheckFolderAccess",
      {
        service: "DocumentFolderPermissionService",
        method: "batchCheckFolderAccess",
        section: loggerAppSections.DOCUMENTS,
        details: { userId, environmentId, folderCount: folderIds.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["folder_count"] = folderIds.length;
        span.attributes["required_level"] = requiredPermission;

        const result = new Map<string, boolean>();

        if (folderIds.length === 0) {
          return result;
        }

        // Check cache first
        const uncachedFolderIds: string[] = [];
        for (const folderId of folderIds) {
          if (this.cacheService) {
            const cachedPermission = await this.cacheService.getCachedPermission(
              folderId,
              userId,
            );
            if (cachedPermission !== null) {
              const hasAccess = cachedPermission !== -1 &&
                permissionLevelMeets(cachedPermission as DB_ENUM_PERMISSION_ACCESS_LEVEL, requiredPermission);
              result.set(folderId, hasAccess);
              continue;
            }
          }
          uncachedFolderIds.push(folderId);
        }

        if (uncachedFolderIds.length === 0) {
          return result;
        }

        // Ultra-optimized: Single comprehensive query for all permissions
        const permissionData = await traced("batchCheckFolderAccess.dbQueryComprehensive", "db.query", async (dbSpan) => {
          const { inArray } = await import("drizzle-orm");

          const queryResult = await (await getTenantDB(environmentId))
            .select({
              folderId: tenantTables.documentFolders.id,
              ownerId: tenantTables.documentFolders.ownerId,
              sharedPermissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
              isActive: tenantTables.documentFoldersSharedUsers.isActive,
            })
            .from(tenantTables.documentFolders)
            .leftJoin(
              tenantTables.documentFoldersSharedUsers,
              and(
                eq(tenantTables.documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            )
            .where(
              and(
                inArray(tenantTables.documentFolders.id, uncachedFolderIds),
              ),
            );

          dbSpan.attributes["permission_records_found"] = queryResult.length;
          return queryResult;
        });

        // Process results in memory (much faster than individual queries)
        for (const row of permissionData) {
          let hasAccess = false;
          let permissionLevel: string | number = -1;

          // Check ownership
          if (row.ownerId === userId) {
            permissionLevel = DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN;
            hasAccess = permissionLevelMeets(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, requiredPermission);
          } else if (row.sharedPermissionLevel !== null) {
            // Check shared access
            permissionLevel = row.sharedPermissionLevel;
            hasAccess = permissionLevelMeets(permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL, requiredPermission);
          }

          // Cache the result
          if (this.cacheService) {
            await this.cacheService.cachePermission(row.folderId, userId, permissionLevel);
          }

          result.set(row.folderId, hasAccess);
        }

        span.attributes["cached_count"] = folderIds.length - uncachedFolderIds.length;
        span.attributes["queried_count"] = uncachedFolderIds.length;

        await useLogger(LoggerLevels.debug, {
          message: "Batch folder permission check completed",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "folder_batch_permission_check",
          details: {
            userId,
            environmentId,
            totalFolders: folderIds.length,
            cachedCount: folderIds.length - uncachedFolderIds.length,
            queriedCount: uncachedFolderIds.length,
            requiredPermission,
          },
        });

        return result;
      },
    );
  }
}
