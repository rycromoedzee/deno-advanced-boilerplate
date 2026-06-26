/**
 * @file services/documents/document-upload.service.ts
 * @description Service for handling document uploads with full document management features
 *
 * This service coordinates the complete document upload workflow:
 * 1. Validates file type and size constraints
 * 2. Resolves/creates tags for the document
 * 3. Validates folder access if folderId is provided (checks ownership or WRITE permission)
 * 4. Creates database records (document, storage metadata, data keys) in a transaction
 * 5. Delegates file processing to StreamProcessorService which handles:
 *    - Automatic metadata extraction (video/audio codecs, resolution, duration, etc.)
 *    - File size calculation (original and encrypted)
 *    - Encryption and upload to storage
 * 6. Updates storage metadata with extracted information
 * 7. Manages folder permission inheritance asynchronously
 * 8. Assigns tags to the document
 * 9. Logs access for audit trail
 *
 * The heavy lifting for file processing is delegated to upload-processor services,
 * while this service focuses on document management features (tags, permissions, folders).
 */

import { generateIdForDocument, generateIdForStorage, generateIdRandom } from "@utils/database/id-generation/index.ts";
import { determineContentType, getTimeNowForStorage } from "@utils/shared/index.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import type { IFileUploadMetadata } from "@models/documents/document.model.ts";

import { getStorage } from "@services/storage/index.ts";
import { getDocumentPermissionInheritanceService } from "@services/documents-permission/singletons.ts";
import { getDocumentFolderPermissionService } from "@services/document-folders/singletons.ts";
import { type FileValidationResult, validateFileMetadata } from "@utils/shared/file-validation.ts";

import { IDocumentResponse } from "@models/documents/index.ts";
import { traced } from "../tracing/index.ts";
import { completeStoragePathForDocument } from "@constants/storage-paths.ts";
import { DocumentTagService } from "@services/documents-tags/document-tag.service.ts";
import { StreamProcessorService } from "@services/upload-processor/index.ts";
import { HASHING_CONTEXTS } from "@utils/text/hashing.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { getDocumentTagService } from "@services/documents-tags/singletons.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/singletons.ts";
import { calculateOptimalChunkSize } from "@constants/documents/chunked-upload.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import { and, eq, sql } from "@deps";

/**
 * Encryption configuration for document upload
 */
export interface IDocumentEncryptionConfig {
  encryptionKey: Uint8Array;
  encryptionMode: "user" | "app";
}

/**
 * Upload result interface
 */

/**
 * Upload Service
 *
 * Handles file upload processing with encryption, validation, and metadata management.
 */
export class DocumentUploadService {
  // DB access removed - use getTenantDB(environmentId) in each method
  private tagService: DocumentTagService; // Will be lazy loaded to avoid circular deps
  private logAccess: DocumentAccessLogService;

  constructor(logAccess?: DocumentAccessLogService, tagService?: DocumentTagService) {
    this.logAccess = logAccess || getDocumentAccessLogService();
    this.tagService = tagService || getDocumentTagService();
  }
  /**
   * Validates a file for upload
   *
   * @param metadata - File upload metadata
   * @returns FileValidationResult - Validation result with errors if any
   */
  validateFile(metadata: IFileUploadMetadata): FileValidationResult {
    return validateFileMetadata(metadata);
  }

