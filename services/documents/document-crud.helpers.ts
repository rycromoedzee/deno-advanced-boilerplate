/**
 * @file services/documents/document-crud.helpers.ts
 * @description Static utility functions for document operations
 *
 * This module contains helper functions used across document services
 * for reusability and better code organization.
 */

import { and, eq, sql } from "@deps";

import { traced } from "@services/tracing/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentFolderPermissionService } from "@services/document-folders/singletons.ts";
import type { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import type { DocumentFolderPermissionService } from "@services/document-folders/folder-permission.service.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * DocumentCrudHelpers
 *
 * Static utility functions for document operations including:
 * - Validation
 * - Sanitization
 * - Query building
 * - Pagination calculation
 * - Permission checking
 * - Access tracking
 */
export class DocumentCrudHelpers {
  /**
   * Increments the view count for a document
   * @param id - Document ID
   * @returns Promise<void>
   */
  public static async incrementViewCount(id: string): Promise<void> {
    const db = await getTenantDB();
    try {
      await db
        .update(tenantTables.documents)
        .set({
          viewCount: sql`${tenantTables.documents.viewCount} + 1`,
          lastAccessedAt: Math.floor(getTimeNow() / 1000),
          updatedAt: Math.floor(getTimeNow() / 1000),
        })
        .where(eq(tenantTables.documents.id, id));
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Error incrementing view count",
        section: loggerAppSections.DEBUG,
        messageKey: "document_increment_view_error",
        details: { documentId: id, error },
      });
      // Don't throw - view count increment failure shouldn't break the request
    }
  }

  /**
   * Increments the download count for a document
   * @param id - Document ID
   * @returns Promise<void>
   */
  public static async incrementDownloadCount(id: string): Promise<void> {
    const db = await getTenantDB();
    try {
      await db
        .update(tenantTables.documents)
        .set({
          downloadCount: sql`${tenantTables.documents.downloadCount} + 1`,
          lastAccessedAt: Math.floor(getTimeNow() / 1000),
          updatedAt: Math.floor(getTimeNow() / 1000),
        })
        .where(eq(tenantTables.documents.id, id));
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Error incrementing download count",
        section: loggerAppSections.DEBUG,
        messageKey: "document_increment_download_error",
        details: { documentId: id, error },
      });
      // Don't throw - download count increment failure shouldn't break the request
    }
  }

  /**
   * Updates the last accessed timestamp for a document
   * @param id - Document ID
   * @returns Promise<void>
   */
  public static async updateLastAccessed(id: string): Promise<void> {
    const db = await getTenantDB();
    try {
      await db
        .update(tenantTables.documents)
        .set({
          lastAccessedAt: Math.floor(getTimeNow() / 1000),
          updatedAt: Math.floor(getTimeNow() / 1000),
        })
        .where(eq(tenantTables.documents.id, id));
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Error updating last accessed timestamp",
        section: loggerAppSections.DEBUG,
        messageKey: "document_update_last_accessed_error",
        details: { documentId: id, error },
      });
      // Don't throw - timestamp update failure shouldn't break the request
    }
  }

  /**
   * Checks if user has permission to move a document
   * Implements the permission hierarchy: Owner/Admin can move, other sharing users cannot, no access returns 404
   *
   * @param documentId - Document ID to check
   * @param userId - User ID attempting the move
   * @param environmentId - Environment ID for context
   * @param permissionService - Permission service instance (optional, will create if not provided)
   * @returns Promise<{isOwner: boolean, hasAccess: boolean, documentOwnerId: string}> - Permission result with document owner
   */
  public static async checkMovePermissions(
    documentId: string,
    userId: string,
    _environmentId: string,
    permissionService?: DocumentPermissionService,
  ): Promise<
    { isOwner: boolean; hasAccess: boolean; documentOwnerId: string }
  > {
    return await traced("checkMovePermissions", "auth", async (span) => {
      span.attributes["document_id"] = documentId;
      span.attributes["user_id"] = userId;

      const _startTime = performance.now();
      const db = await getTenantDB();
      const perms = permissionService || getDocumentPermissionService();

      try {
        const documentResult = await traced("checkMovePermissions.dbQuery", "db.query", async (dbSpan) => {
          const result = await db
            .select({
              ownerId: tenantTables.documents.ownerId,
            })
            .from(tenantTables.documents)
            .where(
              and(
                eq(tenantTables.documents.id, documentId),
              ),
            )
            .limit(1);

          dbSpan.attributes["document_found"] = result.length > 0;
          return result;
        });

        if (documentResult.length === 0) {
          span.attributes["document_found"] = false;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const documentOwnerId = documentResult[0].ownerId;
        const isOwner = documentOwnerId === userId;

        if (isOwner) {
          span.attributes["is_owner"] = true;
          span.attributes["permission_level"] = DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN;
          return { isOwner: true, hasAccess: true, documentOwnerId };
        }

        const userPermissionLevel = await perms.getAccessLevel(
          documentId,
          userId,
        );

        if (userPermissionLevel === null) {
          span.attributes["has_permission"] = false;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (userPermissionLevel !== null && permissionLevelMeets(userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          span.attributes["is_owner"] = false;
          span.attributes["has_admin_access"] = true;
          span.attributes["permission_level"] = userPermissionLevel;
          return { isOwner: false, hasAccess: true, documentOwnerId };
        }

        span.attributes["has_admin_access"] = false;
        span.attributes["permission_level"] = userPermissionLevel;
        throwHttpError("DOCUMENT.MOVE_ACCESS_DENIED");
      } catch (error) {
        throw error;
      }
    });
  }

  /**
   * Validates that the target folder exists and the user has permission to move documents into it
   *
   * @param targetFolderId - Target folder ID to validate
   * @param documentOwnerId - Owner ID of the document being moved
   * @param userId - User ID attempting the move
   * @param environmentId - Environment ID for context
   * @param folderPermissionService - Folder permission service instance (optional, will create if not provided)
   */
  public static async validateTargetFolder(
    targetFolderId: string,
    documentOwnerId: string,
    userId: string,
    _environmentId: string,
    folderPermissionService?: DocumentFolderPermissionService,
  ): Promise<void> {
    return await traced("validateTargetFolder", "auth", async (span) => {
      span.attributes["target_folder_id"] = targetFolderId;
      span.attributes["document_owner_id"] = documentOwnerId;
      span.attributes["user_id"] = userId;

      const db = await getTenantDB();
      const folderPerms = folderPermissionService || getDocumentFolderPermissionService();

      // Get folder information with proper schema
      const folderResult = await traced("validateTargetFolder.dbQuery", "db.query", async (dbSpan) => {
        const result = await db
          .select({
            id: tenantTables.documentFolders.id,
            ownerId: tenantTables.documentFolders.ownerId,
            isArchived: tenantTables.documentFolders.isArchived,
          })
          .from(tenantTables.documentFolders)
          .where(
            and(
              eq(tenantTables.documentFolders.id, targetFolderId),
              eq(tenantTables.documentFolders.isArchived, false),
            ),
          )
          .limit(1);

        dbSpan.attributes["folder_found"] = result.length > 0;
        return result;
      });

      if (folderResult.length === 0) {
        span.attributes["folder_found"] = false;
        throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
      }

      const folder = folderResult[0];
      span.attributes["folder_owner_id"] = folder.ownerId;

      if (folder.ownerId === documentOwnerId) {
        span.attributes["same_owner"] = true;
        return;
      }

      const hasAccess = await folderPerms.checkFolderAccess(
        targetFolderId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
      );

      if (!hasAccess) {
        span.attributes["folder_access_denied"] = true;
        throwHttpError("DOCUMENT.MOVE_FAILED_FOLDER_PERMISSIONS");
      }

      span.attributes["folder_access_granted"] = true;
    });
  }

  /**
   * Performs the actual database operation to move the document
   *
   * @param id - Document ID
   * @param targetFolderId - Target folder ID (null for root)
   * @param environmentId - Environment ID
   * @returns Promise<boolean> - True if successful, false otherwise
   */
  public static async performMoveOperation(
    id: string,
    targetFolderId: string | null,
    _environmentId: string,
  ): Promise<boolean> {
    return await traced("performMoveOperation", "db.query", async (span) => {
      span.attributes["document_id"] = id;
      span.attributes["target_folder_id"] = targetFolderId || "root";

      const db = await getTenantDB();

      const [updated] = await db
        .update(tenantTables.documents)
        .set({
          folderId: targetFolderId,
          updatedAt: getTimeNowForStorage(),
        })
        .where(
          and(
            eq(tenantTables.documents.id, id),
          ),
        )
        .returning();

      if (!updated) {
        span.attributes["move_failed"] = true;
        throwHttpError("DOCUMENT.MOVE_FAILED");
      }

      span.attributes["move_success"] = true;
      return true;
    });
  }
}
