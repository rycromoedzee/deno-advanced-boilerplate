/**
 * @file services/documents/document-write.service.ts
 * @description Service for document write operations (create and update)
 *
 * This service handles document creation and updates with:
 * - Permission checking
 * - Tag management
 * - Cache invalidation
 * - Access logging
 * - Change tracking
 */

import { and, eq } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentTagService } from "@services/documents-tags/document-tag.service.ts";
import { DocumentStatsService } from "@services/documents-stats/document-stats.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { ChangeTrackingService } from "@services/documents-operations/change-tracking.helpers.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import {
  type ICreateDocumentInput,
  type IDocumentResponse,
  type IUpdateDocumentInput,
  SchemaDocumentCreateRequest,
  SchemaDocumentUpdateRequest,
} from "@models/documents/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { generateIdForDocument } from "@utils/database/id-generation/index.ts";
import { getDocumentPermissionInheritanceService, getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentStatsService } from "@services/documents-stats/singletons.ts";
import { getDocumentTagService } from "@services/documents-tags/singletons.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/singletons.ts";
import { getChangeTrackingService } from "@services/documents-operations/change-tracking.helpers.ts";
import { emitDocumentActivityLog } from "@services/documents-activity-logs/index.ts";
import { getDocumentFolderPermissionService } from "@services/document-folders/singletons.ts";

/**
 * Document Write Service
 *
 * Provides document creation and update functionality:
 * - Create documents with metadata and tags
 * - Update documents with permission verification
 * - Tag management integration
 * - Cache management
 * - Access logging
 *
 * All operations integrate with DocumentPermissionService to enforce
 * access control via the tenantTables.documentsDataKeys table.
 */
export class DocumentWriteService {
  private permissionService: DocumentPermissionService;
  private tagService: DocumentTagService;
  private accessLogService: DocumentAccessLogService;
  private changeTrackingService: ChangeTrackingService;
  private statsService: DocumentStatsService;
  private folderPermissionService = getDocumentFolderPermissionService();

  constructor(
    permissionService?: DocumentPermissionService,
    tagService?: DocumentTagService,
    accessLogService?: DocumentAccessLogService,
    changeTrackingService?: ChangeTrackingService,
    statsService?: DocumentStatsService,
  ) {
    // Use injected dependencies or create new instances
    this.permissionService = permissionService ||
      getDocumentPermissionService();
    this.tagService = tagService || getDocumentTagService();
    this.accessLogService = accessLogService || getDocumentAccessLogService();
    this.changeTrackingService = changeTrackingService || getChangeTrackingService();
    this.statsService = statsService || getDocumentStatsService();
  }