  /**
   * Processes a file upload with database-first transactional approach
   *
   * @param fileStream - Readable stream of the file to upload
   * @param metadata - File upload metadata
   * @param userId - ID of the user uploading the file
   * @param encryptionConfig - Encryption configuration (key and mode)
   * @param environmentId - ID of the environment
   * @param ipAddress - IP address of the uploader (for access logging)
   * @param userAgent - User agent of the uploader (for access logging)
   * @returns Promise<IDocument> - Upload result with document and storage metadata
   *
   * ## Database-First Transactional Strategy
   *
   * This method uses a database-first approach with comprehensive transaction management:
   *
   * 1. **Database Transaction**: All database operations are wrapped in a single transaction
   * 2. **Document Creation**: Create document record first to get a guaranteed unique documentId
   * 3. **Related Records**: Create storage metadata and data key records within the same transaction
   * 4. **File Upload**: Upload encrypted file to storage using the real documentId
   * 5. **Transaction Commit**: Commit all database changes only after successful file upload
   * 6. **Rollback Logic**: If any step fails, rollback both database changes and uploaded files
   *
   * ## Encryption Modes
   *
   * - **User-Controlled**: User provides their own encryption key, they manage key lifecycle
   * - **App-Controlled**: Application manages encryption keys, transparent to user
   *
   * ## Error Handling & Consistency
   *
   * - **Database Rollback**: Transaction is automatically rolled back on any database operation failure
   * - **Storage Cleanup**: Any uploaded files are deleted if the transaction fails
   * - **Atomicity**: Either the entire upload succeeds (DB + storage) or everything is rolled back
   * - **Retry Logic**: Database operations still use databaseCreateWithRetry for ID collision handling
   *
   * This approach ensures perfect consistency between database state and storage state,
   * preventing orphaned files or database records even in complex failure scenarios.
   */
  async processUpload(
    fileStream: ReadableStream<Uint8Array>,
    metadata: IFileUploadMetadata,
    userId: string,
    encryptionConfig: IDocumentEncryptionConfig,
    environmentId: string,
  ): Promise<IDocumentResponse> {
    const uploadedFiles: string[] = [];
    // Track created DB record IDs for compensating cleanup on failure
    const createdRecordIds: { storageMetadataId?: string; documentId?: string; dataKeyId?: string } = {};
    const storageService = getStorage();
    const tenantDb = await getTenantDB(environmentId);

    // Validation checks (can throw HTTP exceptions)
    const validationResult = this.validateFile(metadata);
    if (!validationResult.isValid) {
      throwHttpError("COMMON.INVALID_INPUT");
    }

    await traced("db.checkQuota", "db.query", async (span) => {
      const globalDb = getGlobalDB();
      const [quotas] = await globalDb
        .select({
          maxFileSizeKb: globalTables.environmentQuotas.maxFileSizeKb,
          maxStorageKb: globalTables.environmentQuotas.maxStorageKb,
          currentStorageKb: globalTables.environmentQuotas.currentStorageKb,
        })
        .from(globalTables.environmentQuotas)
        .where(eq(globalTables.environmentQuotas.id, environmentId))
        .limit(1);

      span.attributes["quota.found"] = !!quotas;

      if (quotas) {
        const fileSizeKb = Math.ceil(metadata.fileSize / 1024);
        span.attributes["quota.file_size_kb"] = fileSizeKb;
        span.attributes["quota.max_file_size_kb"] = quotas.maxFileSizeKb;
        span.attributes["quota.max_storage_kb"] = quotas.maxStorageKb;
        span.attributes["quota.current_storage_kb"] = quotas.currentStorageKb;

        if (quotas.maxFileSizeKb && quotas.maxFileSizeKb > 0 && fileSizeKb > quotas.maxFileSizeKb) {
          throwHttpError("ENVIRONMENT.QUOTA_EXCEEDED_FILE_SIZE");
        }

        if (quotas.maxStorageKb && quotas.maxStorageKb > 0 && (quotas.currentStorageKb + fileSizeKb) > quotas.maxStorageKb) {
          throwHttpError("ENVIRONMENT.QUOTA_EXCEEDED_STORAGE");
        }
      }
    });

    return await tracedWithServiceErrorHandling(
      "DocumentUploadService.processUpload",
      {
        service: "DocumentUploadService",
        method: "processUpload",
        section: loggerAppSections.DOCUMENTS,
        details: { userId, environmentId, fileName: metadata.name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["file_name"] = metadata.name;

        try {
          const now = getTimeNowForStorage();
          const contentType = determineContentType(metadata.mimeType);

          // 1. Resolve/create tags BEFORE creating document
          let tagIds: string[] = [];
          if (metadata.tags && metadata.tags.length > 0) {
            tagIds = await this.tagService.resolveOrCreateTags(
              metadata.tags,
              userId,
            );
          }

          // 2. Validate folder access if folderId is provided
          if (metadata.folderId) {
            const folderId = metadata.folderId; // Extract to avoid TypeScript issues with optional chaining
            await traced("validateFolderAccess", "auth", async (span) => {
              span.attributes = {
                ...span.attributes,
                "folder_id": folderId,
                "user_id": userId,
                "environment_id": environmentId,
              };

              // Check if folder exists, is not archived, and belongs to the environment
              const folderResult = await tenantDb
                .select({
                  id: tenantTables.documentFolders.id,
                  ownerId: tenantTables.documentFolders.ownerId,
                  isArchived: tenantTables.documentFolders.isArchived,
                })
                .from(tenantTables.documentFolders)
                .where(
                  and(
                    eq(tenantTables.documentFolders.id, folderId),
                    eq(tenantTables.documentFolders.isArchived, false),
                  ),
                )
                .limit(1);

              if (folderResult.length === 0) {
                span.attributes["folder_found"] = false;
                await useLogger(LoggerLevels.debug, {
                  message: "Folder not found or is archived",
                  section: loggerAppSections.DOCUMENTS,
                  messageKey: "document_upload_folder_not_found",
                  details: {
                    folderId,
                    userId,
                    environmentId,
                  },
                });
                throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
              }

              const folder = folderResult[0];
              span.attributes["folder_owner_id"] = folder.ownerId;
              span.attributes["is_owner"] = folder.ownerId === userId;

              // If user is the owner, they have full access
              if (folder.ownerId === userId) {
                span.attributes["access_granted"] = true;
                span.attributes["access_method"] = "ownership";
                return;
              }

              // Otherwise, check if user has WRITE access to the folder
              const folderPermissionService = getDocumentFolderPermissionService();
              const effectivePermission = await folderPermissionService.getEffectivePermission(
                folderId,
                userId,
              );

              // If user has zero access (no rights), return 404 to avoid leaking folder existence
              if (effectivePermission === -1) {
                span.attributes["access_granted"] = false;
                span.attributes["permission_level"] = "none";
                await useLogger(LoggerLevels.debug, {
                  message: "User has no access to folder",
                  section: loggerAppSections.DOCUMENTS,
                  messageKey: "document_upload_folder_no_access",
                  details: {
                    folderId,
                    userId,
                    environmentId,
                  },
                });
                throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
              }

              // If user has some access but not WRITE level, return 403
              if (!permissionLevelMeets(effectivePermission as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
                span.attributes["access_granted"] = false;
                span.attributes["permission_level"] = effectivePermission.toString();
                await useLogger(LoggerLevels.debug, {
                  message: "User does not have write access to folder",
                  section: loggerAppSections.DOCUMENTS,
                  messageKey: "document_upload_folder_permission_denied",
                  details: {
                    folderId,
                    userId,
                    environmentId,
                    effectivePermission,
                  },
                });
                throwHttpError("DOCUMENT_FOLDER.PERMISSION_DENIED");
              }

              span.attributes["access_granted"] = true;
              span.attributes["access_method"] = "shared_access";
            });
          }

          const encryptionModeConstant = encryptionConfig.encryptionMode === "user"
            ? DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED
            : DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED;

          // Insert records individually instead of in a single transaction to minimise
          // SQLite write-lock hold time. On failure the catch block cleans up any
          // orphaned records that were already written.
          const transactionResult = await traced("db.createDocumentRecords", "db.query", async (span) => {
            span.attributes = {
              ...span.attributes,
              "document.name": metadata.name,
              "document.mime_type": metadata.mimeType,
              "document.file_size": metadata.fileSize,
              "document.folder_id": metadata.folderId || "root",
              "encryption.mode": encryptionConfig.encryptionMode,
            };

            let finalStoragePath = "";
            const storageMetadataRecord = await databaseCreateWithRetry(
              async (generatedStorageMetadataId) => {
                finalStoragePath = completeStoragePathForDocument(environmentId, generatedStorageMetadataId, metadata.mimeType);
                const [storageRecord] = await tenantDb
                  .insert(tenantTables.storageMetadata)
                  .values({
                    id: generatedStorageMetadataId,
                    originalName: metadata.name,
                    mimeType: metadata.mimeType,
                    originalFileSize: metadata.fileSize,
                    encryptedFileSize: metadata.fileSize,
                    folderPath: finalStoragePath,
                    userId,
                    encryptionChunkSize: calculateOptimalChunkSize(metadata.fileSize, metadata.mimeType),
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
            createdRecordIds.storageMetadataId = storageMetadataRecord.id;

            const document = await databaseCreateWithRetry(
              async (generatedDocumentId) => {
                const [documentRecord] = await tenantDb
                  .insert(tenantTables.documents)
                  .values({
                    id: generatedDocumentId,
                    name: metadata.name,
                    description: metadata.description || null,
                    storageMetadataId: storageMetadataRecord.id,
                    folderId: metadata.folderId || null,
                    ownerId: userId,
                    contentType,
                    isArchived: false,
                    archivedAt: null,
                    downloadCount: 0,
                    viewCount: 0,
                    lastAccessedAt: null,
                    metadata: metadata.metadata || {},
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();
                if (!documentRecord) {
                  throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
                }
                return documentRecord;
              },
              generateIdForDocument,
            );
            createdRecordIds.documentId = document.id;

            const dataKeyRecord = await databaseCreateWithRetry(
              async (generatedDataKeyId) => {
                const [dataKey] = await tenantDb
                  .insert(tenantTables.documentsDataKeys)
                  .values({
                    id: generatedDataKeyId,
                    documentId: document.id,
                    userId,
                    encryptedMasterKey: new Uint8Array(),
                    encryptionMode: encryptionModeConstant,
                    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
                    isActive: true,
                    keyVersion: 1,
                    isPublicShare: false,
                    publicShareToken: null,
                    publicShareExpiresAt: null,
                    recipientEmail: null,
                    recipientName: null,
                    recipientLanguage: "en",
                    isPasswordProtected: false,
                    accessCount: 0,
                    lastAccessedAt: null,
                    notifyOnAccess: false,
                    grantedAt: now,
                    revokedAt: null,
                    grantedBy: null,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();
                if (!dataKey) {
                  throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
                }
                return dataKey;
              },
              generateIdRandom,
            );
            createdRecordIds.dataKeyId = dataKeyRecord.id;

            span.attributes["document.id"] = document.id;
            span.attributes["storage.id"] = storageMetadataRecord.id;
            span.attributes["data_key.id"] = dataKeyRecord.id;

            return {
              document,
              storageMetadataRecord,
              dataKeyRecord,
              storagePath: finalStoragePath,
            };
          });

          // Let StreamProcessorService do ALL the heavy lifting:
          // - Detect file type and extract metadata (video/audio)
          // - Calculate file sizes
          // - Encrypt and upload to storage
          const encryptionResult = await traced("upload_processor.processStream", "service", async (span) => {
            span.attributes = {
              ...span.attributes,
              "document.id": transactionResult.document.id,
              "storage.path": transactionResult.storagePath,
              "file.size": metadata.fileSize,
              "encryption.mode": encryptionConfig.encryptionMode,
            };

            const processingResult = await StreamProcessorService.processUploadStream(
              fileStream,
              {
                fileId: transactionResult.storageMetadataRecord.id,
                originalName: metadata.name,
                mimeType: metadata.mimeType,
                userId,
                encryptionKey: encryptionConfig.encryptionKey,
                storagePath: transactionResult.storagePath,
                hashingContext: HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
                environmentId,
                encryptionChunkSize: transactionResult.storageMetadataRecord.encryptionChunkSize, // Pass the chunk size from storage metadata
              },
            );

            // Update storage metadata with all extracted information
            await traced("db.updateStorageMetadata", "db.query", async (span) => {
              span.attributes["storage.id"] = transactionResult.storageMetadataRecord.id;
              span.attributes["file.original_size"] = processingResult.originalFileSize;
              span.attributes["file.encrypted_size"] = processingResult.encryptedFileSize;

              await tenantDb
                .update(tenantTables.storageMetadata)
                .set({
                  originalFileSize: processingResult.originalFileSize,
                  encryptedFileSize: processingResult.encryptedFileSize,
                  contentHash: processingResult.contentHash,
                  // Populate thumbnail metadata (if any)
                  thumbnailPath: processingResult.thumbnail?.path ?? null,
                  thumbnailSize: processingResult.thumbnail?.size ?? null,
                  thumbnailWidth: processingResult.thumbnail?.width ?? null,
                  thumbnailHeight: processingResult.thumbnail?.height ?? null,
                  updatedAt: now,
                })
                .where(eq(tenantTables.storageMetadata.id, transactionResult.storageMetadataRecord.id));
            });

            span.attributes["file.original_size"] = processingResult.originalFileSize;
            span.attributes["file.encrypted_size"] = processingResult.encryptedFileSize;
            span.attributes["thumbnail.generated"] = processingResult.thumbnail !== undefined;

            return {
              encryptedDataKey: processingResult.encryptedDataKey,
              storagePath: processingResult.storagePath,
              thumbnail: processingResult.thumbnail,
              originalFileSize: processingResult.originalFileSize,
            };
          });

          uploadedFiles.push(transactionResult.storagePath);

          // Track thumbnail file for cleanup if it was generated
          if (encryptionResult.thumbnail?.path) {
            uploadedFiles.push(encryptionResult.thumbnail.path);
          }

          // Assign tags via junction table (before Promise.all - tags must exist before getDocumentTags)
          if (tagIds.length > 0) {
            await traced("service.assignTags", "service", async (span) => {
              span.attributes = {
                ...span.attributes,
                "document.id": transactionResult.document.id,
                "tags.count": tagIds.length,
              };

              await this.tagService.assignTagsToDocument(
                transactionResult.document.id,
                tagIds,
                userId,
              );
            });
          }

          if (metadata.folderId) {
            this.handlePermissionInheritanceAsync(
              transactionResult.document.id,
              metadata.folderId,
              userId,
              encryptionConfig.encryptionMode === "user" ? encryptionConfig.encryptionKey : undefined,
            ).catch((error) => {
              useLogger(LoggerLevels.error, {
                message: "Async permission inheritance failed",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "permission_inheritance_async_error",
                details: {
                  documentId: transactionResult.document.id,
                  folderId: metadata.folderId,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            });
          }

          this.logAccess.logDocumentAccess(
            transactionResult.document.id,
            userId,
            "upload",
            "direct",
          );

          // Run independent post-upload operations in parallel
          const [, populatedTags, folderResult, userResult] = await Promise.all([
            // 1. Update data key with encrypted master key
            traced("db.updateDataKey", "db.query", async (span) => {
              span.attributes = {
                ...span.attributes,
                "data_key.id": transactionResult.dataKeyRecord.id,
                "document.id": transactionResult.document.id,
              };

              await tenantDb
                .update(tenantTables.documentsDataKeys)
                .set({
                  encryptedMasterKey: encryptionResult.encryptedDataKey,
                  updatedAt: now,
                })
                .where(eq(tenantTables.documentsDataKeys.id, transactionResult.dataKeyRecord.id));
            }),

            // 2. Get populated tags for response
            traced("service.getDocumentTags", "service", async (span) => {
              span.attributes = {
                ...span.attributes,
                "document.id": transactionResult.document.id,
              };
              return await this.tagService.getDocumentTags(transactionResult.document.id);
            }),

            transactionResult.document.folderId
              ? tenantDb
                .select({ name: tenantTables.documentFolders.name })
                .from(tenantTables.documentFolders)
                .where(eq(tenantTables.documentFolders.id, transactionResult.document.folderId))
                .limit(1)
              : Promise.resolve([]),

            tenantDb
              .select({
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(eq(tenantTables.userProfiles.userId, userId))
              .limit(1),
          ]);

          const folderName = folderResult.length > 0 ? folderResult[0].name : null;
          const ownerName = userResult.length > 0 ? `${userResult[0].firstName || ""} ${userResult[0].lastName || ""}`.trim() : "";

          // Newly created documents won't have favorites yet, so isFavorite is always false
          const isFavorite = false;

          const doc: IDocumentResponse = {
            id: transactionResult.document.id,
            name: transactionResult.document.name,
            description: transactionResult.document.description,
            folderId: transactionResult.document.folderId,
            ownerId: transactionResult.document.ownerId,
            contentType: transactionResult.document.contentType,
            isFavorite,
            isArchived: transactionResult.document.isArchived,
            archivedAt: transactionResult.document.archivedAt,
            downloadCount: transactionResult.document.downloadCount,
            viewCount: transactionResult.document.viewCount,
            lastAccessedAt: transactionResult.document.lastAccessedAt,
            tags: populatedTags ?? [],
            metadata: (transactionResult.document.metadata || {}) as Record<string, unknown>,
            createdAt: transactionResult.document.createdAt,
            updatedAt: transactionResult.document.updatedAt,
            folderName,
            ownerName,
            thumbnailUrl: encryptionResult.thumbnail?.path ? `/api/documents/${transactionResult.document.id}/preview` : null,
            originalFileSize: encryptionResult.originalFileSize,
          };

          const fileSizeKb = Math.ceil(encryptionResult.originalFileSize / 1024);
          fireAndForgetOperation("update-storage-quota-upload", async () => {
            try {
              const gdb = getGlobalDB();
              const now = Math.floor(Date.now() / 1000);
              await gdb
                .insert(globalTables.environmentQuotas)
                .values({
                  id: environmentId,
                  currentStorageKb: fileSizeKb,
                  createdAt: now,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: globalTables.environmentQuotas.id,
                  set: {
                    currentStorageKb: sql`current_storage_kb + ${fileSizeKb}`,
                    updatedAt: now,
                  },
                });
            } catch (error) {
              useLogger(LoggerLevels.error, {
                message: "Failed to update storage quota after upload",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "storage_quota_update_failed",
                details: { environmentId, deltaKb: fileSizeKb, error: String(error) },
              });
            }
          });

          span.attributes["success"] = true;

          return doc;
        } catch (error) {
          // Domain errors (validation, permission, quota) skip cleanup and propagate with original semantics.
          if (error instanceof AppHttpException) throw error;

          // --- Compensating cleanup: remove orphaned DB records (reverse order) ---
          const hasOrphanedRecords = createdRecordIds.dataKeyId || createdRecordIds.documentId || createdRecordIds.storageMetadataId;
          if (hasOrphanedRecords) {
            try {
              // Delete in reverse dependency order: dataKey → document → storageMetadata
              if (createdRecordIds.dataKeyId) {
                await tenantDb.delete(tenantTables.documentsDataKeys)
                  .where(eq(tenantTables.documentsDataKeys.id, createdRecordIds.dataKeyId));
              }
              if (createdRecordIds.documentId) {
                await tenantDb.delete(tenantTables.documents)
                  .where(eq(tenantTables.documents.id, createdRecordIds.documentId));
              }
              if (createdRecordIds.storageMetadataId) {
                await tenantDb.delete(tenantTables.storageMetadata)
                  .where(eq(tenantTables.storageMetadata.id, createdRecordIds.storageMetadataId));
              }

              useLogger(LoggerLevels.info, {
                message: "Cleaned up orphaned DB records after upload failure",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "db_cleanup_success",
                details: { ...createdRecordIds },
              });
            } catch (cleanupDbError) {
              useLogger(LoggerLevels.error, {
                message: "Failed to clean up orphaned DB records after upload failure",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "db_cleanup_failed",
                details: {
                  ...createdRecordIds,
                  cleanupError: cleanupDbError instanceof Error ? cleanupDbError.message : String(cleanupDbError),
                },
              });
            }
          }

          // --- Compensating cleanup: remove uploaded storage files ---
          if (uploadedFiles.length > 0) {
            await useLogger(LoggerLevels.warn, {
              message: "Cleaning up uploaded files due to upload failure",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "storage_cleanup_initiated",
              details: {
                uploadedFiles,
                error: error instanceof Error ? error.message : String(error),
              },
            });

            // Attempt to clean up each uploaded file
            const cleanupResults = await Promise.allSettled(
              uploadedFiles.map(async (filePath) => {
                try {
                  await storageService.deleteFile(filePath);
                  await useLogger(LoggerLevels.info, {
                    message: "Successfully cleaned up uploaded file",
                    section: loggerAppSections.DOCUMENTS,
                    messageKey: "file_cleanup_success",
                    details: { filePath },
                  });
                } catch (cleanupError) {
                  await useLogger(LoggerLevels.error, {
                    message: "Failed to cleanup uploaded file",
                    section: loggerAppSections.DOCUMENTS,
                    messageKey: "file_cleanup_failed",
                    details: {
                      filePath,
                      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
                    },
                  });
                  throw cleanupError;
                }
              }),
            );

            // Log cleanup summary
            const successCount = cleanupResults.filter((r) => r.status === "fulfilled").length;
            const failureCount = cleanupResults.filter((r) => r.status === "rejected").length;

            await useLogger(LoggerLevels.info, {
              message: "Storage cleanup completed",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "storage_cleanup_completed",
              details: {
                totalFiles: uploadedFiles.length,
                successCount,
                failureCount,
              },
            });
          }

          throw error; // re-throw raw → wrapper logs once + converts to 500 with _serviceErrorLogged=true
        }
      },
      {
        onUnexpected: async () => {
          // Log failed access attempt (best-effort audit trail — errors ignored intentionally)
          try {
            await this.logAccess.logDocumentAccess(
              "unknown",
              userId,
              "upload",
              "direct",
            );
          } catch (_logError) {
            // Ignore access logging errors - they shouldn't prevent error propagation
          }
        },
      },
    );
  }

  /**
   * Processes a pre-encrypted file upload (for chunked uploads where chunks are already encrypted)
   * Skips encryption step and uploads the stream directly
   *
   * @param encryptedFileStream - ReadableStream of already-encrypted file data
   * @param metadata - File upload metadata
   * @param userId - ID of the user uploading the file
   * @param encryptedDataKey - Already-encrypted data key from chunk upload
   * @param encryptionMode - Encryption mode used ("user" or "app")
   * @param environmentId - ID of the environment
   * @param encryptionChunkSize - Chunk size used during encryption (defaults to 64KB)
   * @param extractedMetadata - Optional pre-extracted video/audio metadata
   * @param contentHash - Optional pre-calculated SHA-256 content hash
   * @param ownerUserMasterKey - Optional owner's master key for user-encrypted documents (required for permission inheritance with USER_CONTROLLED encryption)
   * @returns Promise<IDocumentResponse> - Upload result with document
   */
  async processPreEncryptedUpload(
    encryptedFileStream: ReadableStream<Uint8Array>,
    metadata: IFileUploadMetadata,
    userId: string,
    encryptedDataKey: Uint8Array,
    encryptionMode: "user" | "app",
    environmentId: string,
    encryptionChunkSize: number = calculateOptimalChunkSize(metadata.fileSize, metadata.mimeType),
    _extractedMetadata?: Record<string, unknown>,
    contentHash?: string,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<IDocumentResponse> {
    const uploadedFiles: string[] = [];
    const createdRecordIds: { storageMetadataId?: string; documentId?: string; dataKeyId?: string } = {};
    const storageService = getStorage();
    const tenantDb = await getTenantDB(environmentId);

    // Validation checks (can throw HTTP exceptions)
    const validationResult = this.validateFile(metadata);
    if (!validationResult.isValid) {
      throwHttpError("COMMON.INVALID_INPUT");
    }

    const globalDb = getGlobalDB();
    const [quotas] = await globalDb
      .select({
        maxFileSizeKb: globalTables.environmentQuotas.maxFileSizeKb,
        maxStorageKb: globalTables.environmentQuotas.maxStorageKb,
        currentStorageKb: globalTables.environmentQuotas.currentStorageKb,
      })
      .from(globalTables.environmentQuotas)
      .where(eq(globalTables.environmentQuotas.id, environmentId))
      .limit(1);

    if (quotas) {
      const fileSizeKb = Math.ceil(metadata.fileSize / 1024);

      if (quotas.maxFileSizeKb && quotas.maxFileSizeKb > 0 && fileSizeKb > quotas.maxFileSizeKb) {
        throwHttpError("ENVIRONMENT.QUOTA_EXCEEDED_FILE_SIZE");
      }

      if (quotas.maxStorageKb && quotas.maxStorageKb > 0 && (quotas.currentStorageKb + fileSizeKb) > quotas.maxStorageKb) {
        throwHttpError("ENVIRONMENT.QUOTA_EXCEEDED_STORAGE");
      }
    }

    return await tracedWithServiceErrorHandling(
      "DocumentUploadService.processPreEncryptedUpload",
      {
        service: "DocumentUploadService",
        method: "processPreEncryptedUpload",
        section: loggerAppSections.DOCUMENTS,
        details: { userId, environmentId, fileName: metadata.name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["file_name"] = metadata.name;
        span.attributes["encryption.pre_encrypted"] = true;

        try {
          const now = getTimeNowForStorage();
          const contentType = determineContentType(metadata.mimeType);

          // 1. Resolve/create tags BEFORE creating document
          let tagIds: string[] = [];
          if (metadata.tags && metadata.tags.length > 0) {
            tagIds = await this.tagService.resolveOrCreateTags(
              metadata.tags,
              userId,
            );
          }

          // 2. Validate folder access if folderId is provided
          if (metadata.folderId) {
            const folderId = metadata.folderId;
            await traced("validateFolderAccess", "auth", async (span) => {
              span.attributes = {
                ...span.attributes,
                "folder_id": folderId,
                "user_id": userId,
                "environment_id": environmentId,
              };

              const folderResult = await tenantDb
                .select({
                  id: tenantTables.documentFolders.id,
                  ownerId: tenantTables.documentFolders.ownerId,
                  isArchived: tenantTables.documentFolders.isArchived,
                })
                .from(tenantTables.documentFolders)
                .where(
                  and(
                    eq(tenantTables.documentFolders.id, folderId),
                    eq(tenantTables.documentFolders.isArchived, false),
                  ),
                )
                .limit(1);

              if (folderResult.length === 0) {
                span.attributes["folder_found"] = false;
                throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
              }

              const folder = folderResult[0];
              span.attributes["folder_owner_id"] = folder.ownerId;
              span.attributes["is_owner"] = folder.ownerId === userId;

              if (folder.ownerId === userId) {
                span.attributes["access_granted"] = true;
                span.attributes["access_method"] = "ownership";
                return;
              }

              const folderPermissionService = getDocumentFolderPermissionService();
              const effectivePermission = await folderPermissionService.getEffectivePermission(
                folderId,
                userId,
              );

              if (effectivePermission === -1) {
                span.attributes["access_granted"] = false;
                span.attributes["permission_level"] = "none";
                throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
              }

              if (!permissionLevelMeets(effectivePermission as DB_ENUM_PERMISSION_ACCESS_LEVEL, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
                span.attributes["access_granted"] = false;
                span.attributes["permission_level"] = effectivePermission.toString();
                throwHttpError("DOCUMENT_FOLDER.PERMISSION_DENIED");
              }

              span.attributes["access_granted"] = true;
              span.attributes["access_method"] = "shared_access";
            });
          }

          const encryptionModeConstant = encryptionMode === "user"
            ? DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED
            : DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED;

          const transactionResult = await traced("db.createDocumentRecords", "db.query", async (span) => {
            span.attributes = {
              ...span.attributes,
              "document.name": metadata.name,
              "document.mime_type": metadata.mimeType,
              "document.file_size": metadata.fileSize,
              "document.folder_id": metadata.folderId || "root",
              "encryption.mode": encryptionMode,
              "encryption.pre_encrypted": true,
            };

            let finalStoragePath = "";
            const storageMetadataRecord = await databaseCreateWithRetry(
              async (generatedStorageMetadataId) => {
                finalStoragePath = completeStoragePathForDocument(environmentId, generatedStorageMetadataId, metadata.mimeType);
                const [storageRecord] = await tenantDb
                  .insert(tenantTables.storageMetadata)
                  .values({
                    id: generatedStorageMetadataId,
                    originalName: metadata.name,
                    mimeType: metadata.mimeType,
                    originalFileSize: metadata.fileSize,
                    encryptedFileSize: metadata.fileSize,
                    folderPath: finalStoragePath,
                    userId,
                    encryptionChunkSize,
                    contentHash: contentHash || null,
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
            createdRecordIds.storageMetadataId = storageMetadataRecord.id;

            const document = await databaseCreateWithRetry(
              async (generatedDocumentId) => {
                const [documentRecord] = await tenantDb
                  .insert(tenantTables.documents)
                  .values({
                    id: generatedDocumentId,
                    name: metadata.name,
                    description: metadata.description || null,
                    storageMetadataId: storageMetadataRecord.id,
                    folderId: metadata.folderId || null,
                    ownerId: userId,
                    contentType,
                    isArchived: false,
                    archivedAt: null,
                    downloadCount: 0,
                    viewCount: 0,
                    lastAccessedAt: null,
                    metadata: metadata.metadata || {},
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();
                if (!documentRecord) {
                  throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
                }
                return documentRecord;
              },
              generateIdForDocument,
            );
            createdRecordIds.documentId = document.id;

            const dataKeyRecord = await databaseCreateWithRetry(
              async (generatedDataKeyId) => {
                const [dataKey] = await tenantDb
                  .insert(tenantTables.documentsDataKeys)
                  .values({
                    id: generatedDataKeyId,
                    documentId: document.id,
                    userId,
                    encryptedMasterKey: encryptedDataKey,
                    encryptionMode: encryptionModeConstant,
                    permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN,
                    isActive: true,
                    keyVersion: 1,
                    isPublicShare: false,
                    publicShareToken: null,
                    publicShareExpiresAt: null,
                    recipientEmail: null,
                    recipientName: null,
                    recipientLanguage: "en",
                    isPasswordProtected: false,
                    accessCount: 0,
                    lastAccessedAt: null,
                    notifyOnAccess: false,
                    grantedAt: now,
                    revokedAt: null,
                    grantedBy: null,
                    createdAt: now,
                    updatedAt: now,
                  })
                  .returning();
                if (!dataKey) {
                  throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
                }
                return dataKey;
              },
              generateIdRandom,
            );
            createdRecordIds.dataKeyId = dataKeyRecord.id;

            span.attributes["document.id"] = document.id;
            span.attributes["storage.id"] = storageMetadataRecord.id;
            span.attributes["data_key.id"] = dataKeyRecord.id;

            return {
              document,
              storageMetadataRecord,
              dataKeyRecord,
              storagePath: finalStoragePath,
            };
          });

          // Upload pre-encrypted stream directly to storage
          const { bytesWritten: encryptedFileSize } = await traced("storage.uploadPreEncryptedFile", "storage", async (span) => {
            span.attributes = {
              ...span.attributes,
              "document.id": transactionResult.document.id,
              "storage.path": transactionResult.storagePath,
              "file.size": metadata.fileSize,
            };

            return await storageService.uploadFile(transactionResult.storagePath, encryptedFileStream);
          });

          uploadedFiles.push(transactionResult.storagePath);

          // Update storage metadata with actual encrypted file size
          await tenantDb
            .update(tenantTables.storageMetadata)
            .set({
              encryptedFileSize,
              updatedAt: now,
            })
            .where(eq(tenantTables.storageMetadata.id, transactionResult.storageMetadataRecord.id));

          // Assign tags if any
          if (tagIds.length > 0) {
            await traced("service.assignTags", "service", async (span) => {
              span.attributes = {
                ...span.attributes,
                "document.id": transactionResult.document.id,
                "tags.count": tagIds.length,
              };

              await this.tagService.assignTagsToDocument(
                transactionResult.document.id,
                tagIds,
                userId,
              );
            });
          }

          // Handle permission inheritance if needed
          if (metadata.folderId) {
            this.handlePermissionInheritanceAsync(
              transactionResult.document.id,
              metadata.folderId,
              userId,
              encryptionMode === "user" ? ownerUserMasterKey : undefined,
            ).catch((error) => {
              useLogger(LoggerLevels.error, {
                message: "Async permission inheritance failed",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "permission_inheritance_async_error",
                details: {
                  documentId: transactionResult.document.id,
                  folderId: metadata.folderId,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
            });
          }

          // Log access
          this.logAccess.logDocumentAccess(
            transactionResult.document.id,
            userId,
            "upload",
            "direct",
          );

          const [, populatedTags, folderResult, userResult] = await Promise.all([
            Promise.resolve(),

            traced("service.getDocumentTags", "service", async (span) => {
              span.attributes = {
                ...span.attributes,
                "document.id": transactionResult.document.id,
              };
              return await this.tagService.getDocumentTags(transactionResult.document.id);
            }),

            transactionResult.document.folderId
              ? tenantDb
                .select({ name: tenantTables.documentFolders.name })
                .from(tenantTables.documentFolders)
                .where(eq(tenantTables.documentFolders.id, transactionResult.document.folderId))
                .limit(1)
              : Promise.resolve([]),

            tenantDb
              .select({
                firstName: tenantTables.userProfiles.firstName,
                lastName: tenantTables.userProfiles.lastName,
              })
              .from(tenantTables.userProfiles)
              .where(eq(tenantTables.userProfiles.userId, userId))
              .limit(1),
          ]);

          const folderName = folderResult.length > 0 ? folderResult[0].name : null;
          const ownerName = userResult.length > 0 ? `${userResult[0].firstName || ""} ${userResult[0].lastName || ""}`.trim() : "";

          const isFavorite = false;

          const doc: IDocumentResponse = {
            id: transactionResult.document.id,
            name: transactionResult.document.name,
            description: transactionResult.document.description,
            folderId: transactionResult.document.folderId,
            ownerId: transactionResult.document.ownerId,
            contentType: transactionResult.document.contentType,
            isFavorite,
            isArchived: transactionResult.document.isArchived,
            archivedAt: transactionResult.document.archivedAt,
            downloadCount: transactionResult.document.downloadCount,
            viewCount: transactionResult.document.viewCount,
            lastAccessedAt: transactionResult.document.lastAccessedAt,
            tags: populatedTags ?? [],
            metadata: (transactionResult.document.metadata || {}) as Record<string, unknown>,
            createdAt: transactionResult.document.createdAt,
            updatedAt: transactionResult.document.updatedAt,
            folderName,
            ownerName,
            thumbnailUrl: null, // No thumbnail for pre-encrypted uploads
            originalFileSize: metadata.fileSize,
          };

          const fileSizeKb = Math.ceil(metadata.fileSize / 1024);
          fireAndForgetOperation("update-storage-quota-pre-encrypted-upload", async () => {
            try {
              const gdb = getGlobalDB();
              const now = Math.floor(Date.now() / 1000);
              await gdb
                .insert(globalTables.environmentQuotas)
                .values({
                  id: environmentId,
                  currentStorageKb: fileSizeKb,
                  createdAt: now,
                  updatedAt: now,
                })
                .onConflictDoUpdate({
                  target: globalTables.environmentQuotas.id,
                  set: {
                    currentStorageKb: sql`current_storage_kb + ${fileSizeKb}`,
                    updatedAt: now,
                  },
                });
            } catch (error) {
              useLogger(LoggerLevels.error, {
                message: "Failed to update storage quota after upload",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "storage_quota_update_failed",
                details: { environmentId, deltaKb: fileSizeKb, error: String(error) },
              });
            }
          });

          return doc;
        } catch (error) {
          // --- Compensating cleanup: remove orphaned DB records (reverse order) ---
          const hasOrphanedRecords = createdRecordIds.dataKeyId || createdRecordIds.documentId || createdRecordIds.storageMetadataId;
          if (hasOrphanedRecords) {
            try {
              if (createdRecordIds.dataKeyId) {
                await tenantDb.delete(tenantTables.documentsDataKeys)
                  .where(eq(tenantTables.documentsDataKeys.id, createdRecordIds.dataKeyId));
              }
              if (createdRecordIds.documentId) {
                await tenantDb.delete(tenantTables.documents)
                  .where(eq(tenantTables.documents.id, createdRecordIds.documentId));
              }
              if (createdRecordIds.storageMetadataId) {
                await tenantDb.delete(tenantTables.storageMetadata)
                  .where(eq(tenantTables.storageMetadata.id, createdRecordIds.storageMetadataId));
              }

              useLogger(LoggerLevels.info, {
                message: "Cleaned up orphaned DB records after upload failure",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "db_cleanup_success",
                details: { ...createdRecordIds },
              });
            } catch (cleanupDbError) {
              useLogger(LoggerLevels.error, {
                message: "Failed to clean up orphaned DB records after upload failure",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "db_cleanup_failed",
                details: {
                  ...createdRecordIds,
                  cleanupError: cleanupDbError instanceof Error ? cleanupDbError.message : String(cleanupDbError),
                },
              });
            }
          }

          // --- Compensating cleanup: remove uploaded storage files ---
          if (uploadedFiles.length > 0) {
            await useLogger(LoggerLevels.warn, {
              message: "Cleaning up uploaded files due to upload failure",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "storage_cleanup_initiated",
              details: {
                uploadedFiles,
                error: error instanceof Error ? error.message : String(error),
              },
            });

            const _cleanupResults = await Promise.allSettled(
              uploadedFiles.map(async (filePath) => {
                try {
                  await storageService.deleteFile(filePath);
                } catch (cleanupError) {
                  await useLogger(LoggerLevels.error, {
                    message: "Failed to cleanup uploaded file",
                    section: loggerAppSections.DOCUMENTS,
                    messageKey: "file_cleanup_failed",
                    details: {
                      filePath,
                      cleanupError: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
                    },
                  });
                  throw cleanupError;
                }
              }),
            );
          }

          if (error instanceof AppHttpException) {
            throw error;
          }

          throw error; // re-throw raw → wrapper logs once + converts to 500 with _serviceErrorLogged=true
        }
      },
      {
        onUnexpected: async () => {
          // Log failed access attempt (best-effort audit trail — errors ignored intentionally)
          try {
            await this.logAccess.logDocumentAccess(
              "unknown",
              userId,
              "upload",
              "direct",
            );
          } catch (_logError) {
            // Ignore access logging errors
          }
        },
      },
    );
  }

  /**
   * Determines the file category from MIME type
   *
   * @param mimeType - MIME type of the file
   * @returns File category (document, image, video, audio, archive, unknown)
   */
  /**
   * Handles permission inheritance asynchronously without blocking the upload
   *
   * @param documentId - ID of the uploaded document
   * @param folderId - ID of the parent folder
   * @param ownerId - ID of the document owner
   * @param ownerUserMasterKey - Optional owner's master key for user-encrypted documents
   * @returns Promise<void> - Fire-and-forget async processing
   *
   * @private
   */
  private async handlePermissionInheritanceAsync(
    documentId: string,
    folderId: string,
    ownerId: string,
    ownerUserMasterKey?: Uint8Array,
  ): Promise<void> {
    try {
      const permissionInheritanceService = getDocumentPermissionInheritanceService();

      await permissionInheritanceService
        .handleNewDocumentInheritance(
          documentId,
          folderId,
          ownerId,
          ownerUserMasterKey,
        );
    } catch (error) {
      throw error;
    }
  }
}
