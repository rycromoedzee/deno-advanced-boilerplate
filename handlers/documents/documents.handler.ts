/**
 * @file handlers/documents/documents.handler.ts
 * @description Generated CRUD handlers for documents
 *
 * Standard CRUD handlers use the base handler factory.
 * Special handlers (upload, download, duplicate, restore) remain separate.
 * Reduced from ~450 lines (8 CRUD handlers × 60 lines) to ~250 lines (44% reduction).
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getDocumentArchiveService } from "@services/documents-archive/index.ts";
import { getDocumentCommentService } from "@services/documents-comments/index.ts";
import {
  getDocumentDeleteService,
  getDocumentDuplicateService,
  getDocumentReadService,
  getDocumentWriteService,
  getFolderReadService,
} from "@services/documents/index.ts";
import { getDocumentMoveService } from "@services/documents-operations/index.ts";
import { getDocumentSharingPublicService, getDocumentSharingService } from "@services/documents-sharing/index.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/index.ts";
import { DocumentCrudHelpers } from "@services/documents/document-crud.helpers.ts";
import {
  archiveDocumentRoute,
  deleteDocumentRoute,
  duplicateDocumentRoute,
  getDocumentRoute,
  getDocumentTreeRoute,
  listDocumentsRoute,
  listSharedDocumentsRoute,
  moveDocumentRoute,
  restoreDocumentRoute,
  updateDocumentRoute,
} from "@routes/documents/documents.route.ts";
import { SchemaDocumentDetailedResponse, SchemaDocumentListResponse, SchemaDocumentResponse } from "@models/documents/index.ts";
import { SchemaDocumentCommentApiResponse } from "@models/documents/comment.model.ts";
import { IDocumentAccessLogItem, SchemaDocumentAccessLogItem, SchemaDocumentSharedUser } from "@models/documents/document-sharing.model.ts";
import { IPaginationMetadata } from "@models/shared.model.ts";
import type { IPaginatedResult } from "@interfaces/documents.ts";
import { loggerAppSections } from "@logger/index.ts";
import { validateDocumentInputFields } from "@utils/documents/security-logging.ts";
import { SchemaDocumentTreeResponse } from "@models/documents/folder.model.ts";

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { inArray } from "@deps";
import { DataAccessService } from "@services/encryption/index.ts";
import { getDocumentFolderPermissionService } from "@services/document-folders/singletons.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";

/**
 * List documents handler
 */
