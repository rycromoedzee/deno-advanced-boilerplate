/**
 * @file services/documents-permission/permission-inheritance.service.ts
 * @description Service for automatic permission inheritance in shared folders
 *
 * This service handles automatic sharing of documents and folders when they are
 * created in shared folders. It ensures that new content inherits the sharing
 * configuration from parent folders.
 */

import { and, eq, inArray } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DocumentEncryptionSharingService } from "@services/documents-encryption/encryption-sharing.service.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import type { IPermissionInheritanceResult } from "@interfaces/documents.ts";
import type { IDocumentFolderPermissionService } from "@interfaces/document-folder-permission.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { IFolderSharedUser } from "@models/documents/folder-sharing.model.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Document Permission Inheritance Service
 */
export class DocumentPermissionInheritanceService {
  private encryptionSharingService = new DocumentEncryptionSharingService();
  // Held as the interface contract (not the concrete class) to avoid importing
  // the document-folders domain here, which would re-introduce the cross-domain
  // import cycle. Structurally satisfied by DocumentFolderPermissionService.
  private folderPermissionService!: IDocumentFolderPermissionService;
  private dataAccessService = new DataAccessService({
    tableName: tenantTables.documentsDataKeys,
    resourceIdColumn: "documentId",
  });
  private readonly BATCH_SIZE = 100;
  private readonly MAX_RECURSION_DEPTH = 10;

