/**
 * @file services/documents/document-duplicate.service.ts
 * @description Service for document duplication operations
 *
 * This service handles document duplication by copying metadata and file content.
 */

import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentTagService } from "@services/documents-tags/document-tag.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { generateIdForDocument, generateIdForStorage, generateIdRandom } from "@utils/database/id-generation/index.ts";
import { completeStoragePathForDocument } from "@constants/storage-paths.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentTagService } from "@services/documents-tags/singletons.ts";
import type { IDocumentResponse } from "@models/documents/index.ts";
import { IDuplicateDocumentInput } from "@models/documents/index.ts";

/**
 * Document Duplicate Service
 *
 * Provides document duplication functionality:
 * - Duplicate documents with metadata and file content
 * - Copy tags from original document
 * - Create new encryption keys
 * - Cache management
 */
export class DocumentDuplicateService {
  // Tenant DB obtained per-method via getTenantDB(environmentId)
  private permissionService: DocumentPermissionService;
  private tagService: DocumentTagService;

  constructor(
    permissionService?: DocumentPermissionService,
    tagService?: DocumentTagService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentPermissionService();
    this.tagService = tagService || getDocumentTagService();
  }

  /**
   * Duplicates a document by copying metadata and file content
   *
   * @param id - Document ID to duplicate
   * @param userId - ID of the user duplicating the document
   * @param environmentId - Environment ID for isolation
   * @param extraParameters - Additional parameters for duplication (name, folderId)
   * @returns Promise<IDocumentResponse> - The newly created duplicate document
   */
  async duplicate(
    id: string,
    userId: string,
    environmentId: string,
    extraParameters: IDuplicateDocumentInput,
  ): Promise<IDocumentResponse> {
    return await tracedWithServiceErrorHandling(
      "DocumentDuplicateService.duplicate",
      {
        service: "DocumentDuplicateService",
        method: "duplicate",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;

        const tenantDb = await getTenantDB(environmentId);

        const accessLevel = await this.permissionService.getAccessLevel(
          id,
          userId,
        );

        if (accessLevel === null) {
          span.attributes["document_found"] = false;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (accessLevel !== DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN) {
          span.attributes["insufficient_permissions"] = true;
          span.attributes["user_access_level"] = accessLevel;

          await useLogger(LoggerLevels.warn, {
            message: "Insufficient permissions for document duplication - admin rights required",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "document_duplicate_permission_denied",
            details: { documentId: id, userId, accessLevel },
          });

          throwHttpError("DOCUMENT.DUPLICATE_ACCESS_DENIED");
        }

        const [original] = await traced("duplicate.fetchOriginal", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .select({
              document: tenantTables.documents,
              storage: tenantTables.storageMetadata,
            })
            .from(tenantTables.documents)
            .innerJoin(
              tenantTables.storageMetadata,
              eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
            )
            .where(
              and(
                eq(tenantTables.documents.id, id),
                eq(tenantTables.documents.isArchived, false),
              ),
            )
            .limit(1);

          dbSpan.attributes["document_found"] = result.length > 0;
          return result;
        });

        if (!original) {
          span.attributes["original_not_found"] = true;
          await useLogger(LoggerLevels.error, {
            message: "Document metadata not found during duplication",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "document_duplicate_metadata_not_found",
            details: { documentId: id, userId },
          });
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // Get the encryption key for the user
        const [dataKey] = await traced("duplicate.fetchDataKey", "db.query", async (keySpan) => {
          const result = await tenantDb
            .select()
            .from(tenantTables.documentsDataKeys)
            .where(
              and(
                eq(tenantTables.documentsDataKeys.documentId, id),
                eq(tenantTables.documentsDataKeys.userId, userId),
                eq(tenantTables.documentsDataKeys.isActive, true),
              ),
            )
            .limit(1);

          keySpan.attributes["key_found"] = result.length > 0;
          return result;
        });

        if (!dataKey) {
          span.attributes["encryption_key_missing"] = true;
          await useLogger(LoggerLevels.error, {
            message: "Encryption key not found for document duplication",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "document_duplicate_encryption_key_missing",
            details: { documentId: id, userId },
          });
          throwHttpError("DOCUMENT.DECRYPTION_FAILED");
        }

        const now = getTimeNowForStorage();

        // Create new storage metadata record with retry
        const newStorageMetadata = await databaseCreateWithRetry(
          async (generatedStorageMetadataId) => {
            // Get file extension from MIME type
            const newStoragePath = completeStoragePathForDocument(environmentId, generatedStorageMetadataId, original.storage.mimeType);

            // Copy the encrypted file to the new location
            const storage = await import("@services/storage/index.ts");
            const downloadResult = await storage.getStorage().downloadFile(
              original.storage.folderPath,
            );
            await storage.getStorage().uploadFile(
              newStoragePath,
              downloadResult.stream,
            );

            const [storageRecord] = await tenantDb
              .insert(tenantTables.storageMetadata)
              .values({
                id: generatedStorageMetadataId,
                folderPath: newStoragePath,
                originalName: original.storage.originalName,
                mimeType: original.storage.mimeType,
                originalFileSize: original.storage.originalFileSize,
                encryptedFileSize: original.storage.encryptedFileSize,
                userId: userId,
                createdAt: now,
                updatedAt: now,
              })
              .returning();

            if (!storageRecord) {
              throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
            }

            return storageRecord;
          },
          generateIdForStorage,
        );

        // Create new document record with retry
        const newDocument = await traced("duplicate.createDocument", "db.query", async (docSpan) => {
          const doc = await databaseCreateWithRetry(
            async (generatedDocumentId) => {
              const duplicateName = extraParameters.name ? extraParameters.name : `${original.document.name} (Copy)`;
              docSpan.attributes["duplicate_name"] = duplicateName;

              const [newDoc] = await tenantDb
                .insert(tenantTables.documents)
                .values({
                  id: generatedDocumentId,
                  name: duplicateName,
                  description: original.document.description,
                  storageMetadataId: newStorageMetadata.id,
                  folderId: extraParameters.folderId ? extraParameters.folderId : original.document.folderId,
                  ownerId: userId,
                  contentType: original.document.contentType,
                  isArchived: false,
                  archivedAt: null,
                  downloadCount: 0,
                  viewCount: 0,
                  lastAccessedAt: null,
                  metadata: original.document.metadata,
                  createdAt: now,
                  updatedAt: now,
                })
                .returning();

              if (!newDoc) {
                throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              }

              return newDoc;
            },
            generateIdForDocument,
          );

          docSpan.attributes["document_created"] = true;
          docSpan.attributes["new_document_id"] = doc.id;
          return doc;
        });

        // Create new tenantTables.documentsDataKeys record with retry
        await traced("duplicate.createDataKey", "db.query", async (keySpan) => {
          await databaseCreateWithRetry(
            async (generatedDataKeyId) => {
              const [dataKeyRecord] = await tenantDb
                .insert(tenantTables.documentsDataKeys)
                .values({
                  id: generatedDataKeyId,
                  documentId: newDocument.id,
                  userId,
                  encryptedMasterKey: dataKey.encryptedMasterKey,
                  encryptionMode: dataKey.encryptionMode,
                  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
                  isActive: true,
                  grantedAt: now,
                })
                .returning();

              if (!dataKeyRecord) {
                throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
              }

              return dataKeyRecord;
            },
            generateIdRandom,
          );

          keySpan.attributes["data_key_created"] = true;
        });

        // Copy tag assignments from original document
        const originalTags = await this.tagService.getDocumentTags(id);
        if (originalTags.length > 0) {
          const originalTagIds = originalTags.map((t) => t.id);
          await this.tagService.assignTagsToDocument(newDocument.id, originalTagIds, userId);
        }

        // Copy favorites from original document
        await traced("duplicate.copyFavorites", "db.query", async (favSpan) => {
          const originalFavorites = await tenantDb
            .select()
            .from(tenantTables.documentFavorites)
            .where(eq(tenantTables.documentFavorites.documentId, id));

          if (originalFavorites.length > 0) {
            const favoriteRecords = originalFavorites.map((fav) => ({
              userId: fav.userId,
              documentId: newDocument.id,
              folderId: fav.folderId,
              createdAt: now,
            }));

            await tenantDb
              .insert(tenantTables.documentFavorites)
              .values(favoriteRecords);

            favSpan.attributes["favorites_copied"] = true;
            favSpan.attributes["favorites_count"] = originalFavorites.length;
          } else {
            favSpan.attributes["favorites_copied"] = false;
            favSpan.attributes["favorites_count"] = 0;
          }
        });

        // Get populated tags for the duplicated document
        const populatedTags = await this.tagService.getDocumentTags(newDocument.id);

        // Fetch document with folder name, owner name, and favorite status using JOINs
        const docResult = await tenantDb
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
            ownerFirstName: tenantTables.userProfiles.firstName,
            ownerLastName: tenantTables.userProfiles.lastName,
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
            tenantTables.userProfiles,
            eq(tenantTables.documents.ownerId, tenantTables.userProfiles.userId),
          )
          .leftJoin(
            tenantTables.storageMetadata,
            eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
          )
          .leftJoin(
            tenantTables.documentFavorites,
            and(
              eq(tenantTables.documentFavorites.documentId, tenantTables.documents.id),
              eq(tenantTables.documentFavorites.userId, userId),
            ),
          )
          .where(eq(tenantTables.documents.id, newDocument.id))
          .limit(1);

        if (docResult.length === 0) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const dbDoc = docResult[0];
        const folderName = dbDoc.folderName || null;
        const ownerName = `${dbDoc.ownerFirstName || ""} ${dbDoc.ownerLastName || ""}`.trim();
        const isFavorite = dbDoc.favoriteDocumentId !== null;

        const doc: IDocumentResponse = {
          id: dbDoc.id,
          name: dbDoc.name,
          description: dbDoc.description,
          folderId: dbDoc.folderId,
          ownerId: dbDoc.ownerId,
          contentType: dbDoc.contentType,
          isFavorite,
          isArchived: dbDoc.isArchived,
          archivedAt: dbDoc.archivedAt,
          downloadCount: dbDoc.downloadCount,
          viewCount: dbDoc.viewCount,
          lastAccessedAt: dbDoc.lastAccessedAt,
          tags: populatedTags,
          metadata: (dbDoc.metadata as Record<string, unknown>) || {},
          createdAt: dbDoc.createdAt,
          updatedAt: dbDoc.updatedAt,
          folderName,
          ownerName,
          thumbnailUrl: dbDoc.thumbnailPath ? `/api/documents/${dbDoc.id}/preview` : null,
          originalFileSize: dbDoc.originalFileSize,
        };

        span.attributes["success"] = true;
        span.attributes["new_document_id"] = newDocument.id;
        return doc;
      },
    );
  }
}
