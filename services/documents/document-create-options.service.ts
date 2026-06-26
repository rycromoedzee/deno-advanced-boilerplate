/**
 * @file services/documents/document-create-options.service.ts
 * @description Service for fetching document creation options
 *
 * Provides available options for creating documents:
 * - Folders (owned or with write access)
 * - Tags (owned by user)
 * - Users (for sharing, in same environment)
 */

import { and, eq, gte } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import type { IDocumentCreateOptionsResponse, IFolderOption, ISharedUserOption } from "@models/documents/document-create-options.model.ts";
import type { IDocumentTag } from "@models/documents/tag.model.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

export class DocumentCreateOptionsService {
  /**
   * Gets all available options for creating a document
   *
   * @param userId - Current user ID
   * @param environmentId - Current environment ID
   * @returns Promise with folders, tags, and users available
   */
  async getCreateOptions(
    userId: string,
    environmentId: string,
  ): Promise<IDocumentCreateOptionsResponse> {
    const [folders, tags, users] = await Promise.all([
      this.getAvailableFolders(userId, environmentId),
      this.getAvailableTags(userId),
      this.getAvailableUsers(userId, environmentId),
    ]);

    return {
      folders,
      tags,
      sharedUsers: users,
    };
  }

  /**
   * Gets folders available for document placement
   * Includes:
   * - Folders owned by the user
   * - Folders shared with at least WRITE permission
   *
   * @param userId - Current user ID
   * @param environmentId - Current environment ID
   * @returns Promise with array of folder options
   */
  private async getAvailableFolders(
    userId: string,
    environmentId: string,
  ): Promise<IFolderOption[]> {
    // Get owned folders
    const tenantDb = await getTenantDB(environmentId);

    const ownedFolders = await tenantDb
      .select({
        id: tenantTables.documentFolders.id,
        name: tenantTables.documentFolders.name,
        description: tenantTables.documentFolders.description,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
        ownerId: tenantTables.documentFolders.ownerId,
        color: tenantTables.documentFolders.color,
        icon: tenantTables.documentFolders.icon,
        isArchived: tenantTables.documentFolders.isArchived,
        archivedAt: tenantTables.documentFolders.archivedAt,
        createdAt: tenantTables.documentFolders.createdAt,
        updatedAt: tenantTables.documentFolders.updatedAt,
      })
      .from(tenantTables.documentFolders)
      .where(
        and(
          eq(tenantTables.documentFolders.ownerId, userId),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    // Get shared folders with at least WRITE permission
    const sharedFolders = await tenantDb
      .select({
        id: tenantTables.documentFolders.id,
        name: tenantTables.documentFolders.name,
        description: tenantTables.documentFolders.description,
        parentFolderId: tenantTables.documentFolders.parentFolderId,
        ownerId: tenantTables.documentFolders.ownerId,
        color: tenantTables.documentFolders.color,
        icon: tenantTables.documentFolders.icon,
        isArchived: tenantTables.documentFolders.isArchived,
        archivedAt: tenantTables.documentFolders.archivedAt,
        createdAt: tenantTables.documentFolders.createdAt,
        updatedAt: tenantTables.documentFolders.updatedAt,
        permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
      })
      .from(tenantTables.documentFolders)
      .innerJoin(
        tenantTables.documentFoldersSharedUsers,
        eq(tenantTables.documentFoldersSharedUsers.folderId, tenantTables.documentFolders.id),
      )
      .where(
        and(
          eq(tenantTables.documentFoldersSharedUsers.userId, userId),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
          gte(tenantTables.documentFoldersSharedUsers.permissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE),
          eq(tenantTables.documentFolders.isArchived, false),
        ),
      );

    // Combine and format results
    const ownedFolderOptions: IFolderOption[] = ownedFolders.map((folder) => ({
      ...folder,
      color: folder.color ?? "#3b82f6", // Default blue color
      isOwned: true,
    }));

    const sharedFolderOptions: IFolderOption[] = sharedFolders.map((folder) => ({
      id: folder.id,
      name: folder.name,
      description: folder.description,
      parentFolderId: folder.parentFolderId,
      ownerId: folder.ownerId,
      color: folder.color ?? "#3b82f6", // Default blue color
      icon: folder.icon,
      isArchived: folder.isArchived,
      archivedAt: folder.archivedAt,
      createdAt: folder.createdAt,
      updatedAt: folder.updatedAt,
      isOwned: false,
      permissionLevel: folder.permissionLevel as unknown as number | undefined,
    }));

    // Combine and deduplicate (user might own a folder that's also shared)
    const folderMap = new Map<string, IFolderOption>();

    // Owned folders take precedence
    for (const folder of ownedFolderOptions) {
      folderMap.set(folder.id, folder);
    }

    // Add shared folders if not already owned
    for (const folder of sharedFolderOptions) {
      if (!folderMap.has(folder.id)) {
        folderMap.set(folder.id, folder);
      }
    }

    return Array.from(folderMap.values()).sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Gets tags owned by the current user
   *
   * @param userId - Current user ID
   * @returns Promise with array of tags
   */
  private async getAvailableTags(userId: string): Promise<IDocumentTag[]> {
    const tenantDb = await getTenantDB();
    const tags = await tenantDb
      .select({
        id: tenantTables.documentTags.id,
        name: tenantTables.documentTags.name,
        color: tenantTables.documentTags.color,
        description: tenantTables.documentTags.description,
        userId: tenantTables.documentTags.userId,
        createdById: tenantTables.documentTags.createdById,
        createdByName: tenantTables.documentTags.createdByName,
        usageCount: tenantTables.documentTags.usageCount,
        createdAt: tenantTables.documentTags.createdAt,
        updatedAt: tenantTables.documentTags.updatedAt,
      })
      .from(tenantTables.documentTags)
      .where(eq(tenantTables.documentTags.userId, userId))
      .orderBy(tenantTables.documentTags.name);

    return tags.map((tag) => ({
      ...tag,
      color: tag.color ?? "#6b7280", // Default gray color
    }));
  }

  /**
   * Gets users available for sharing
   * Includes users in the same environment that are active and/or signed up
   * Excludes the current user
   *
   * @param userId - Current user ID
   * @param environmentId - Current environment ID
   * @returns Promise with array of users
   */
  private async getAvailableUsers(
    userId: string,
    environmentId: string,
  ): Promise<ISharedUserOption[]> {
    const tenantDb = await getTenantDB(environmentId);
    const users = await tenantDb
      .select({
        id: tenantTables.userProfiles.userId,
        firstName: tenantTables.userProfiles.firstName,
        lastName: tenantTables.userProfiles.lastName,
        email: tenantTables.userProfiles.email,
      })
      .from(tenantTables.userProfiles)
      .orderBy(tenantTables.userProfiles.firstName, tenantTables.userProfiles.lastName);

    return users
      .filter((user) => user.id !== userId && user.email !== null && user.email !== "")
      .map((user) => ({
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email!,
      }));
  }
}

/**
 * Singleton instance getter
 */
let instance: DocumentCreateOptionsService | null = null;

export function getDocumentCreateOptionsService(): DocumentCreateOptionsService {
  if (!instance) {
    instance = new DocumentCreateOptionsService();
  }
  return instance;
}
