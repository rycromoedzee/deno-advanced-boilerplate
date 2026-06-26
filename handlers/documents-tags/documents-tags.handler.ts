/**
 * @file handlers/documents-tags/documents-tags.handler.ts
 * @description CRUD handlers for document tags
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentTagService } from "@services/documents-tags/index.ts";
import { createTagRoute, deleteTagRoute, getTagRoute, listTagsRoute, updateTagRoute } from "@routes/documents-tags/documents-tags.route.ts";
import { SchemaDocumentTagResponse, SchemaTagListResponse } from "@models/documents/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { ICreateTagInput, ITagListQuery, IUpdateTagInput } from "@models/documents/tag.model.ts";

/**
 * Create tag handler
 */
export const createTagHandler = defineHandler(
  {
    route: createTagRoute,
    operationName: "tag_create",
    entityType: "tag",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentTagResponse,
  },
  async (context) => {
    const service = getDocumentTagService();
    const tag = await service.createTag(context.body as ICreateTagInput, context.userId);
    return {
      data: SchemaDocumentTagResponse.parse(tag),
      status: 201,
    };
  },
);

/**
 * Get tag handler (supports ID or name)
 */
export const getTagHandler = defineHandler<typeof getTagRoute>(
  {
    operationName: "tag_get",
    entityType: "tag",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentTagResponse,
  },
  async (context) => {
    const { idOrName } = context.params;
    const service = getDocumentTagService();
    const tag = await service.findTagByIdOrName(idOrName, context.userId);
    if (!tag) {
      throwHttpError("COMMON.NOT_FOUND");
    }
    return {
      data: SchemaDocumentTagResponse.parse(tag),
      status: 200,
    };
  },
);

/**
 * Update tag handler (supports ID or name)
 */
export const updateTagHandler = defineHandler<typeof updateTagRoute>(
  {
    operationName: "tag_update",
    entityType: "tag",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentTagResponse,
  },
  async (context) => {
    const { idOrName } = context.params;
    const service = getDocumentTagService();

    // First find the tag by ID or name
    const existing = await service.findTagByIdOrName(idOrName, context.userId);
    if (!existing) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    // Update using the tag ID
    const tag = await service.updateTag(existing.id, context.body as IUpdateTagInput, context.userId);
    return {
      data: SchemaDocumentTagResponse.parse(tag),
      status: 200,
    };
  },
);

/**
 * Delete tag handler (supports ID or name)
 */
export const deleteTagHandler = defineHandler<typeof deleteTagRoute>(
  {
    operationName: "tag_delete",
    entityType: "tag",
    loggerSection: loggerAppSections.DOCUMENTS,
  },
  async (context) => {
    const { idOrName } = context.params;
    const service = getDocumentTagService();

    // First find the tag by ID or name
    const existing = await service.findTagByIdOrName(idOrName, context.userId);
    if (!existing) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    // Delete using the tag ID
    await service.deleteTag(existing.id, context.userId);
    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * List tags handler
 */
export const listTagsHandler = defineHandler(
  {
    route: listTagsRoute,
    operationName: "tag_list",
    entityType: "tag",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaTagListResponse,
  },
  async (context) => {
    const query = context.query as ITagListQuery;
    const service = getDocumentTagService();

    // Extract filters from query including pagination
    const filters = {
      search: query.search,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
      page: query.page,
      limit: query.limit,
    };

    const result = await service.listTags(context.userId, filters);

    return {
      data: {
        items: result.items.map((tag) => SchemaDocumentTagResponse.parse(tag)),
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
          hasNext: result.page < result.totalPages,
          hasPrev: result.page > 1,
        },
      },
      status: 200,
    };
  },
);
