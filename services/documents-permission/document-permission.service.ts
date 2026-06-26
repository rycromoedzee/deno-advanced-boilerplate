/**
 * @file services/documents-permission/document-permission.service.ts
 * @description Document-specific permission service — delegates to the generic PermissionService
 *
 * This service is now a thin wrapper around the generic PermissionService from
 * @services/encryption. It preserves the existing public API for backward
 * compatibility while centralizing all permission logic in the encryption layer.
 *
 * Permission Hierarchy (from lowest to highest):
 * - READ (0): View only
 * - COMMENT (1): View + comment
 * - WRITE (2): View + comment + edit
 * - DOWNLOAD (3): View + comment + download
 * - SHARE (4): View + comment + download + share
 * - ADMIN (5): Full access including delete and permission management
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { PermissionService } from "@services/encryption/permission.service.ts";
import { tenantTables } from "@db/index.ts";

const DOC_TABLE_CONFIG = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
} as const;

export class DocumentPermissionService {
  private permissionService: PermissionService;

  constructor() {
    this.permissionService = new PermissionService(
      DOC_TABLE_CONFIG,
    );
  }

  /**
   * Checks if a user has access to a document with at least the required permission level.
   *
   * Pure read — no side effects. (The optional `userMasterKey` that previously
   * triggered lazy ASYMMETRIC→USER_CONTROLLED key conversion was dead plumbing —
   * no caller passed it — and has been removed; see backlog item #2.)
   */
  async checkAccess(
    documentId: string,
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    return await this.permissionService.checkAccess(
      documentId,
      userId,
      requiredPermission,
    );
  }

  /**
   * Retrieves the user's permission level for a document.
   * Returns null if the user has no access.
   */
  async getAccessLevel(
    documentId: string,
    userId: string,
  ): Promise<DB_ENUM_PERMISSION_ACCESS_LEVEL | null> {
    return await this.permissionService.getAccessLevel(documentId, userId);
  }

  /**
   * Convenience alias for checkAccess.
   */
  async hasPermission(
    documentId: string,
    userId: string,
    permission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<boolean> {
    return await this.checkAccess(documentId, userId, permission);
  }

  /**
   * Compares permission levels (userLevel >= requiredLevel).
   */
  permissionLevelMeets(
    userLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
    requiredLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): boolean {
    return this.permissionService.permissionLevelMeets(userLevel, requiredLevel);
  }

  /**
   * Returns true if the user has any active access to the document.
   */
  async hasAnyAccess(documentId: string, userId: string): Promise<boolean> {
    return await this.permissionService.hasAnyAccess(documentId, userId);
  }

  /**
   * Batch checks access for multiple documents for a single user.
   * Uses a single DB query for uncached resources.
   */
  async batchCheckAccess(
    documentIds: string[],
    userId: string,
    requiredPermission: DB_ENUM_PERMISSION_ACCESS_LEVEL,
  ): Promise<Map<string, boolean>> {
    return await this.permissionService.batchCheckAccess(documentIds, userId, requiredPermission);
  }

  /**
   * Batch retrieves access levels for multiple documents for a single user.
   */
  async batchGetAccessLevels(
    documentIds: string[],
    userId: string,
  ): Promise<Map<string, DB_ENUM_PERMISSION_ACCESS_LEVEL | null>> {
    return await this.permissionService.batchGetAccessLevels(documentIds, userId);
  }
}
