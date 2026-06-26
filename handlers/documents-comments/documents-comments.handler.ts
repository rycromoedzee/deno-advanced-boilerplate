/**
 * @file handlers/documents-comments/documents-comments.handler.ts
 * @description CRUD handlers for document comments
 *
 * Note: Resolve/unresolve handlers remain as separate custom handlers.
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentCommentService } from "@services/documents-comments/index.ts";
import {
  createCommentRoute,
  deleteCommentRoute,
  getCommentRoute,
  listCommentsRoute,
  resolveCommentRoute,
  unresolveCommentRoute,
} from "@routes/documents-comments/documents-comments.route.ts";
import { SchemaDocumentCommentApiResponse } from "@models/documents/comment.model.ts";
import { throwHttpError } from "@utils/http-exception.ts";

/**
 * Create comment handler
 */
export const createCommentHandler = defineHandler(
  {
    route: createCommentRoute,
    operationName: "document_comment_create",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentCommentApiResponse,
  },
  async (context) => {
    const { documentId } = context.params;
    const service = getDocumentCommentService();
    const comment = await service.createComment(documentId, context.body, context.userId);
    return {
      data: SchemaDocumentCommentApiResponse.parse(comment),
      status: 201,
    };
  },
);

/**
 * Get comment handler
 */
export const getCommentHandler = defineHandler<typeof getCommentRoute>(
  {
    route: getCommentRoute,
    operationName: "document_comment_get",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentCommentApiResponse,
    errorKey: "DOCUMENT_COMMENT.GET_FAILED",
  },
  async (context) => {
    const { documentId, commentId } = context.params;
    const service = getDocumentCommentService();
    const comment = await service.getCommentWithAuthor(commentId, documentId, context.userId);
    if (!comment) {
      throwHttpError("COMMON.NOT_FOUND");
    }
    return {
      data: comment,
      status: 200,
    };
  },
);

/**
 * Delete comment handler
 */
export const deleteCommentHandler = defineHandler<typeof deleteCommentRoute>(
  {
    route: deleteCommentRoute,
    operationName: "document_comment_delete",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT_COMMENT.DELETE_FAILED",
  },
  async (context) => {
    const { documentId, commentId } = context.params;
    const service = getDocumentCommentService();
    await service.deleteComment(commentId, documentId, context.userId);
    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * List comments handler
 */
export const listCommentsHandler = defineHandler<typeof listCommentsRoute>(
  {
    route: listCommentsRoute,
    operationName: "document_comment_list",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    errorKey: "DOCUMENT_COMMENT.LIST_FAILED",
  },
  async (context) => {
    const { documentId } = context.params;
    const query = context.query;
    const service = getDocumentCommentService();

    const filters = {
      isResolved: query.isResolved,
      includeArchived: query.includeArchived,
      page: query.page,
      limit: query.limit,
    };

    const result = await service.listCommentsThreaded(documentId, filters, context.userId);
    return {
      data: {
        items: result.items.map((comment) => SchemaDocumentCommentApiResponse.parse(comment)),
        pagination: result.pagination,
      },
      status: 200,
    };
  },
);

/**
 * Custom resolve handler (not part of standard CRUD)
 */
export const resolveCommentHandler = defineHandler(
  {
    route: resolveCommentRoute,
    operationName: "document_comment_resolve",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentCommentApiResponse,
  },
  async (context) => {
    const { documentId, commentId } = context.params;
    const service = getDocumentCommentService();
    const comment = await service.resolveComment(commentId, documentId, context.userId);

    return {
      data: SchemaDocumentCommentApiResponse.parse(comment),
      status: 200,
    };
  },
);

/**
 * Custom unresolve handler (not part of standard CRUD)
 */
export const unresolveCommentHandler = defineHandler(
  {
    route: unresolveCommentRoute,
    operationName: "document_comment_unresolve",
    entityType: "document_comment",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentCommentApiResponse,
  },
  async (context) => {
    const { documentId, commentId } = context.params;
    const service = getDocumentCommentService();
    const comment = await service.unresolveComment(commentId, documentId, context.userId);

    return {
      data: SchemaDocumentCommentApiResponse.parse(comment),
      status: 200,
    };
  },
);