export const listDocumentsHandler = defineHandler(
  {
    route: listDocumentsRoute,
    operationName: "document_list",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentListResponse,
    errorKey: "DOCUMENT.LIST_FAILED",
  },
  async (context) => {
    const query = context.query;

    // Build filters
    const filters = {
      folderId: query.folderId,
      contentType: query.contentType,
      search: query.search,
      archived: query.archived,
      isFavorited: query.isFavorited,
      tags: query.tags ? query.tags.split(",") : undefined,
    };

    // Build pagination params
    const pagination = {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    // If folderId is specified, verify the requesting user has READ access to that folder.
    // This prevents information leakage even if document-level data keys were improperly retained.
    if (filters.folderId) {
      const folderPermissionService = getDocumentFolderPermissionService();
      const hasAccess = await folderPermissionService.checkFolderAccess(
        filters.folderId,
        context.userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );
      if (!hasAccess) {
        return {
          data: {
            items: [],
            pagination: {
              page: 1,
              limit: pagination.limit ?? 20,
              total: 0,
              totalPages: 0,
              hasNext: false,
              hasPrev: false,
            },
          },
          status: 200,
        };
      }
    }

    const service = getDocumentReadService();
    const result = await service.findByUser(
      context.userId,
      context.environmentId,
      filters,
      pagination,
    );

    return {
      data: {
        items: result.items,
        pagination: result.pagination as IPaginationMetadata,
      },
      status: 200,
    };
  },
);

/**
 * List shared documents handler (documents shared with the current user)
 */
export const listSharedDocumentsHandler = defineHandler(
  {
    route: listSharedDocumentsRoute,
    operationName: "document_list_shared",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentListResponse,
    errorKey: "DOCUMENT.LIST_FAILED",
  },
  async (context) => {
    const query = context.query;

    // Build filters
    const filters = {
      folderId: query.folderId,
      contentType: query.contentType,
      search: query.search,
      archived: query.archived,
      isFavorited: query.isFavorited,
      tags: query.tags ? query.tags.split(",") : undefined,
    };

    // Build pagination params
    const pagination = {
      page: query.page,
      limit: query.limit,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    const service = getDocumentReadService();
    const result = await service.findByUser(
      context.userId,
      context.environmentId,
      filters,
      pagination,
      "shared", // Only show documents shared with the user
    );

    return {
      data: {
        items: result.items,
        pagination: result.pagination as IPaginationMetadata,
      },
      status: 200,
    };
  },
);

/**
 * Get document handler (includes comments and access logs)
 */
export const getDocumentHandler = defineHandler(
  {
    route: getDocumentRoute,
    operationName: "document_get",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentDetailedResponse,
    errorKey: "DOCUMENT.NOT_FOUND",
  },
  async (context) => {
    const params = context.params;
    const documentId = params.id;

    const service = getDocumentReadService();
    const document = await service.findById(documentId, context.userId, context.environmentId);

    if (!document) {
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // Increment view count off the response critical path.
    //
    // This is a soft counter write. The local libSQL driver executes writes
    // synchronously; when run inline the synchronous execute (especially under
    // SQLITE_BUSY write-lock contention on a freshly accessed document) blocks
    // the event loop and stalls the response flush — observed as ~1s TTFB even
    // though the traced spans report a few ms. defer:true runs it on a macrotask
    // after the response is flushed, snapshotting and re-establishing the tenant
    // context so getTenantDB() inside incrementViewCount resolves correctly.
    fireAndForgetOperation(
      "document-get-increment-view-count",
      () => DocumentCrudHelpers.incrementViewCount(documentId),
      { defer: true, section: loggerAppSections.DOCUMENTS },
    );

    // Fetch comments, access logs, and shared users in parallel
    const commentService = getDocumentCommentService();
    const accessLogService = getDocumentAccessLogService();
    const sharingService = getDocumentSharingService();
    const publicSharingService = getDocumentSharingPublicService();

    // Fetch all data in parallel with proper error handling
    const commentsPromise = commentService
      .listCommentsThreaded(documentId, { includeArchived: false }, context.userId)
      .catch(() => ({
        items: [],
        pagination: {
          page: 1,
          limit: 50,
          total: 0,
          totalPages: 0,
          hasNext: false,
          hasPrev: false,
        },
      } as Awaited<ReturnType<typeof commentService.listCommentsThreaded>>));

    const accessLogsPromise = accessLogService.queryDocumentLogs(
      { documentId },
      { page: 1, limit: 10000 },
    ).catch(() => ({
      items: [],
      pagination: {
        page: 1,
        limit: 10000,
        total: 0,
        totalPages: 0,
        hasNext: false,
        hasPrev: false,
      },
    } as IPaginatedResult<IDocumentAccessLogItem>));

    const internalUsersPromise = sharingService.listSharedUsers(documentId, context.userId)
      .catch(() => ({ internalUsers: [] } as Awaited<ReturnType<typeof sharingService.listSharedUsers>>));

    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(context.c);

    const publicSharesPromise = publicSharingService.listPublicShares(documentId, context.userId, encryptionKey.key)
      .catch(() => ({ publicShares: [] } as Awaited<ReturnType<typeof publicSharingService.listPublicShares>>));

    const [commentsResult, accessLogsResult, internalUsersResult, publicSharesResult] = await Promise.all([
      commentsPromise,
      accessLogsPromise,
      internalUsersPromise,
      publicSharesPromise,
    ]);

    const parsedComments = commentsResult.items.map((comment) => SchemaDocumentCommentApiResponse.parse(comment));
    const parsedAccessLogItems = accessLogsResult.items.map((log) =>
      SchemaDocumentAccessLogItem.parse({
        id: log.id,
        documentId: log.documentId || documentId,
        userId: log.userId,
        accessType: log.accessType,
        accessMethod: log.accessMethod,
        createdAt: log.createdAt,
      })
    );

    // Fetch user details for shared users (excluding the current user)
    const otherSharedUsers = internalUsersResult.internalUsers.filter(
      (sharedUser) => sharedUser.userId !== context.userId,
    );

    let userDetailsMap = new Map<string, { firstName: string; lastName: string; email: string }>();
    if (otherSharedUsers.length > 0) {
      const tenantDb = await getTenantDB();
      const sharedUserIds = otherSharedUsers.map((u) => u.userId);
      const userRows = await tenantDb
        .select({
          userId: tenantTables.userProfiles.userId,
          firstName: tenantTables.userProfiles.firstName,
          lastName: tenantTables.userProfiles.lastName,
          email: tenantTables.userProfiles.email,
        })
        .from(tenantTables.userProfiles)
        .where(inArray(tenantTables.userProfiles.userId, sharedUserIds));
      userDetailsMap = new Map(userRows.map((u) => [u.userId, u]));
    }

    const sharedUsersWithDetails = otherSharedUsers
      .map((sharedUser) => {
        const user = userDetailsMap.get(sharedUser.userId);
        if (!user) return null;

        return SchemaDocumentSharedUser.parse({
          userId: sharedUser.userId,
          email: user.email,
          name: `${user.firstName} ${user.lastName}`,
          permission: sharedUser.permissionLevel,
          sharedAt: sharedUser.grantedAt,
        });
      })
      .filter((user): user is NonNullable<typeof user> => user !== null);

    const documentWithExtras = {
      ...document,
      comments: parsedComments,
      accessLogs: parsedAccessLogItems,
      sharedUsers: sharedUsersWithDetails,
      publicShares: publicSharesResult.publicShares.map((share) => ({
        token: share.shareToken,
        url: share.publicUrl,
        hasPassword: share.isPasswordProtected,
        expiresAt: share.expiresAt,
        recipientEmail: share.recipientEmail,
        createdAt: share.createdAt,
      })),
    };

    return {
      data: documentWithExtras,
      status: 200,
    };
  },
);

/**
 * Update document handler
 */
export const updateDocumentHandler = defineHandler(
  {
    route: updateDocumentRoute,
    operationName: "document_update",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentResponse,
    errorKey: "DOCUMENT.UPDATE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const documentId = params.id;

    // Security validation for user-provided inputs
    const threatsDetected = await validateDocumentInputFields(context.c, {
      name: body.name,
      description: body.description ?? undefined,
      tags: body.tags as string | string[] | undefined,
      metadata: body.metadata,
    });
    if (threatsDetected) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentWriteService();
    const updatedDocument = await service.update(
      documentId,
      body,
      context.userId,
      context.environmentId,
    );

    return {
      data: updatedDocument,
      status: 200,
    };
  },
);

/**
 * Delete document handler
 */
export const deleteDocumentHandler = defineHandler(
  {
    route: deleteDocumentRoute,
    operationName: "document_delete",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT.DELETE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const documentId = params.id;

    if (!documentId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentDeleteService();
    await service.hardDelete(documentId, context.userId, context.environmentId);

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Archive document handler
 */
export const archiveDocumentHandler = defineHandler(
  {
    route: archiveDocumentRoute,
    operationName: "document_archive",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT.ARCHIVE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const documentId = params.id;

    if (!documentId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentArchiveService();

    if (body.isArchived) {
      await service.archive(documentId, context.userId, context.environmentId);
    } else {
      await service.restore(documentId, context.userId, context.environmentId);
    }

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Move document handler (synchronous - single document moves are fast)
 */
export const moveDocumentHandler = defineHandler(
  {
    route: moveDocumentRoute,
    operationName: "document_move",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT.MOVE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const documentId = params.id;

    if (!documentId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentMoveService();
    await service.move(
      documentId,
      body.targetFolderId,
      context.userId,
      context.environmentId,
    );

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Duplicate document handler
 */
export const duplicateDocumentHandler = defineHandler(
  {
    route: duplicateDocumentRoute,
    operationName: "document_duplicate",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentResponse,
    errorKey: "DOCUMENT.DUPLICATE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const documentId = params.id;

    if (!documentId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentDuplicateService();
    const duplicate = await service.duplicate(
      documentId,
      context.userId,
      context.environmentId,
      {
        name: body.name,
        folderId: body.folderId,
      },
    );

    return {
      data: duplicate,
      status: 201,
    };
  },
);

/**
 * Restore document handler
 */
export const restoreDocumentHandler = defineHandler(
  {
    route: restoreDocumentRoute,
    operationName: "document_restore",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT.RESTORE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const documentId = params.id;

    if (!documentId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentArchiveService();
    await service.restore(documentId, context.userId, context.environmentId);

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Get document tree handler
 * Returns a recursive structure with all folders and documents the user has access to
 */
export const getDocumentTreeHandler = defineHandler(
  {
    route: getDocumentTreeRoute,
    operationName: "document_tree",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentTreeResponse,
    errorKey: "DOCUMENT.TREE_FAILED",
  },
  async (context) => {
    const query = context.query;
    // Handle string "null" or actual null - convert string "null" to actual null
    const rootId = query.rootId === null || query.rootId === undefined || query.rootId === "" || query.rootId === "null"
      ? null
      : query.rootId;
    const maxDepth = query.maxDepth ?? 10;

    const folderService = getFolderReadService();
    const contents = await folderService.getRecursiveContents(
      rootId,
      context.userId,
      context.environmentId,
      maxDepth,
    );

    // Return unified tree structure - all items follow the same IDocumentTreeItem structure
    // Documents have children: null, folders have children: IDocumentTreeItem[]
    return {
      data: contents,
      status: 200,
    };
  },
);
