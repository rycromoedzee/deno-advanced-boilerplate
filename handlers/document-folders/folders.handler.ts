/**
 * @file handlers/document-folders/folders.handler.ts
 * @description Generated CRUD handlers for folders
 *
 * Standard CRUD handlers use the base handler factory.
 * Special handlers remain separate.
 * Reduced from ~550 lines (11 handlers × 50 lines) to ~220 lines (60% reduction).
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  getFolderArchiveService,
  getFolderDeleteService,
  getFolderDuplicateService,
  getFolderMoveService,
  getFolderReadService,
  getFolderWriteService,
} from "@services/documents/index.ts";
import {
  archiveFolderRoute,
  createFolderRoute,
  deleteFolderRoute,
  duplicateFolderRoute,
  getFolderRoute,
  listFoldersRoute,
  listSharedFoldersRoute,
  moveFolderRoute,
  restoreFolderRoute,
  updateFolderRoute,
} from "@routes/document-folders/folders.route.ts";
import { SchemaDocumentFolderResponse, SchemaFolderBulkMoveAsyncResponse, SchemaFolderListResponse } from "@models/documents/index.ts";
import { IPaginationMetadata } from "@models/shared.model.ts";
import { validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";

/**
 * Create folder handler
 */
export const createFolderHandler = defineHandler(
  {
    route: createFolderRoute,
    operationName: "folder_create",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaDocumentFolderResponse,
    errorKey: "DOCUMENT_FOLDER.CREATE_FAILED",
  },
  async (context) => {
    const body = context.body;

    // Security validation for user-provided inputs
    const inputsToValidate: Record<string, string> = {};
    if (body.name) inputsToValidate.name = body.name;
    if (body.description) inputsToValidate.description = body.description;
    if ("tags" in body && Array.isArray((body as { tags?: unknown }).tags)) {
      inputsToValidate.tags = JSON.stringify((body as { tags?: unknown }).tags);
    }
    if ("metadata" in body) {
      inputsToValidate.metadata = JSON.stringify((body as { metadata?: unknown }).metadata);
    }

    if (Object.keys(inputsToValidate).length > 0) {
      const threatsDetected = await validateAndLogSecurityThreats(context.c, inputsToValidate);
      if (threatsDetected) {
        throwHttpError("COMMON.BAD_REQUEST");
      }
    }

    const service = getFolderWriteService();
    const folder = await service.create(
      body,
      context.userId,
      context.environmentId,
    );

    return {
      data: folder,
      status: 201,
    };
  },
);

/**
 * List folders handler
 */
export const listFoldersHandler = defineHandler(
  {
    route: listFoldersRoute,
    operationName: "folder_list",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaFolderListResponse,
    errorKey: "DOCUMENT_FOLDER.FETCH",
  },
  async (context) => {
    const query = context.query;

    const filters = {
      archived: query.archived,
      search: query.search,
    };

    const service = getFolderReadService();

    // Get folders
    const folders = await service.findChildren(
      query.parentFolderId || null,
      context.userId,
      context.environmentId,
      filters,
    );

    // Get breadcrumb path for the current folder
    const breadcrumbs = await service.getFolderPath(
      query.parentFolderId || null,
      context.userId,
      context.environmentId,
    );

    return {
      data: {
        items: folders,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: folders.length,
          totalPages: Math.ceil(folders.length / query.limit),
          hasNext: query.page < Math.ceil(folders.length / query.limit),
          hasPrev: query.page > 1,
        } as IPaginationMetadata,
        breadcrumbs,
      },
      status: 200,
    };
  },
);

/**
 * List shared folders handler (folders shared with the current user)
 */
export const listSharedFoldersHandler = defineHandler(
  {
    route: listSharedFoldersRoute,
    operationName: "folder_list_shared",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaFolderListResponse,
    errorKey: "DOCUMENT_FOLDER.FETCH",
  },
  async (context) => {
    const query = context.query;

    const filters = {
      archived: query.archived,
      search: query.search,
    };

    const service = getFolderReadService();

    // Get folders (only shared ones)
    const folders = await service.findChildren(
      query.parentFolderId || null,
      context.userId,
      context.environmentId,
      filters,
      "shared", // Only show folders shared with the user
    );

    // Get breadcrumb path for the current folder
    const breadcrumbs = await service.getFolderPath(
      query.parentFolderId || null,
      context.userId,
      context.environmentId,
    );

    return {
      data: {
        items: folders,
        pagination: {
          page: query.page,
          limit: query.limit,
          total: folders.length,
          totalPages: Math.ceil(folders.length / query.limit),
          hasNext: query.page < Math.ceil(folders.length / query.limit),
          hasPrev: query.page > 1,
        } as IPaginationMetadata,
        breadcrumbs,
      },
      status: 200,
    };
  },
);

