/**
 * @file handlers/documents/documents-bulk.handler.ts
 * @description Bulk operation handlers for documents
 *
 * Generated handlers using bulk handler factory.
 * Reduced from ~280 lines (4 handlers × 70 lines) to ~40 lines (88% reduction).
 */

import { createBulkHandler, defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentArchiveService } from "@services/documents-archive/index.ts";
import { getDocumentDeleteService } from "@services/documents/index.ts";
import { getDocumentMoveService } from "@services/documents-operations/index.ts";
import { getDocumentPermissionService } from "@services/documents-permission/index.ts";
import { getDocumentTagService } from "@services/documents-tags/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { bulkArchiveRoute, bulkAssignTagsRoute, bulkDeleteRoute, bulkMoveRoute } from "@routes/documents/documents-bulk.route.ts";

/**
 * Bulk delete handler
 */
export const bulkDeleteHandler = createBulkHandler({
  route: bulkDeleteRoute,
  operationName: "bulk_delete",
  entityType: "document",
  loggerSection: loggerAppSections.DOCUMENTS,
  serviceGetter: getDocumentDeleteService,
  serviceMethod: "bulkHardDelete",
  successMessage: (count) => `Deleted ${count} documents`,
  errorKey: "DOCUMENT.BULK_DELETE_FAILED",
});

/**
 * Bulk archive handler
 */
export const bulkArchiveHandler = createBulkHandler({
  route: bulkArchiveRoute,
  operationName: "bulk_archive",
  entityType: "document",
  loggerSection: loggerAppSections.DOCUMENTS,
  serviceGetter: getDocumentArchiveService,
  serviceMethod: "bulkArchive",
  successMessage: (count) => `Archived ${count} documents`,
  errorKey: "DOCUMENT.BULK_ARCHIVE_FAILED",
});

/**
 * Bulk move handler with async SSE support
 * Returns operation ID and status for client to track via SSE
 */
export const bulkMoveHandler = defineHandler(
  {
    route: bulkMoveRoute,
    operationName: "bulk_move",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT.BULK_MOVE_FAILED",
  },
  async (context) => {
    const body = context.body;

    if (!body.documentIds || !Array.isArray(body.documentIds) || body.documentIds.length === 0) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentMoveService();
    const asyncMode = body.asyncMode ?? true; // Default to async mode

    const result = await service.bulkMove(
      body.documentIds,
      body.targetFolderId,
      context.userId,
      context.environmentId,
      asyncMode,
    );

    // Check if result is async operation or sync result
    if ("operationId" in result) {
      // Async mode - return 202 with operation ID
      return {
        data: {
          operationId: result.operationId,
          status: result.status,
          estimatedCompletion: result.estimatedCompletion,
          message: result.message,
          totalItems: result.totalItems,
        },
        status: 202, // Accepted - processing asynchronously
      };
    } else {
      // Sync mode - return 200 with operation result
      return {
        data: result,
        status: 200,
      };
    }
  },
);

/**
 * Bulk assign tags handler
 * Supports both tagIds and tagNames
 */
export const bulkAssignTagsHandler = createBulkHandler({
  route: bulkAssignTagsRoute,
  operationName: "bulk_assign_tags",
  entityType: "document",
  loggerSection: loggerAppSections.DOCUMENTS,
  serviceGetter: getDocumentTagService,
  successMessage: (count) => `Assigned tags to ${count} documents`,
  errorKey: "DOCUMENT.BULK_ASSIGN_TAGS_FAILED",
  customHandler: async (context) => {
    const body = context.body;
    const tagService = getDocumentTagService();
    const permissionService = getDocumentPermissionService();

    // Resolve tagNames to tagIds if tagNames are provided
    let tagIds: string[];
    if (body.tagNames) {
      // Convert tag names to TagInput format and resolve/create them
      const tagInputs = body.tagNames.map((name: string) => name);
      tagIds = await tagService.resolveOrCreateTags(tagInputs, context.userId);
    } else if (body.tagIds) {
      tagIds = body.tagIds;
    } else {
      tagIds = [];
    }

    return await tagService.bulkAssignTags(
      body.documentIds,
      tagIds,
      context.userId,
      context.environmentId,
      permissionService,
    );
  },
});
