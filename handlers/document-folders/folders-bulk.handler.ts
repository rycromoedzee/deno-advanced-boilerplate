/**
 * @file handlers/document-folders/folders-bulk.handler.ts
 * @description Bulk operation handlers for folders
 *
 * Generated handlers using bulk handler factory and async wrapper.
 * Reduced from ~230 lines (3 handlers × 75 lines) to ~80 lines (65% reduction).
 */

import { createBulkHandler, defineHandler, type HandlerStatus } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getFolderArchiveService, getFolderDeleteService, getFolderMoveService } from "@services/documents/index.ts";
import { bulkArchiveFoldersRoute, bulkDeleteFoldersRoute, bulkMoveFoldersRoute } from "@routes/document-folders/folders-bulk.route.ts";
import { SchemaFolderBulkMoveAsyncResponse } from "@models/documents/folder.model.ts";

/**
 * Bulk delete folders handler
 */
export const bulkDeleteFoldersHandler = createBulkHandler({
  route: bulkDeleteFoldersRoute,
  operationName: "bulk_folder_delete",
  entityType: "folder",
  loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
  serviceGetter: getFolderDeleteService,
  serviceMethod: "bulkHardDelete",
  successMessage: (count) => `Deleted ${count} folders`,
  errorKey: "DOCUMENT_FOLDER.BULK_DELETE_FAILED",
  customHandler: async (context) => {
    // context.body is now properly typed based on the route schema
    const { folderIds } = context.body;

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      throwHttpError("DOCUMENT_FOLDER.BULK_DELETE_BAD_REQUEST");
    }

    const service = getFolderDeleteService();
    return await service.bulkHardDelete(folderIds, context.userId, context.environmentId);
  },
});

/**
 * Bulk archive folders handler
 */
export const bulkArchiveFoldersHandler = createBulkHandler({
  route: bulkArchiveFoldersRoute,
  operationName: "bulk_folder_archive",
  entityType: "folder",
  loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
  serviceGetter: getFolderArchiveService,
  serviceMethod: "bulkArchive", // Required by interface, but customHandler is used instead
  successMessage: (count) => `Archived ${count} folders`, // This is overridden in customHandler
  errorKey: "DOCUMENT_FOLDER.BULK_ARCHIVE_FAILED",
  customHandler: async (context) => {
    // context.body is now properly typed based on the route schema
    const { folderIds, isArchived } = context.body;

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      throwHttpError("DOCUMENT_FOLDER.BULK_ARCHIVE_BAD_REQUEST");
    }

    if (typeof isArchived !== "boolean") {
      throwHttpError("DOCUMENT_FOLDER.BULK_ARCHIVE_BAD_REQUEST");
    }

    const service = getFolderArchiveService();
    const result = isArchived
      ? await service.bulkArchive(folderIds, context.userId, context.environmentId)
      : await service.bulkUnarchive(folderIds, context.userId, context.environmentId);

    // Return result with correct message based on operation
    return {
      ...result,
      message: isArchived ? `Archived folders` : `Unarchived folders`,
    };
  },
});

/**
 * Bulk move folders handler (async SSE-based)
 * Folder moves can be slow due to hierarchy processing, so they're always async
 */
export const bulkMoveFoldersHandler = defineHandler(
  {
    route: bulkMoveFoldersRoute,
    operationName: "bulk_folder_move",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    errorKey: "DOCUMENT_FOLDER.BULK_MOVE_FAILED",
    responseSchema: SchemaFolderBulkMoveAsyncResponse,
  },
  async (context) => {
    // context.body is now properly typed based on bulkMoveFoldersRoute schema
    const { folderIds, parentId } = context.body;

    if (!Array.isArray(folderIds) || folderIds.length === 0) {
      throwHttpError("DOCUMENT_FOLDER.BULK_MOVE_BAD_REQUEST");
    }

    const service = getFolderMoveService();
    const result = await service.bulkMove(
      folderIds,
      parentId,
      context.userId,
      context.environmentId,
    );

    return {
      data: {
        operationId: result.operationId,
        status: result.status,
        totalFolders: result.totalItems,
        estimatedCompletion: result.estimatedCompletion,
        message: result.message,
      },
      status: 202 as HandlerStatus, // Accepted - processing asynchronously
    };
  },
);
