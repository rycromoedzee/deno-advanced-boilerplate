/**
 * @file services/documents-stats/unified-access-log.service.ts
 * @description Unified service for logging and querying document and folder access attempts
 *
 * This service handles audit logging for both document and folder access operations,
 * providing comprehensive tracking of who accessed what, when, and how. It supports
 * filtering and pagination for audit queries.
 */

import { and, asc, count, desc, eq, gte, ilike, inArray, isNull, lte, or, SQL, sql } from "@deps";

import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { generateIdForDocument, generateIdRandomWithTimestamp } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { IPaginatedResult, IPaginationParams } from "@interfaces/documents.ts";
import type { IFolderAccessLog } from "@models/documents/folder-sharing.model.ts";
import type { IDocumentAccessLog } from "@models/documents/document-sharing.model.ts";
import type { IActivityLogItem } from "@models/documents/activity-logs.model.ts";
import { TextTransformations } from "@utils/text/transformations.ts";
import { calculatePagination } from "@utils/shared/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { traced } from "@services/tracing/index.ts";

/**
 * Metadata for access logging
 */
export interface IAccessLogMetadata {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
  errorMessage?: string;
  dataKeyId?: string;
  changes?: Array<{
    field: string;
    previousValue: unknown;
    newValue: unknown;
  }>;
}

/**
 * Unified Access Log Service
 *
 * Provides audit logging capabilities for both documents and folders:
 * - Logs all access attempts with metadata
 * - Supports querying logs with filtering and pagination
 * - Tracks success/failure status and error messages
 * - Records IP addresses, user agents, and other request metadata
 */
export class DocumentAccessLogService {
  /**
   * Logs a folder access attempt
   *
   * @param folderId - Folder ID being accessed
   * @param userId - User ID (null for anonymous/public access)
   * @param accessType - Type of access (view, list, access_child)
   * @param accessMethod - Method of access (direct, public_share, internal_share)
   * @param success - Whether the access attempt was successful
   * @param metadata - Additional metadata (IP address, user agent, error message, etc.)
   * @returns Promise<void>
   *
   * @example
   * ```typescript
   * const service = new DocumentAccessLogService();
   * await service.logFolderAccess(
   *   'folder_123',
   *   'user_456',
   *   'view',
   *   'direct',
   *   true,
   *   {
   *     ipAddress: '192.168.1.1',
   *     userAgent: 'Mozilla/5.0...',
   *   }
   * );
   * ```
   */
  async logFolderAccess(
    folderId: string,
    userId: string | null,
    accessType: string,
    accessMethod: string,
    success: boolean,
    metadata: IAccessLogMetadata = {},
  ): Promise<void> {
    try {
      const db = await getTenantDB();

      await databaseCreateWithRetry(
        async (generatedLogId) => {
          const [accessLog] = await db.insert(tenantTables.folderAccessLogs).values({
            id: generatedLogId,
            folderId,
            userId,
            accessType,
            accessMethod,
            ipAddress: metadata.ipAddress || null,
            userAgent: metadata.userAgent || null,
            referer: metadata.referer || null,
            success,
            errorMessage: metadata.errorMessage || null,
          }).returning();

          if (!accessLog) {
            throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
          }

          return accessLog;
        },
        generateIdForDocument,
      );
    } catch (error) {
      // Don't throw - logging failures shouldn't break the main operation
      await useLogger(LoggerLevels.error, {
        message: "Failed to log folder access",
        section: loggerAppSections.DEBUG,
        messageKey: "folder_access_log_error",
        details: {
          folderId,
          userId,
          accessType,
          accessMethod,
          error,
        },
      });
    }
  }