/**
 * Get folder handler
 */
export const getFolderHandler = defineHandler(
  {
    route: getFolderRoute,
    operationName: "folder_get",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaDocumentFolderResponse,
    errorKey: "DOCUMENT_FOLDER.FETCH",
  },
  async (context) => {
    const params = context.params;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderReadService();
    const folder = await service.findById(folderId, context.userId, context.environmentId);

    if (!folder) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    return {
      data: folder,
      status: 200,
    };
  },
);

/**
 * Update folder handler
 */
export const updateFolderHandler = defineHandler(
  {
    route: updateFolderRoute,
    operationName: "folder_update",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaDocumentFolderResponse,
    errorKey: "DOCUMENT_FOLDER.UPDATE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    // Security validation for user-provided inputs
    const inputsToValidate: Record<string, string> = {};
    if (body.name) inputsToValidate.name = body.name;
    if (body.description) inputsToValidate.description = body.description;
    if ("tags" in body && Array.isArray((body as { tags?: unknown }).tags)) {
      inputsToValidate.tags = JSON.stringify((body as { tags?: unknown }).tags);
    }
    if ("metadata" in body) {
      inputsToValidate.metadata = JSON.stringify((body as { metadata?: unknown }).metadata);
    }

    if (Object.keys(inputsToValidate).length > 0) {
      const threatsDetected = await validateAndLogSecurityThreats(context.c, inputsToValidate);
      if (threatsDetected) {
        throwHttpError("COMMON.BAD_REQUEST");
      }
    }

    const service = getFolderWriteService();
    const folder = await service.update(
      folderId,
      body,
      context.userId,
      context.environmentId,
    );

    return {
      data: folder,
      status: 200,
    };
  },
);

/**
 * Delete folder handler
 */
export const deleteFolderHandler = defineHandler(
  {
    route: deleteFolderRoute,
    operationName: "folder_delete",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    errorKey: "DOCUMENT_FOLDER.DELETE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderDeleteService();
    await service.hardDelete(folderId, context.userId, context.environmentId);

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Archive folder handler
 */
export const archiveFolderHandler = defineHandler(
  {
    route: archiveFolderRoute,
    operationName: "folder_archive",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    errorKey: "DOCUMENT.ARCHIVE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body as { isArchived: boolean };
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const { isArchived } = body;

    if (typeof isArchived !== "boolean") {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderArchiveService();

    if (isArchived) {
      await service.archive(folderId, context.userId, context.environmentId);
    } else {
      await service.unarchive(folderId, context.userId, context.environmentId);
    }

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Restore folder handler
 */
export const restoreFolderHandler = defineHandler(
  {
    route: restoreFolderRoute,
    operationName: "folder_restore",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    errorKey: "DOCUMENT_FOLDER.UPDATE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderArchiveService();
    await service.restore(folderId, context.userId, context.environmentId);

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Move folder handler (async SSE-based)
 * Folder moves can be slow due to hierarchy processing, so they're always async
 */
export const moveFolderHandler = defineHandler(
  {
    route: moveFolderRoute,
    operationName: "folder_move",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaFolderBulkMoveAsyncResponse,
    errorKey: "DOCUMENT_FOLDER.MOVE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderMoveService();
    const result = await service.move(
      folderId,
      body.targetParentFolderId,
      context.userId,
      context.environmentId,
    );

    return {
      data: {
        operationId: result.operationId,
        status: result.status,
        estimatedCompletion: result.estimatedCompletion,
        message: result.message,
      },
      status: 202, // Accepted - processing asynchronously
    };
  },
);

/**
 * Duplicate folder handler
 */
export const duplicateFolderHandler = defineHandler(
  {
    route: duplicateFolderRoute,
    operationName: "folder_duplicate",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaDocumentFolderResponse,
    errorKey: "DOCUMENT.DUPLICATE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const body = context.body;
    const folderId = params.id;

    if (!folderId) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const { name, parentId } = body;

    if (!name || typeof name !== "string") {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    // Security validation for user-provided inputs
    const inputsToValidate: Record<string, string> = { name };
    if (parentId) inputsToValidate.parentId = parentId;

    const threatsDetected = await validateAndLogSecurityThreats(context.c, inputsToValidate);
    if (threatsDetected) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getFolderDuplicateService();
    const duplicatedFolder = await service.duplicate(
      folderId,
      name,
      parentId || null,
      context.userId,
      context.environmentId,
    );

    return {
      data: duplicatedFolder,
      status: 201,
    };
  },
);