  /**
   * Creates a new document with metadata
   *
   * @param data - Document creation data
   * @param userId - ID of the user creating the document
   * @param storageMetadataId - ID of the associated storage metadata record
   * @param environmentId - ID of the environment
   * @returns Promise<IDocumentResponse> - The created document
   *
   * @example
   * ```typescript
   * const service = new DocumentWriteService();
   * const document = await service.create({
   *   name: 'My Document',
   *   description: 'A test document',
   *   contentType: 'pdf'
   * }, 'user_123', 'storage_456', 'env_789');
   * ```
   */
  async create(
    data: ICreateDocumentInput,
    userId: string,
    storageMetadataId: string,
    environmentId: string,
  ): Promise<IDocumentResponse> {
    return await tracedWithServiceErrorHandling(
      "DocumentWriteService.create",
      {
        service: "DocumentWriteService",
        method: "create",
        section: loggerAppSections.DOCUMENTS,
        details: { userId, name: data.name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["document_name"] = data.name;
        span.attributes["has_folder"] = !!data.folderId;

        const parsed = SchemaDocumentCreateRequest.safeParse(data);
        if (!parsed.success) {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED", parsed.error);
        }

        const input = parsed.data;
        const normalizedName = input.name.trim();
        if (normalizedName.length === 0) {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
        }

        let normalizedDescription = input.description ?? null;
        if (typeof normalizedDescription === "string") {
          normalizedDescription = normalizedDescription.trim();
          if (normalizedDescription.length === 0) {
            normalizedDescription = null;
          }
        }

        const metadata = input.metadata ?? {};
        const metadataSize = new TextEncoder().encode(JSON.stringify(metadata)).length;
        const maxMetadataBytes = 10_000;
        if (metadataSize > maxMetadataBytes) {
          throwHttpError("COMMON.INVALID_INPUT", "Metadata too large");
        }

        const maxTags = 20;
        if (input.tags && input.tags.length > maxTags) {
          throwHttpError("COMMON.INVALID_INPUT", "Too many tags");
        }

        const tenantDb = await getTenantDB(environmentId);

        let folderOwnerId: string | null = null;
        if (input.folderId) {
          const [folder] = await tenantDb
            .select({
              id: tenantTables.documentFolders.id,
              ownerId: tenantTables.documentFolders.ownerId,
            })
            .from(tenantTables.documentFolders)
            .where(
              and(
                eq(tenantTables.documentFolders.id, input.folderId),
              ),
            )
            .limit(1);

          if (!folder) {
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }

          folderOwnerId = folder.ownerId;

          const hasFolderWriteAccess = await this.folderPermissionService.checkFolderAccess(
            input.folderId,
            userId,
            DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
          );

          if (!hasFolderWriteAccess) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
        }

        const [storage] = await tenantDb
          .select({ userId: tenantTables.storageMetadata.userId })
          .from(tenantTables.storageMetadata)
          .where(eq(tenantTables.storageMetadata.id, storageMetadataId))
          .limit(1);

        if (!storage) {
          throwHttpError("COMMON.INVALID_INPUT", "Invalid storage metadata");
        }

        const canUseStorage = storage.userId === userId || (folderOwnerId && storage.userId === folderOwnerId);
        if (!canUseStorage) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        const now = Math.floor(getTimeNow() / 1000);

        // 1. Resolve/create tags BEFORE creating document
        let tagIds: string[] = [];
        if (input.tags && input.tags.length > 0) {
          tagIds = await this.tagService.resolveOrCreateTags(
            input.tags,
            userId,
          );
        }

        const document = await databaseCreateWithRetry(
          async (generatedDocumentId) => {
            const [doc] = await tenantDb
              .insert(tenantTables.documents)
              .values({
                id: generatedDocumentId,
                name: normalizedName,
                description: normalizedDescription,
                storageMetadataId,
                folderId: input.folderId || null,
                ownerId: userId,
                contentType: input.contentType || null,
                isArchived: false,
                archivedAt: null,
                downloadCount: 0,
                viewCount: 0,
                lastAccessedAt: null,
                metadata,
                createdAt: now,
                updatedAt: now,
              })
              .returning();

            if (!doc) {
              throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
            }

            return doc;
          },
          generateIdForDocument,
        );

        // 2. Assign tags via junction table
        if (tagIds.length > 0) {
          await this.tagService.assignTagsToDocument(
            document.id,
            tagIds,
            userId,
          );
        }

        await useLogger(LoggerLevels.info, {
          message: "Document created successfully",
          section: loggerAppSections.DEBUG,
          messageKey: "document_created",
          details: { documentId: document.id, userId, name: data.name },
        });

        // 3. Get populated tags for response
        const populatedTags = await this.tagService.getDocumentTags(document.id);

        // 4. Fetch folder name if document is in a folder
        let folderName: string | null = null;
        if (document.folderId) {
          const folderResult = await tenantDb
            .select({ name: tenantTables.documentFolders.name })
            .from(tenantTables.documentFolders)
            .where(eq(tenantTables.documentFolders.id, document.folderId))
            .limit(1);

          if (folderResult.length > 0) {
            folderName = folderResult[0].name;
          }
        }

        // 5. Fetch owner name
        const userResult = await tenantDb
          .select({
            firstName: tenantTables.userProfiles.firstName,
            lastName: tenantTables.userProfiles.lastName,
          })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.userId, userId))
          .limit(1);

        const ownerName = userResult.length > 0 ? `${userResult[0].firstName || ""} ${userResult[0].lastName || ""}`.trim() : "";

        // Newly created documents won't have favorites yet, so isFavorite is always false
        const isFavorite = false;

        const doc: IDocumentResponse = {
          id: document.id,
          name: document.name,
          description: document.description,
          folderId: document.folderId,
          ownerId: document.ownerId,
          contentType: document.contentType,
          isFavorite,
          isArchived: document.isArchived,
          archivedAt: document.archivedAt,
          downloadCount: document.downloadCount,
          viewCount: document.viewCount,
          lastAccessedAt: document.lastAccessedAt,
          tags: populatedTags,
          metadata: (document.metadata as Record<string, unknown>) || {},
          createdAt: document.createdAt,
          updatedAt: document.updatedAt,
          folderName,
          ownerName,
          thumbnailUrl: null, // New documents won't have thumbnails (only uploads generate them)
          originalFileSize: null, // New documents created without file upload won't have size
        };

        // 6. Handle permission inheritance if document is in a folder
        if (input.folderId) {
          this.handlePermissionInheritanceAsync(
            document.id,
            input.folderId,
            userId,
          ).catch((error) => {
            useLogger(LoggerLevels.error, {
              message: "Async permission inheritance failed",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "permission_inheritance_async_error",
              details: {
                documentId: document.id,
                folderId: data.folderId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          });
        }

        span.attributes["document_id"] = document.id;
        span.attributes["success"] = true;

        return doc;
      },
    );
  }

  /**
   * Updates a document with permission verification
   *
   * @param id - Document ID
   * @param data - Document update data
   * @param userId - ID of the user updating the document
   * @param environmentId - ID of the environment
   * @returns Promise<boolean> - True if successful, false otherwise
   *
   * @example
   * ```typescript
   * const service = new DocumentWriteService();
   * const updated = await service.update('doc_123', {
   *   name: 'Updated Name',
   *   description: 'New description'
   * }, 'user_456', 'env_789');
   * ```
   */
  async update(
    id: string,
    data: IUpdateDocumentInput,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentResponse> {
    return await tracedWithServiceErrorHandling(
      "DocumentWriteService.update",
      {
        service: "DocumentWriteService",
        method: "update",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;
        span.attributes["update_fields"] = Object.keys(data).join(",");

        const parsed = SchemaDocumentUpdateRequest.safeParse(data);
        if (!parsed.success) {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED", parsed.error);
        }
        const input = parsed.data;

        if (input.metadata !== undefined) {
          const metadataSize = new TextEncoder().encode(JSON.stringify(input.metadata ?? {})).length;
          const maxMetadataBytes = 10_000;
          if (metadataSize > maxMetadataBytes) {
            throwHttpError("COMMON.INVALID_INPUT", "Metadata too large");
          }
        }

        // Fetch existing document state for change tracking
        const tenantDb = await getTenantDB(environmentId);

        const [existingDoc] = await traced("update.dbQueryExists", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .select()
            .from(tenantTables.documents)
            .where(
              and(
                eq(tenantTables.documents.id, id),
              ),
            )
            .limit(1);

          dbSpan.attributes["document_found"] = result.length > 0;
          return result;
        });

        if (!existingDoc) {
          span.attributes["document_found"] = false;
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // Check if user has WRITE permission
        const hasAccess = await this.permissionService.checkAccess(
          id,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
        );

        if (!hasAccess) {
          span.attributes["access_denied"] = true;
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        if (input.folderId !== undefined && input.folderId !== existingDoc.folderId) {
          if (input.folderId) {
            const [folder] = await tenantDb
              .select({ id: tenantTables.documentFolders.id })
              .from(tenantTables.documentFolders)
              .where(
                and(
                  eq(tenantTables.documentFolders.id, input.folderId),
                ),
              )
              .limit(1);

            if (!folder) {
              throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
            }

            const hasFolderWriteAccess = await this.folderPermissionService.checkFolderAccess(
              input.folderId,
              userId,
              DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
            );

            if (!hasFolderWriteAccess) {
              throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
            }
          }
        }

        const now = getTimeNowForStorage();

        // Handle tag updates if provided
        // Use document owner's ID for tag resolution, not the requesting user's ID
        // This ensures tags are created/found under the document owner's account
        if (input.tags !== undefined) {
          const newTagIds = await this.tagService.resolveOrCreateTags(
            input.tags,
            existingDoc.ownerId,
          );

          const currentTags = await this.tagService.getDocumentTags(id);
          const currentTagIds = currentTags.map((t) => t.id);

          const toAdd = newTagIds.filter((tid) => !currentTagIds.includes(tid));
          const toRemove = currentTagIds.filter((tid) => !newTagIds.includes(tid));

          if (toRemove.length > 0) {
            await this.tagService.removeTagsFromDocument(id, toRemove, userId);
          }
          if (toAdd.length > 0) {
            await this.tagService.assignTagsToDocument(id, toAdd, userId);
          }
        }

        // Build update object with only provided fields (excluding tags)
        const updateData: Record<string, unknown> = {
          updatedAt: now,
        };

        if (input.name !== undefined) {
          const normalizedName = input.name.trim();
          if (normalizedName.length === 0) {
            throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
          }
          updateData.name = normalizedName;
        }
        if (input.description !== undefined) {
          if (input.description === null) {
            updateData.description = null;
          } else {
            const normalizedDescription = input.description.trim();
            updateData.description = normalizedDescription.length > 0 ? normalizedDescription : null;
          }
        }
        if (input.folderId !== undefined) updateData.folderId = input.folderId;
        if (input.metadata !== undefined) updateData.metadata = input.metadata;

        const [updatedDoc] = await traced("update.dbUpdate", "db.query", async (dbSpan) => {
          const result = await tenantDb
            .update(tenantTables.documents)
            .set(updateData)
            .where(
              and(
                eq(tenantTables.documents.id, id),
              ),
            )
            .returning();

          dbSpan.attributes["updated"] = result.length > 0;
          dbSpan.attributes["updated_fields"] = Object.keys(updateData).filter((k) => k !== "updatedAt").join(",");
          return result;
        });

        if (!updatedDoc) {
          throwHttpError("DOCUMENT.UPDATE_FAILED");
        }

        // Fetch updated tags, folder name, and owner name for response
        const [populatedTags, folderResult, userResult] = await Promise.all([
          this.tagService.getDocumentTags(id),
          updatedDoc.folderId
            ? tenantDb
              .select({ name: tenantTables.documentFolders.name })
              .from(tenantTables.documentFolders)
              .where(eq(tenantTables.documentFolders.id, updatedDoc.folderId))
              .limit(1)
            : Promise.resolve([]),
          tenantDb
            .select({
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
            })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, updatedDoc.ownerId))
            .limit(1),
        ]);

        const folderName = folderResult.length > 0 ? folderResult[0].name : null;
        const ownerName = userResult.length > 0 ? `${userResult[0].firstName || ""} ${userResult[0].lastName || ""}`.trim() : "";

        // Check if document is favorited by the current user
        const favoriteResult = await tenantDb
          .select({ userId: tenantTables.documentFavorites.userId })
          .from(tenantTables.documentFavorites)
          .where(
            and(
              eq(tenantTables.documentFavorites.documentId, id),
              eq(tenantTables.documentFavorites.userId, userId),
            ),
          )
          .limit(1);

        const isFavorite = favoriteResult.length > 0;

        const responseDocument: IDocumentResponse = {
          id: updatedDoc.id,
          name: updatedDoc.name,
          description: updatedDoc.description,
          folderId: updatedDoc.folderId,
          ownerId: updatedDoc.ownerId,
          contentType: updatedDoc.contentType,
          isFavorite,
          isArchived: updatedDoc.isArchived,
          archivedAt: updatedDoc.archivedAt,
          downloadCount: updatedDoc.downloadCount,
          viewCount: updatedDoc.viewCount,
          lastAccessedAt: updatedDoc.lastAccessedAt,
          tags: populatedTags,
          metadata: (updatedDoc.metadata as Record<string, unknown>) || {},
          createdAt: updatedDoc.createdAt,
          updatedAt: updatedDoc.updatedAt,
          folderName,
          ownerName,
          thumbnailUrl: null, // Will be populated if thumbnail exists
          originalFileSize: null, // Not fetched in update operation for performance
        };

        // Track changes and log document update access with change details
        const changes = this.changeTrackingService.trackDocumentChanges(
          existingDoc,
          updatedDoc,
        );
        const redactedChanges = changes.map((change) => {
          if (change.field === "description") {
            return {
              ...change,
              previousValue: "(redacted)",
              newValue: "(redacted)",
            };
          }
          return change;
        });

        this.accessLogService.logDocumentAccess(
          id,
          userId,
          "update",
          "direct",
          { changes: redactedChanges.length > 0 ? redactedChanges : undefined },
        ).catch((err) => {
          useLogger(
            LoggerLevels.warn,
            {
              details: {
                documentId: id,
                userId,
              },
              message: "Error logging document update access",
              messageKey: "document_access_log_failed",
              raw: err,
              section: loggerAppSections.DOCUMENTS,
            },
          );
        });

        // Emit activity log asynchronously (non-blocking)
        // If the user updating is the owner, use the already-fetched ownerName
        // Otherwise, fetch the accessing user's name in the background
        const activityLogOwnerId = updatedDoc.ownerId;
        const activityLogOwnerName = ownerName;
        const activityLogFolderId = updatedDoc.folderId;
        const activityLogFolderName = folderName;
        const activityLogPopulatedTags = populatedTags;

        // Fire-and-forget: does not block the response
        void (async () => {
          // If the user updating is the owner, reuse the already-fetched name
          // Otherwise, fetch the accessing user's name
          const accessedByName = userId === activityLogOwnerId ? activityLogOwnerName : await this.getUserName(userId);

          await emitDocumentActivityLog(
            {
              id: Date.now().toString(),
              documentId: updatedDoc.id,
              documentName: updatedDoc.name,
              documentType: updatedDoc.contentType,
              documentContentType: updatedDoc.contentType,
              ownerId: activityLogOwnerId,
              ownerName: activityLogOwnerName,
              folderId: activityLogFolderId,
              folderName: activityLogFolderName,
              tags: activityLogPopulatedTags,
              accessType: "update",
              accessMethod: "direct",
              accessedBy: userId,
              accessedByName,
              accessedAt: Math.floor(Date.now() / 1000),
              accessDetails: null,
              ipAddress: null,
              userAgent: null,
              success: null,
              errorMessage: null,
              documentCreatedAt: updatedDoc.createdAt,
              documentUpdatedAt: updatedDoc.updatedAt,
            },
            userId,
            environmentId,
          );
        })().catch((err) => {
          useLogger(
            LoggerLevels.warn,
            {
              details: {
                documentId: id,
                userId,
              },
              message: "Error emitting activity log",
              messageKey: "activity_log.emit_error",
              raw: err,
              section: loggerAppSections.DOCUMENTS,
            },
          );
        });

        span.attributes["success"] = true;

        return responseDocument;
      },
    );
  }

  /**
   * Handles permission inheritance asynchronously without blocking document creation
   *
   * @param documentId - ID of the created document
   * @param folderId - ID of the parent folder
   * @param ownerId - ID of the document owner
   * @returns Promise<void> - Fire-and-forget async processing
   *
   * @private
   */
  private async handlePermissionInheritanceAsync(
    documentId: string,
    folderId: string,
    ownerId: string,
  ): Promise<void> {
    try {
      const permissionInheritanceService = getDocumentPermissionInheritanceService();

      await permissionInheritanceService.handleNewDocumentInheritance(
        documentId,
        folderId,
        ownerId,
      );
    } catch (error) {
      throw error;
    }
  }

  /**
   * Fetches a user's display name by their ID
   *
   * @param userId - The user ID to look up
   * @returns Promise<string> - The user's display name (empty string if not found)
   *
   * @private
   */
  private async getUserName(userId: string): Promise<string> {
    try {
      const tenantDb = await getTenantDB();
      const userResult = await tenantDb
        .select({
          firstName: tenantTables.userProfiles.firstName,
          lastName: tenantTables.userProfiles.lastName,
        })
        .from(tenantTables.userProfiles)
        .where(eq(tenantTables.userProfiles.userId, userId))
        .limit(1);

      return userResult.length > 0 ? `${userResult[0].firstName || ""} ${userResult[0].lastName || ""}`.trim() : "";
    } catch {
      return "";
    }
  }
}