  /**
   * Logs a document access attempt
   *
   * @param documentId - Document ID being accessed
   * @param userId - User ID (null for anonymous/public access)
   * @param accessType - Type of access (view, download, share, etc.)
   * @param accessMethod - Method of access (direct, public_share, api)
   * @param success - Whether the access attempt was successful
   * @param metadata - Additional metadata (IP address, user agent, error message, etc.)
   * @returns Promise<void>
   */
  async logDocumentAccess(
    documentId: string,
    userId: string | null,
    accessType: string,
    accessMethod: string,
    metadata: IAccessLogMetadata & { shareToken?: string } = {},
  ): Promise<void> {
    try {
      const db = await getTenantDB();
      await databaseCreateWithRetry(
        async (generatedLogId) => {
          const [accessLog] = await db.insert(tenantTables.documentAccessLogs).values({
            id: generatedLogId,
            documentId,
            folderId: null,
            dataKeyId: metadata.dataKeyId || null,
            userId,
            accessType,
            accessMethod,
            changes: metadata.changes ?? null,
          }).returning();

          if (!accessLog) {
            throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
          }

          return accessLog;
        },
        generateIdRandomWithTimestamp,
      );
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Failed to log document access",
        section: loggerAppSections.DEBUG,
        messageKey: "document_access_log_failed",
        details: { documentId, userId, error },
      });
    }
  }

  /**
   * Generic query method for building WHERE conditions
   * @private
   */
  private buildConditions(
    table: typeof tenantTables.folderAccessLogs | typeof tenantTables.documentAccessLogs,
    filters: {
      folderId?: string;
      documentId?: string;
      userId?: string | null;
      accessType?: string;
      accessMethod?: string;
      success?: boolean;
      startDate?: number;
      endDate?: number;
    },
  ): SQL[] {
    const conditions: SQL[] = [];

    if (filters.folderId) {
      conditions.push(eq(table.folderId, filters.folderId));
    }

    if (filters.documentId) {
      conditions.push(eq((table as typeof tenantTables.documentAccessLogs).documentId, filters.documentId));
    }

    if (filters.userId !== undefined) {
      if (filters.userId === null) {
        conditions.push(isNull(table.userId));
      } else {
        conditions.push(eq(table.userId, filters.userId));
      }
    }

    if (filters.accessType) {
      conditions.push(eq(table.accessType, filters.accessType));
    }

    if (filters.accessMethod) {
      conditions.push(eq(table.accessMethod, filters.accessMethod));
    }

    if (filters.success !== undefined) {
      conditions.push(eq((table as typeof tenantTables.folderAccessLogs).success, filters.success));
    }

    if (filters.startDate) {
      conditions.push(gte(table.createdAt, filters.startDate));
    }

    if (filters.endDate) {
      conditions.push(lte(table.createdAt, filters.endDate));
    }

    return conditions;
  }

  /**
   * Queries folder access logs with filtering and pagination
   *
   * @param filters - Filter criteria
   * @param pagination - Pagination parameters
   * @returns Promise<IPaginatedResult<IFolderAccessLog>> - Paginated access logs
   */
  async queryFolderLogs(
    filters: {
      folderId?: string;
      userId?: string;
      accessType?: string;
      accessMethod?: string;
      success?: boolean;
      startDate?: number;
      endDate?: number;
    } = {},
    pagination: IPaginationParams = { page: 1, limit: 50 },
  ): Promise<IPaginatedResult<IFolderAccessLog>> {
    return await tracedWithServiceErrorHandling(
      "DocumentAccessLogService.queryFolderLogs",
      {
        service: "DocumentAccessLogService",
        method: "queryFolderLogs",
        section: loggerAppSections.DEBUG,
        details: { filters, pagination },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        const conditions = this.buildConditions(tenantTables.folderAccessLogs, filters);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const db = await getTenantDB();

        // Get total count
        const countResult = await db
          .select({ count: count() })
          .from(tenantTables.folderAccessLogs)
          .where(whereClause);

        const total = countResult[0]?.count || 0;
        const limit = Math.min(Math.max(1, pagination.limit), 100); // Max 100 per page
        const page = Math.max(1, pagination.page);
        const { offset, pagination: paginationMeta } = calculatePagination(page, limit, total);

        span.attributes["total_count"] = total;
        span.attributes["page"] = paginationMeta.page;
        span.attributes["limit"] = paginationMeta.limit;

        // Get paginated results
        const logs = await db
          .select()
          .from(tenantTables.folderAccessLogs)
          .where(whereClause)
          .orderBy(desc(tenantTables.folderAccessLogs.createdAt))
          .limit(paginationMeta.limit)
          .offset(offset);

        return {
          items: logs,
          pagination: paginationMeta,
        };
      },
    );
  }

  /**
   * Queries document access logs with filtering and pagination
   *
   * @param filters - Filter criteria
   * @param pagination - Pagination parameters
   * @returns Promise<IPaginatedResult<IDocumentAccessLog>> - Paginated access logs
   */
  async queryDocumentLogs(
    filters: {
      documentId?: string;
      userId?: string;
      accessType?: string;
      accessMethod?: string;
      startDate?: number;
      endDate?: number;
    } = {},
    pagination: IPaginationParams = { page: 1, limit: 50 },
  ): Promise<IPaginatedResult<IDocumentAccessLog>> {
    return await tracedWithServiceErrorHandling(
      "DocumentAccessLogService.queryDocumentLogs",
      {
        service: "DocumentAccessLogService",
        method: "queryDocumentLogs",
        section: loggerAppSections.DEBUG,
        details: { filters, pagination },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        const conditions = this.buildConditions(tenantTables.documentAccessLogs, filters);
        const whereClause = conditions.length > 0 ? and(...conditions) : undefined;
        const db = await getTenantDB();

        // Get total count
        const countResult = await db
          .select({ count: count() })
          .from(tenantTables.documentAccessLogs)
          .where(whereClause);

        const total = countResult[0]?.count || 0;
        const limit = Math.min(Math.max(1, pagination.limit), 100); // Max 100 per page
        const page = Math.max(1, pagination.page);
        const { offset, pagination: paginationMeta } = calculatePagination(page, limit, total);

        span.attributes["total_count"] = total;
        span.attributes["page"] = paginationMeta.page;
        span.attributes["limit"] = paginationMeta.limit;

        // Get paginated results
        const logsRaw = await db
          .select()
          .from(tenantTables.documentAccessLogs)
          .where(whereClause)
          .orderBy(desc(tenantTables.documentAccessLogs.createdAt))
          .limit(paginationMeta.limit)
          .offset(offset);

        const logs = logsRaw.map((log) => ({
          ...log,
          changes: (log.changes as IDocumentAccessLog["changes"]) ?? null,
        }));

        return {
          items: logs,
          pagination: paginationMeta,
        };
      },
    );
  }

  /**
   * Build WHERE conditions for document access logs
   * @private
   */
  // Typed Promise<SQL[]> and awaited by callers; no inner await needed.
  // deno-lint-ignore require-await
  private async buildDocumentLogConditions(
    userId: string,
    _environmentId: string,
    tenantDb: Awaited<ReturnType<typeof getTenantDB>>,
    filters: {
      documentName?: string;
      documentId?: string;
      folderId?: string;
      ownerId?: string;
      accessedBy?: string;
      contentType?: string;
      accessType?: string;
      accessMethod?: string;
      startDate?: number;
      endDate?: number;
      uploadedAfter?: number;
      uploadedBefore?: number;
      updatedAfter?: number;
      updatedBefore?: number;
    },
  ): Promise<SQL[]> {
    const conditions: SQL[] = [];

    // Access control: user must own the document or have access via folder sharing
    const sharedFolderIdsSubquery = tenantDb
      .select({ folderId: tenantTables.documentFoldersSharedUsers.folderId })
      .from(tenantTables.documentFoldersSharedUsers)
      .where(
        and(
          eq(tenantTables.documentFoldersSharedUsers.userId, userId),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
        ),
      );

    conditions.push(
      or(
        eq(tenantTables.documents.ownerId, userId),
        inArray(tenantTables.documents.folderId, sharedFolderIdsSubquery),
      )!,
    );

    // Apply filters
    if (filters.documentName) {
      // Escape special LIKE wildcards to prevent pattern injection
      const escapedName = TextTransformations.escapeLikePattern(filters.documentName);
      conditions.push(ilike(tenantTables.documents.name, `%${escapedName}%`));
    }
    if (filters.documentId) {
      conditions.push(eq(tenantTables.documentAccessLogs.documentId, filters.documentId));
    }
    if (filters.folderId) {
      conditions.push(eq(tenantTables.documents.folderId, filters.folderId));
    }
    if (filters.ownerId) {
      conditions.push(eq(tenantTables.documents.ownerId, filters.ownerId));
    }
    if (filters.accessedBy) {
      conditions.push(eq(tenantTables.documentAccessLogs.userId, filters.accessedBy));
    }
    if (filters.contentType) {
      conditions.push(eq(tenantTables.documents.contentType, filters.contentType));
    }
    if (filters.accessType) {
      conditions.push(eq(tenantTables.documentAccessLogs.accessType, filters.accessType));
    }
    if (filters.accessMethod) {
      conditions.push(eq(tenantTables.documentAccessLogs.accessMethod, filters.accessMethod));
    }
    if (filters.startDate) {
      conditions.push(gte(tenantTables.documentAccessLogs.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(tenantTables.documentAccessLogs.createdAt, filters.endDate));
    }
    if (filters.uploadedAfter) {
      conditions.push(gte(tenantTables.documents.createdAt, filters.uploadedAfter));
    }
    if (filters.uploadedBefore) {
      conditions.push(lte(tenantTables.documents.createdAt, filters.uploadedBefore));
    }
    if (filters.updatedAfter) {
      conditions.push(gte(tenantTables.documents.updatedAt, filters.updatedAfter));
    }
    if (filters.updatedBefore) {
      conditions.push(lte(tenantTables.documents.updatedAt, filters.updatedBefore));
    }

    return conditions;
  }

  /**
   * Build WHERE conditions for folder access logs
   * @private
   */
  // Typed Promise<SQL[]> and awaited by callers; no inner await needed.
  // deno-lint-ignore require-await
  private async buildFolderLogConditions(
    userId: string,
    _environmentId: string,
    tenantDb: Awaited<ReturnType<typeof getTenantDB>>,
    filters: {
      folderId?: string;
      ownerId?: string;
      accessedBy?: string;
      accessType?: string;
      accessMethod?: string;
      startDate?: number;
      endDate?: number;
    },
  ): Promise<SQL[]> {
    const conditions: SQL[] = [];

    // Access control: user must own the folder or have access via sharing
    const sharedFolderIdsSubquery = tenantDb
      .select({ folderId: tenantTables.documentFoldersSharedUsers.folderId })
      .from(tenantTables.documentFoldersSharedUsers)
      .where(
        and(
          eq(tenantTables.documentFoldersSharedUsers.userId, userId),
          eq(tenantTables.documentFoldersSharedUsers.isActive, true),
        ),
      );

    conditions.push(
      or(
        eq(tenantTables.documentFolders.ownerId, userId),
        inArray(tenantTables.documentFolders.id, sharedFolderIdsSubquery),
      )!,
    );

    // Apply filters for folder logs
    if (filters.folderId) {
      conditions.push(eq(tenantTables.folderAccessLogs.folderId, filters.folderId));
    }
    if (filters.ownerId) {
      conditions.push(eq(tenantTables.documentFolders.ownerId, filters.ownerId));
    }
    if (filters.accessedBy) {
      conditions.push(eq(tenantTables.folderAccessLogs.userId, filters.accessedBy));
    }
    if (filters.accessType) {
      conditions.push(eq(tenantTables.folderAccessLogs.accessType, filters.accessType));
    }
    if (filters.accessMethod) {
      conditions.push(eq(tenantTables.folderAccessLogs.accessMethod, filters.accessMethod));
    }
    if (filters.startDate) {
      conditions.push(gte(tenantTables.folderAccessLogs.createdAt, filters.startDate));
    }
    if (filters.endDate) {
      conditions.push(lte(tenantTables.folderAccessLogs.createdAt, filters.endDate));
    }

    return conditions;
  }

  /**
   * Query all user activity logs across documents and folders
   *
   * Returns a unified view of all activity logs for documents and folders that the user
   * owns or has access to. Includes full metadata via JOINs.
   *
   * OPTIMIZED: Uses UNION ALL with database-level sorting and pagination to avoid
   * loading all logs into memory. Only fetches metadata for the current page.
   *
   * @param userId - Current user ID
   * @param environmentId - Current environment ID
   * @param filters - Filter criteria
   * @param pagination - Pagination parameters with sorting
   * @returns Promise<IPaginatedResult<IActivityLogItem>> - Paginated activity logs with metadata
   */
  async queryAllUserActivityLogs(
    userId: string,
    environmentId: string,
    filters: {
      documentName?: string;
      documentId?: string;
      folderId?: string;
      ownerId?: string;
      accessedBy?: string;
      contentType?: string;
      tags?: string[];
      accessType?: string;
      accessMethod?: string;
      startDate?: number;
      endDate?: number;
      uploadedAfter?: number;
      uploadedBefore?: number;
      updatedAfter?: number;
      updatedBefore?: number;
    } = {},
    pagination: IPaginationParams & {
      sortBy?: "accessedAt" | "documentName" | "accessType";
      sortOrder?: "asc" | "desc";
    } = { page: 1, limit: 50, sortBy: "accessedAt", sortOrder: "desc" },
  ): Promise<IPaginatedResult<IActivityLogItem>> {
    return await tracedWithServiceErrorHandling(
      "DocumentAccessLogService.queryAllUserActivityLogs",
      {
        service: "DocumentAccessLogService",
        method: "queryAllUserActivityLogs",
        section: loggerAppSections.DEBUG,
        details: { userId, environmentId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["page"] = pagination.page;
        span.attributes["limit"] = pagination.limit;
        span.attributes["sort_by"] = pagination.sortBy;
        span.attributes["sort_order"] = pagination.sortOrder;
        span.attributes["include_folders"] = !filters.tags || filters.tags.length === 0;

        const { page, limit, sortBy = "accessedAt", sortOrder = "desc" } = pagination;
        // Offset mirrors the shared calculatePagination formula (page clamped to >=1).
        // Metadata is built via calculatePagination below, once `total` is known.
        const offset = (Math.max(1, page) - 1) * limit;

        const includeFolders = !filters.tags || filters.tags.length === 0;

        const tenantDb = await getTenantDB(environmentId);
        const docConditions = await this.buildDocumentLogConditions(userId, environmentId, tenantDb, filters);
        const folderConditions = await this.buildFolderLogConditions(userId, environmentId, tenantDb, filters);

        const docLogsQuery = tenantDb
          .select({
            id: tenantTables.documentAccessLogs.id,
            log_type: sql<string>`'document'`.as("log_type"),
            entity_id: sql<string>`${tenantTables.documents.id}`.as("entity_id"),
            entity_name: sql<string>`${tenantTables.documents.name}`.as("entity_name"),
            content_type: sql<string | null>`${tenantTables.documents.contentType}`.as("content_type"),
            owner_id: sql<string>`${tenantTables.documents.ownerId}`.as("owner_id"),
            owner_first_name: sql<string>`${tenantTables.userProfiles.firstName}`.as("owner_first_name"),
            owner_last_name: sql<string>`${tenantTables.userProfiles.lastName}`.as("owner_last_name"),
            folder_id: sql<string | null>`${tenantTables.documents.folderId}`.as("folder_id"),
            folder_name: sql<string | null>`${tenantTables.documentFolders.name}`.as("folder_name"),
            access_type: sql<string>`${tenantTables.documentAccessLogs.accessType}`.as("access_type"),
            access_method: sql<string>`${tenantTables.documentAccessLogs.accessMethod}`.as("access_method"),
            accessed_by: sql<string | null>`${tenantTables.documentAccessLogs.userId}`.as("accessed_by"),
            accessed_at: sql<number>`CAST(${tenantTables.documentAccessLogs.createdAt} AS INTEGER)`.as("accessed_at"),
            document_created_at: sql<number | null>`CAST(${tenantTables.documents.createdAt} AS INTEGER)`.as("document_created_at"),
            document_updated_at: sql<number | null>`CAST(${tenantTables.documents.updatedAt} AS INTEGER)`.as("document_updated_at"),
            ip_address: sql<string | null>`NULL`.as("ip_address"),
            user_agent: sql<string | null>`NULL`.as("user_agent"),
            success: sql<boolean | null>`NULL`.as("success"),
            error_message: sql<string | null>`NULL`.as("error_message"),
          })
          .from(tenantTables.documentAccessLogs)
          .innerJoin(tenantTables.documents, eq(tenantTables.documentAccessLogs.documentId, tenantTables.documents.id))
          .leftJoin(tenantTables.userProfiles, eq(tenantTables.documents.ownerId, tenantTables.userProfiles.userId))
          .leftJoin(tenantTables.documentFolders, eq(tenantTables.documents.folderId, tenantTables.documentFolders.id))
          .where(and(...docConditions));

        let unionQuery;

        if (includeFolders) {
          const folderLogsQuery = tenantDb
            .select({
              id: tenantTables.folderAccessLogs.id,
              log_type: sql<string>`'folder'`.as("log_type"),
              entity_id: sql<string>`${tenantTables.documentFolders.id}`.as("entity_id"),
              entity_name: sql<string>`${tenantTables.documentFolders.name}`.as("entity_name"),
              content_type: sql<string | null>`NULL`.as("content_type"),
              owner_id: sql<string>`${tenantTables.documentFolders.ownerId}`.as("owner_id"),
              owner_first_name: sql<string>`${tenantTables.userProfiles.firstName}`.as("owner_first_name"),
              owner_last_name: sql<string>`${tenantTables.userProfiles.lastName}`.as("owner_last_name"),
              folder_id: sql<string | null>`${tenantTables.documentFolders.id}`.as("folder_id"),
              folder_name: sql<string | null>`${tenantTables.documentFolders.name}`.as("folder_name"),
              access_type: sql<string>`${tenantTables.folderAccessLogs.accessType}`.as("access_type"),
              access_method: sql<string>`${tenantTables.folderAccessLogs.accessMethod}`.as("access_method"),
              accessed_by: sql<string | null>`${tenantTables.folderAccessLogs.userId}`.as("accessed_by"),
              accessed_at: sql<number>`CAST(${tenantTables.folderAccessLogs.createdAt} AS INTEGER)`.as("accessed_at"),
              document_created_at: sql<number | null>`NULL`.as("document_created_at"),
              document_updated_at: sql<number | null>`NULL`.as("document_updated_at"),
              ip_address: tenantTables.folderAccessLogs.ipAddress,
              user_agent: tenantTables.folderAccessLogs.userAgent,
              success: tenantTables.folderAccessLogs.success,
              error_message: tenantTables.folderAccessLogs.errorMessage,
            })
            .from(tenantTables.folderAccessLogs)
            .innerJoin(tenantTables.documentFolders, eq(tenantTables.folderAccessLogs.folderId, tenantTables.documentFolders.id))
            .leftJoin(tenantTables.userProfiles, eq(tenantTables.documentFolders.ownerId, tenantTables.userProfiles.userId))
            .where(and(...folderConditions));

          unionQuery = docLogsQuery.unionAll(folderLogsQuery);
        } else {
          unionQuery = docLogsQuery;
        }

        const combinedLogs = tenantDb.$with("combined_logs").as(unionQuery);

        const sortColumn = sortBy === "accessedAt"
          ? combinedLogs.accessed_at
          : sortBy === "documentName"
          ? combinedLogs.entity_name
          : combinedLogs.access_type;

        const paginatedResults = await traced(
          "UnifiedAccessLog.queryActivityLogsPaginated",
          "db.query",
          () => {
            return tenantDb
              .with(combinedLogs)
              .select()
              .from(combinedLogs)
              .orderBy(sortOrder === "asc" ? asc(sortColumn) : desc(sortColumn))
              .limit(limit)
              .offset(offset);
          },
        );

        const totalCountResult = await traced(
          "UnifiedAccessLog.queryActivityLogsCount",
          "db.query",
          () => {
            return tenantDb
              .with(combinedLogs)
              .select({ total: count() })
              .from(combinedLogs);
          },
        );
        const total = Number(totalCountResult[0]?.total || 0);

        span.attributes["total_count"] = total;

        const rows = paginatedResults as unknown as Array<{
          id: string;
          log_type: "document" | "folder";
          entity_id: string;
          entity_name: string;
          content_type: string | null;
          owner_id: string;
          owner_first_name: string;
          owner_last_name: string;
          folder_id: string | null;
          folder_name: string | null;
          access_type: string;
          access_method: string;
          accessed_by: string | null;
          accessed_at: number;
          document_created_at: number | null;
          document_updated_at: number | null;
          ip_address: string | null;
          user_agent: string | null;
          success: boolean | null;
          error_message: string | null;
        }>;

        const documentIds = rows
          .filter((row) => row.log_type === "document")
          .map((row: { entity_id: string }) => row.entity_id);

        const accessorIds = [
          ...new Set(
            rows
              .map((row: { accessed_by: string | null }) => row.accessed_by)
              .filter((id): id is string => id !== null),
          ),
        ];

        const tagsMap = new Map<string, Array<{ id: string; name: string; color: string }>>();
        if (documentIds.length > 0) {
          const tagsResult = await traced(
            "UnifiedAccessLog.queryDocumentTags",
            "db.query",
            () => {
              return tenantDb
                .select({
                  documentId: tenantTables.documentTagAssignments.documentId,
                  tagId: tenantTables.documentTags.id,
                  tagName: tenantTables.documentTags.name,
                  tagColor: tenantTables.documentTags.color,
                })
                .from(tenantTables.documentTagAssignments)
                .innerJoin(tenantTables.documentTags, eq(tenantTables.documentTagAssignments.tagId, tenantTables.documentTags.id))
                .where(inArray(tenantTables.documentTagAssignments.documentId, documentIds));
            },
          );

          for (const tag of tagsResult) {
            if (!tagsMap.has(tag.documentId)) {
              tagsMap.set(tag.documentId, []);
            }
            tagsMap.get(tag.documentId)!.push({
              id: tag.tagId,
              name: tag.tagName,
              color: tag.tagColor || "#6b7280",
            });
          }
        }

        const accessorNamesMap = new Map<string, string>();
        if (accessorIds.length > 0) {
          const accessors = await traced(
            "UnifiedAccessLog.queryAccessorNames",
            "db.query",
            () => {
              return tenantDb
                .select({
                  id: tenantTables.userProfiles.userId,
                  firstName: tenantTables.userProfiles.firstName,
                  lastName: tenantTables.userProfiles.lastName,
                })
                .from(tenantTables.userProfiles)
                .where(inArray(tenantTables.userProfiles.userId, accessorIds));
            },
          );

          for (const accessor of accessors) {
            accessorNamesMap.set(accessor.id, `${accessor.firstName} ${accessor.lastName}`);
          }
        }

        let finalResults = rows;
        if (filters.tags && filters.tags.length > 0) {
          finalResults = finalResults.filter((row) => {
            if (row.log_type !== "document") return false;
            const docTags = tagsMap.get(row.entity_id) || [];
            return docTags.some((tag) => filters.tags!.some((filterTag) => tag.id === filterTag || tag.name === filterTag));
          });
        }

        const items: IActivityLogItem[] = finalResults.map((row) => ({
          id: row.id,
          documentId: row.log_type === "document" ? row.entity_id : null,
          documentName: row.log_type === "document" ? row.entity_name : null,
          documentType: row.content_type,
          documentContentType: row.content_type,
          ownerId: row.owner_id,
          ownerName: `${row.owner_first_name} ${row.owner_last_name}`.trim() || "Unknown User",
          folderId: row.folder_id,
          folderName: row.log_type === "folder" ? row.entity_name : row.folder_name,
          tags: row.log_type === "document" ? (tagsMap.get(row.entity_id) || []) : [],
          accessType: row.access_type,
          accessMethod: row.access_method,
          accessedBy: row.accessed_by,
          accessedByName: row.accessed_by ? (accessorNamesMap.get(row.accessed_by) || null) : null,
          accessedAt: row.accessed_at,
          accessDetails: null,
          ipAddress: row.ip_address,
          userAgent: row.user_agent,
          // SQLite stores booleans as 0/1. The boolean column mode is lost when the
          // value passes through the unionAll + `combined_logs` CTE re-select, so coerce
          // back to a real boolean here (preserving null for document logs).
          success: row.success === null ? null : Boolean(row.success),
          errorMessage: row.error_message,
          documentCreatedAt: row.document_created_at,
          documentUpdatedAt: row.document_updated_at,
        }));

        const { pagination: paginationMeta } = calculatePagination(page, limit, total);

        span.attributes["items_returned"] = items.length;

        return {
          items,
          pagination: paginationMeta,
        };
      },
    );
  }
}