  async handleNewDocumentInheritance(
    documentId: string,
    folderId: string,
    ownerId: string,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<IPermissionInheritanceResult[]> {
    try {
      const db = await getTenantDB();
      const [folder] = await db
        .select({
          id: tenantTables.documentFolders.id,
          ownerId: tenantTables.documentFolders.ownerId,
          hasInternalSharing: tenantTables.documentFolders.hasInternalSharing,
          autoShareNewContent: tenantTables.documentFolders.autoShareNewContent,
        })
        .from(tenantTables.documentFolders)
        .where(
          and(
            eq(tenantTables.documentFolders.id, folderId),
          ),
        )
        .limit(1);

      if (!folder) {
        return [];
      }

      if (!folder.hasInternalSharing || !folder.autoShareNewContent) {
        return [];
      }

      const sharedUsers = await db
        .select({
          id: tenantTables.documentFoldersSharedUsers.id,
          userId: tenantTables.documentFoldersSharedUsers.userId,
          permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
          folderId: tenantTables.documentFoldersSharedUsers.folderId,
          grantedById: tenantTables.documentFoldersSharedUsers.grantedById,
          grantedAt: tenantTables.documentFoldersSharedUsers.grantedAt,
          isActive: tenantTables.documentFoldersSharedUsers.isActive,
          createdAt: tenantTables.documentFoldersSharedUsers.createdAt,
          updatedAt: tenantTables.documentFoldersSharedUsers.updatedAt,
        })
        .from(tenantTables.documentFoldersSharedUsers)
        .where(
          and(
            eq(tenantTables.documentFoldersSharedUsers.folderId, folderId),
            eq(tenantTables.documentFoldersSharedUsers.isActive, true),
          ),
        );

      const recipients: { userId: string; permissionLevel: string }[] = [...sharedUsers];

      if (folder.ownerId !== ownerId) {
        recipients.push({
          userId: folder.ownerId,
          permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
        });
      }

      if (recipients.length === 0) {
        return [];
      }

      const results: IPermissionInheritanceResult[] = [];

      for (const recipient of recipients) {
        if (recipient.userId === ownerId) {
          continue;
        }

        try {
          const userResults = await this.encryptionSharingService
            .batchShareDocuments(
              [documentId],
              ownerId,
              recipient.userId,
              recipient.permissionLevel,
              ownerUserMasterKey,
            );

          results.push(...userResults);
        } catch (error) {
          results.push({
            documentId,
            originalEncryptionMode: -1,
            success: false,
            action: "error",
            error: error instanceof Error ? error.message : "Unknown error",
          });
        }
      }

      return results;
    } catch (error) {
      throw error;
    }
  }

  async handleNewSubfolderInheritance(
    subfolderId: string,
    parentFolderId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const db = await getTenantDB();
      const [parentFolder] = await db
        .select({
          ownerId: tenantTables.documentFolders.ownerId,
        })
        .from(tenantTables.documentFolders)
        .where(eq(tenantTables.documentFolders.id, parentFolderId))
        .limit(1);

      const parentSharedUsers = await db
        .select({
          userId: tenantTables.documentFoldersSharedUsers.userId,
          permissionLevel: tenantTables.documentFoldersSharedUsers.permissionLevel,
          grantedById: tenantTables.documentFoldersSharedUsers.grantedById,
        })
        .from(tenantTables.documentFoldersSharedUsers)
        .where(
          and(
            eq(tenantTables.documentFoldersSharedUsers.folderId, parentFolderId),
            eq(tenantTables.documentFoldersSharedUsers.isActive, true),
          ),
        );

      const usersToShare: { userId: string; permissionLevel: string; grantedById: string }[] = [...parentSharedUsers];

      if (parentFolder && parentFolder.ownerId !== ownerId) {
        usersToShare.push({
          userId: parentFolder.ownerId,
          permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
          grantedById: ownerId,
        });
      }

      if (usersToShare.length === 0) {
        return;
      }

      const now = Math.floor(getTimeNow() / 1000);

      await Promise.all(
        usersToShare.map((sharedUser) =>
          databaseCreateWithRetry(
            async (generatedId) => {
              const [record] = await db
                .insert(tenantTables.documentFoldersSharedUsers)
                .values({
                  id: generatedId,
                  folderId: subfolderId,
                  userId: sharedUser.userId,
                  permissionLevel: sharedUser.permissionLevel,
                  grantedById: sharedUser.grantedById,
                  grantedAt: now,
                  isActive: true,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();

              if (!record) {
                throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              }

              return record;
            },
            generateIdRandomWithTimestamp,
          )
        ),
      );

      await db
        .update(tenantTables.documentFolders)
        .set({
          hasInternalSharing: true,
          updatedAt: now,
        })
        .where(eq(tenantTables.documentFolders.id, subfolderId));
    } catch (error) {
      throw error;
    }
  }

  async applyToExistingDocuments(
    folderId: string,
    sharedUsers: IFolderSharedUser[],
    ownerUserMasterKey?: Uint8Array,
    sharingUserId?: string,
  ): Promise<IPermissionInheritanceResult[]> {
    try {
      const db = await getTenantDB();
      const folderDocuments = await db
        .select({
          id: tenantTables.documents.id,
          ownerId: tenantTables.documents.ownerId,
        })
        .from(tenantTables.documents)
        .where(
          and(
            eq(tenantTables.documents.folderId, folderId),
          ),
        );

      if (folderDocuments.length === 0) {
        return [];
      }

      if (ownerUserMasterKey && sharingUserId) {
        for (const doc of folderDocuments) {
          if (doc.ownerId !== sharingUserId) {
            continue;
          }
          try {
            await this.dataAccessService.ensureUserControlledDataKey(
              doc.id,
              doc.ownerId,
              ownerUserMasterKey,
            );
          } catch (_error) {
            // Intentionally empty - errors during key sharing are non-critical
          }
        }
      }

      const allResults: IPermissionInheritanceResult[] = [];
      const docsByOwner = new Map<string, string[]>();
      for (const doc of folderDocuments) {
        const existing = docsByOwner.get(doc.ownerId) || [];
        existing.push(doc.id);
        docsByOwner.set(doc.ownerId, existing);
      }

      for (const sharedUser of sharedUsers) {
        for (const [docOwnerId, documentIds] of docsByOwner) {
          if (sharedUser.userId === docOwnerId) {
            continue;
          }

          try {
            const userResults = await this.encryptionSharingService
              .batchShareDocuments(
                documentIds,
                docOwnerId,
                sharedUser.userId,
                sharedUser.permissionLevel,
                sharingUserId && docOwnerId === sharingUserId ? ownerUserMasterKey : undefined,
              );

            allResults.push(...userResults);
          } catch (error) {
            documentIds.forEach((docId) => {
              allResults.push({
                documentId: docId,
                originalEncryptionMode: -1,
                success: false,
                action: "error",
                error: error instanceof Error ? error.message : "Unknown error",
              });
            });
          }
        }
      }

      return allResults;
    } catch (error) {
      throw error;
    }
  }

  async applyToSubfolders(
    folderId: string,
    sharedUsers: IFolderSharedUser[],
  ): Promise<number> {
    try {
      const db = await getTenantDB();
      const { DocumentFolderCrudHelpers } = await import("@services/document-folders/folder-crud.helpers.ts");

      const [folder] = await db
        .select({
          ownerId: tenantTables.documentFolders.ownerId,
        })
        .from(tenantTables.documentFolders)
        .where(eq(tenantTables.documentFolders.id, folderId))
        .limit(1);

      if (!folder) {
        return 0;
      }

      // We need environmentId here but it's per-tenant, so we can pass anything or update getAllDescendants
      const allDescendants = await DocumentFolderCrudHelpers.getAllDescendants(
        folderId,
        folder.ownerId,
        "current", // Dummy environmentId since it's already in the correct Tenant DB
      );

      const subfolders = allDescendants.map((descendantFolder) => ({
        id: descendantFolder.id,
        depth: 0,
      }));

      if (subfolders.length === 0) {
        return 0;
      }

      const now = Math.floor(getTimeNow() / 1000);
      let totalShared = 0;

      for (let i = 0; i < subfolders.length; i += this.BATCH_SIZE) {
        const batch = subfolders.slice(i, i + this.BATCH_SIZE);
        const insertPromises = [];

        for (const subfolder of batch) {
          for (const sharedUser of sharedUsers) {
            insertPromises.push(
              databaseCreateWithRetry(
                async (generatedId) => {
                  try {
                    const [record] = await db
                      .insert(tenantTables.documentFoldersSharedUsers)
                      .values({
                        id: generatedId,
                        folderId: subfolder.id,
                        userId: sharedUser.userId,
                        permissionLevel: sharedUser.permissionLevel as unknown as string,
                        grantedById: sharedUser.grantedById,
                        grantedAt: now,
                        isActive: true,
                        createdAt: now,
                        updatedAt: now,
                      })
                      .returning();

                    return record;
                  } catch (error) {
                    if (error instanceof Error && error.message.includes("unique")) {
                      return null;
                    }
                    throw error;
                  }
                },
                generateIdRandomWithTimestamp,
              ),
            );
          }
        }

        if (insertPromises.length > 0) {
          await Promise.all(insertPromises);
        }

        const subfolderIds = batch.map((sf) => sf.id);
        await db
          .update(tenantTables.documentFolders)
          .set({
            hasInternalSharing: true,
            updatedAt: now,
          })
          .where(
            inArray(tenantTables.documentFolders.id, subfolderIds),
          );

        totalShared += batch.length;
      }

      return totalShared;
    } catch (error) {
      throw error;
    }
  }

  async revokeFromDocumentsAndSubfolders(
    folderId: string,
    userId: string,
  ): Promise<{ subfoldersRevoked: number; documentsRevoked: number }> {
    try {
      const db = await getTenantDB();
      const { DocumentFolderCrudHelpers } = await import("@services/document-folders/folder-crud.helpers.ts");

      const [folder] = await db
        .select({
          ownerId: tenantTables.documentFolders.ownerId,
        })
        .from(tenantTables.documentFolders)
        .where(eq(tenantTables.documentFolders.id, folderId))
        .limit(1);

      if (!folder) {
        return { subfoldersRevoked: 0, documentsRevoked: 0 };
      }

      const allDescendants = await DocumentFolderCrudHelpers.getAllDescendants(
        folderId,
        folder.ownerId,
        "current",
      );

      const subfolderId_list = allDescendants.map((f) => f.id);
      let subfoldersRevoked = 0;

      if (subfolderId_list.length > 0) {
        for (let i = 0; i < subfolderId_list.length; i += this.BATCH_SIZE) {
          const batch = subfolderId_list.slice(i, i + this.BATCH_SIZE);
          await db
            .update(tenantTables.documentFoldersSharedUsers)
            .set({ isActive: false })
            .where(
              and(
                inArray(tenantTables.documentFoldersSharedUsers.folderId, batch),
                eq(tenantTables.documentFoldersSharedUsers.userId, userId),
                eq(tenantTables.documentFoldersSharedUsers.isActive, true),
              ),
            );
          subfoldersRevoked += batch.length;
        }
      }

      const allFolderIds = [folderId, ...subfolderId_list];
      let documentsRevoked = 0;

      for (let i = 0; i < allFolderIds.length; i += this.BATCH_SIZE) {
        const folderBatch = allFolderIds.slice(i, i + this.BATCH_SIZE);

        const folderDocuments = await db
          .select({ id: tenantTables.documents.id })
          .from(tenantTables.documents)
          .where(
            inArray(tenantTables.documents.folderId, folderBatch),
          );

        if (folderDocuments.length === 0) continue;

        const documentIds = folderDocuments.map((d: { id: string }) => d.id);

        for (let j = 0; j < documentIds.length; j += this.BATCH_SIZE) {
          const docBatch = documentIds.slice(j, j + this.BATCH_SIZE);
          const now = Math.floor(getTimeNow() / 1000);
          await db
            .update(tenantTables.documentsDataKeys)
            .set({
              isActive: false,
              revokedAt: now,
              updatedAt: now,
            })
            .where(
              and(
                inArray(tenantTables.documentsDataKeys.documentId, docBatch),
                eq(tenantTables.documentsDataKeys.userId, userId),
                eq(tenantTables.documentsDataKeys.isActive, true),
              ),
            );
          documentsRevoked += docBatch.length;
        }
      }

      return { subfoldersRevoked, documentsRevoked };
    } catch (error) {
      throw error;
    }
  }
}
