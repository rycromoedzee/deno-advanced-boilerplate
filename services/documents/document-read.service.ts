/**
 * @file services/documents/document-read.service.ts
 * @description Service for document read operations
 *
 * This service handles all document read operations including:
 * - Finding documents by ID
 * - Finding documents for a user with pagination and filtering
 * - Search functionality
 *
 * All operations integrate with DocumentPermissionService to enforce
 * access control via the tenantTables.documentsDataKeys table.
 */

import { and, asc, countDistinct, desc, eq, exists, inArray, isNotNull, isNull, like, ne, or, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { DocumentTagService } from "@services/documents-tags/document-tag.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { traced } from "@services/tracing/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import type { IDocumentFilters, IPaginatedResult, IPaginationParams } from "@interfaces/documents.ts";
import type { IDocumentResponse, IDocumentTag } from "@models/documents/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentTagService } from "@services/documents-tags/singletons.ts";

/**
 * Document Read Service
 *
 * Provides comprehensive document read functionality including:
 * - Single document retrieval with permission checking
 * - Paginated document listing with filtering
 * - Search functionality
 * - Cache integration for performance
 *
 * All operations integrate with DocumentPermissionService to enforce
 * access control via the tenantTables.documentsDataKeys table.
 */
export class DocumentReadService {
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
   * Finds a document by ID with permission checking
   *
   * @param id - Document ID
   * @param userId - ID of the user requesting the document
   * @param environmentId - ID of the environment for isolation
   * @returns Promise<IDocumentResponse | null> - The document if found and accessible, null otherwise
   */
  async findById(
    id: string,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentResponse | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentReadService.findById",
      {
        service: "DocumentReadService",
        method: "findById",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId: id, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = id;
        span.attributes["user_id"] = userId;

        // Check if user has at least READ permission
        const hasAccess = await this.permissionService.checkAccess(
          id,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );

        if (!hasAccess) {
          await useLogger(LoggerLevels.warn, {
            message: "Access denied to document",
            section: loggerAppSections.DEBUG,
            messageKey: "document_access_denied",
            details: { documentId: id, userId },
          });
          span.attributes["access_denied"] = true;
          return null;
        }

        const tenantDb = await getTenantDB(environmentId);
        const result = await tenantDb
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
          .innerJoin(
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
          .leftJoin(
            tenantTables.documentsDataKeys,
            and(
              eq(tenantTables.documentsDataKeys.documentId, tenantTables.documents.id),
              eq(tenantTables.documentsDataKeys.userId, userId),
              eq(tenantTables.documentsDataKeys.isActive, true),
              eq(tenantTables.documentsDataKeys.isPublicShare, false),
            ),
          )
          .where(
            and(
              eq(tenantTables.documents.id, id),
              or(
                eq(tenantTables.documents.ownerId, userId), // Owned by user
                isNotNull(tenantTables.documentsDataKeys.userId), // Or shared with user
              ),
            ),
          )
          .limit(1);

        if (result.length === 0) {
          span.attributes["found"] = false;
          return null;
        }

        const dbDoc = result[0];

        // Populate tags
        const tags = await this.tagService.getDocumentTags(id);

        // Construct owner name from firstName and lastName
        const ownerName = `${dbDoc.ownerFirstName || ""} ${dbDoc.ownerLastName || ""}`.trim();

        // Check if the current user has favorited the document (favoriteDocumentId will be non-null if favorited)
        const isFavorite = dbDoc.favoriteDocumentId !== null;

        const document: IDocumentResponse = {
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
          tags,
          metadata: (dbDoc.metadata as Record<string, unknown>) || {},
          createdAt: dbDoc.createdAt,
          updatedAt: dbDoc.updatedAt,
          folderName: dbDoc.folderName || null,
          ownerName,
          thumbnailUrl: dbDoc.thumbnailPath ? `/api/documents/${dbDoc.id}/preview` : null,
          originalFileSize: dbDoc.originalFileSize,
        };

        span.attributes["found"] = true;
        return document;
      },
    );
  }

  /**
   * Finds documents for a user with pagination and filtering
   *
   * @param userId - ID of the user requesting documents
   * @param environmentId - ID of the environment
   * @param filters - Optional filters for documents
   * @param pagination - Pagination parameters
   * @param ownershipFilter - Filter by ownership: 'owned' (only owned), 'shared' (only shared with me), 'both' (default)
   * @returns Promise<IPaginatedResult<IDocumentResponse>> - Paginated list of documents
   */
  async findByUser(
    userId: string,
    environmentId: string,
    filters: IDocumentFilters = {},
    pagination: IPaginationParams = { page: 1, limit: 20 },
    ownershipFilter: "owned" | "shared" | "both" = "both",
  ): Promise<IPaginatedResult<IDocumentResponse>> {
    return await tracedWithServiceErrorHandling(
      "DocumentReadService.findByUser",
      {
        service: "DocumentReadService",
        method: "findByUser",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["page"] = pagination.page;
        span.attributes["limit"] = pagination.limit;
        span.attributes["has_filters"] = Object.keys(filters).length > 0;
        span.attributes["ownership_filter"] = ownershipFilter;

        const { page, limit, sortBy = "createdAt", sortOrder = "desc" } = pagination;

        // Get tenant DB for all queries (must be early for subqueries)
        const tenantDb = await getTenantDB(environmentId);

        // Build base WHERE conditions (shared between owned and shared queries)
        const baseConditions = [];

        // Filter by archived status
        if (filters.archived === "true") {
          baseConditions.push(eq(tenantTables.documents.isArchived, true));
        } else if (filters.archived === "false") {
          baseConditions.push(eq(tenantTables.documents.isArchived, false));
        }
        // If archived === 'both', don't add any filter

        // Filter by folder
        if (filters.folderId !== undefined) {
          if (filters.folderId === null) {
            baseConditions.push(isNull(tenantTables.documents.folderId));
          } else {
            baseConditions.push(eq(tenantTables.documents.folderId, filters.folderId));
          }
        }

        // Filter by content type
        if (filters.contentType) {
          baseConditions.push(eq(tenantTables.documents.contentType, filters.contentType));
        }

        // Filter by favorited status (rely on left-joined favorites table)
        if (filters.isFavorited === true) {
          baseConditions.push(isNotNull(tenantTables.documentFavorites.documentId));
        } else if (filters.isFavorited === false) {
          baseConditions.push(isNull(tenantTables.documentFavorites.documentId));
        }

        // Filter by tags - use junction table instead of deprecated JSONB field
        if (filters.tags && filters.tags.length > 0) {
          const tagsLower = filters.tags.map((tag) => tag.toLowerCase());
          const docsWithTagsSubquery = tenantDb
            .select({ documentId: tenantTables.documentTagAssignments.documentId })
            .from(tenantTables.documentTagAssignments)
            .innerJoin(
              tenantTables.documentTags,
              eq(tenantTables.documentTagAssignments.tagId, tenantTables.documentTags.id),
            )
            .where(
              and(
                eq(tenantTables.documentTags.userId, userId),
                inArray(sql`LOWER(${tenantTables.documentTags.name})`, tagsLower),
              ),
            )
            .groupBy(tenantTables.documentTagAssignments.documentId)
            .having(eq(countDistinct(tenantTables.documentTagAssignments.tagId), tagsLower.length));

          baseConditions.push(inArray(tenantTables.documents.id, docsWithTagsSubquery));
        }

        // Search by name or description
        // Note: SQLite LIKE is case-insensitive for ASCII characters by default
        if (filters.search) {
          const searchPattern = `%${filters.search}%`;
          baseConditions.push(
            or(
              like(tenantTables.documents.name, searchPattern),
              like(tenantTables.documents.description, searchPattern),
            )!,
          );
        }

        // Build the base SELECT columns for reuse
        const baseSelectColumns = {
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
          storageMetadataId: tenantTables.documents.storageMetadataId,
          folderName: tenantTables.documentFolders.name,
          ownerFirstName: tenantTables.userProfiles.firstName,
          ownerLastName: tenantTables.userProfiles.lastName,
          favoriteDocumentId: tenantTables.documentFavorites.documentId,
          thumbnailPath: tenantTables.storageMetadata.thumbnailPath,
          originalFileSize: tenantTables.storageMetadata.originalFileSize,
        };

        // Determine sort column for database-level sorting
        const sortColumn = sortBy === "name"
          ? tenantTables.documents.name
          : sortBy === "updatedAt"
          ? tenantTables.documents.updatedAt
          : tenantTables.documents.createdAt;

        const sharedAccessExists = exists(
          tenantDb
            .select({ one: sql`1` })
            .from(tenantTables.documentsDataKeys)
            .where(
              and(
                eq(tenantTables.documentsDataKeys.documentId, tenantTables.documents.id),
                eq(tenantTables.documentsDataKeys.userId, userId),
                eq(tenantTables.documentsDataKeys.isActive, true),
                eq(tenantTables.documentsDataKeys.isPublicShare, false),
              ),
            ),
        );

        const notOwner = ne(tenantTables.documents.ownerId, userId);

        const ownershipCondition = ownershipFilter === "owned"
          ? eq(tenantTables.documents.ownerId, userId)
          : ownershipFilter === "shared"
          ? and(sharedAccessExists, notOwner)
          : or(eq(tenantTables.documents.ownerId, userId), and(sharedAccessExists, notOwner));

        const whereClause = and(...baseConditions, ownershipCondition);

        const orderByClause = sortOrder === "asc"
          ? [asc(sortColumn), asc(tenantTables.documents.id)]
          : [desc(sortColumn), asc(tenantTables.documents.id)];

        const tagsAgg = tenantDb
          .select({
            documentId: tenantTables.documentTagAssignments.documentId,
            tags: sql<IDocumentTag[]>`
              json_group_array(
                json_object(
                  'id', ${tenantTables.documentTags.id},
                  'name', ${tenantTables.documentTags.name},
                  'color', ${tenantTables.documentTags.color},
                  'description', ${tenantTables.documentTags.description},
                  'usageCount', ${tenantTables.documentTags.usageCount},
                  'createdAt', ${tenantTables.documentTags.createdAt},
                  'updatedAt', ${tenantTables.documentTags.updatedAt}
                )
              )
            `.as("tags"),
          })
          .from(tenantTables.documentTagAssignments)
          .innerJoin(
            tenantTables.documentTags,
            eq(tenantTables.documentTagAssignments.tagId, tenantTables.documentTags.id),
          )
          .groupBy(tenantTables.documentTagAssignments.documentId)
          .as("tags_agg");

        // Single query: fetch documents with window function for total count.
        // offset is total-independent, so it is derived from the helper before the
        // query runs; the pagination metadata is built after `total` is known.
        const { offset } = calculatePagination(page, limit, 0);

        const paginatedDocs = await traced("findByUser.mainQuery", "db.query", async (querySpan) => {
          const result = await tenantDb
            .select({
              ...baseSelectColumns,
              tags: sql<IDocumentTag[]>`coalesce(${tagsAgg.tags}, json('[]'))`,
              total: sql<number>`cast(count(*) over() as integer)`,
            })
            .from(tenantTables.documents)
            .leftJoin(
              tenantTables.documentFolders,
              eq(tenantTables.documents.folderId, tenantTables.documentFolders.id),
            )
            .innerJoin(
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
            .leftJoin(tagsAgg, eq(tagsAgg.documentId, tenantTables.documents.id))
            .where(whereClause)
            .orderBy(...orderByClause)
            .limit(limit)
            .offset(offset);

          querySpan.attributes["result_count"] = result.length;
          querySpan.attributes["db_queries"] = 1;
          return result;
        });

        const total = paginatedDocs[0]?.total ?? 0;
        const { pagination: paginationMeta } = calculatePagination(page, limit, total);

        // Merge tags into documents (favorites already loaded via JOIN)
        const items: IDocumentResponse[] = paginatedDocs.map((dbDoc) => {
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
            tags: typeof dbDoc.tags === "string" ? JSON.parse(dbDoc.tags) : (dbDoc.tags || []),
            metadata: (dbDoc.metadata as Record<string, unknown>) || {},
            createdAt: dbDoc.createdAt,
            updatedAt: dbDoc.updatedAt,
            folderName: dbDoc.folderName || null,
            ownerName,
            thumbnailUrl: dbDoc.thumbnailPath ? `/api/documents/${dbDoc.id}/preview` : null,
            originalFileSize: dbDoc.originalFileSize,
          };
        });

        span.attributes["result_count"] = items.length;
        span.attributes["total_count"] = total;
        span.attributes["db_queries"] = 1;
        span.attributes["tags_loaded"] = paginatedDocs.reduce(
          (sum, doc) => sum + ((doc.tags?.length ?? 0) > 0 ? 1 : 0),
          0,
        );

        return {
          items,
          pagination: paginationMeta,
        };
      },
    );
  }

  /**
   * Search documents by query string
   * Alias for findByUser with search filter
   *
   * @param userId - ID of the user searching
   * @param environmentId - ID of the environment
   * @param query - Search query string
   * @param filters - Optional additional filters
   * @param pagination - Pagination parameters
   * @returns Promise<IPaginatedResult<IDocumentResponse>> - Paginated search results
   */
  async search(
    userId: string,
    environmentId: string,
    query: string,
    filters: IDocumentFilters = {},
    pagination: IPaginationParams = { page: 1, limit: 20 },
  ): Promise<IPaginatedResult<IDocumentResponse>> {
    return await this.findByUser(
      userId,
      environmentId,
      { ...filters, search: query },
      pagination,
    );
  }
}
