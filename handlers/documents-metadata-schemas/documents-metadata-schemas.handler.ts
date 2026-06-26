/**
 * @file handlers/documents-metadata-schemas/documents-metadata-schemas.handler.ts
 * @description CRUD handlers for document metadata schemas
 */

import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentMetadataSchemaService } from "@services/documents-metadata-schemas/index.ts";
import {
  createMetadataSchemaRoute,
  deleteMetadataSchemaRoute,
  getMetadataSchemaRoute,
  listMetadataSchemasRoute,
  updateMetadataSchemaRoute,
} from "@routes/documents-metadata-schemas/documents-metadata-schemas.route.ts";
import { SchemaDocumentMetadataSchemaResponse } from "@models/documents/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type {
  ICreateMetadataSchemaInput,
  IMetadataSchemaListQuery,
  IUpdateMetadataSchemaInput,
} from "@models/documents/metadata-schema.model.ts";

/**
 * Create metadata schema handler
 */
export const createMetadataSchemaHandler = defineHandler(
  {
    route: createMetadataSchemaRoute,
    operationName: "metadata_schema_create",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentMetadataSchemaResponse,
  },
  async (context) => {
    const service = getDocumentMetadataSchemaService();
    const schema = await service.createSchema(context.body as ICreateMetadataSchemaInput, context.userId);
    return {
      data: SchemaDocumentMetadataSchemaResponse.parse(schema),
      status: 201,
    };
  },
);

/**
 * Get metadata schema handler (supports ID or key)
 */
export const getMetadataSchemaHandler = defineHandler<typeof getMetadataSchemaRoute>(
  {
    operationName: "metadata_schema_get",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentMetadataSchemaResponse,
  },
  async (context) => {
    const { idOrKey } = context.params;
    const service = getDocumentMetadataSchemaService();
    const schema = await service.findSchemaByIdOrKey(idOrKey, context.userId);
    if (!schema) {
      throwHttpError("COMMON.NOT_FOUND");
    }
    return {
      data: SchemaDocumentMetadataSchemaResponse.parse(schema),
      status: 200,
    };
  },
);

/**
 * Update metadata schema handler (supports ID or key)
 */
export const updateMetadataSchemaHandler = defineHandler<typeof updateMetadataSchemaRoute>(
  {
    operationName: "metadata_schema_update",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentMetadataSchemaResponse,
  },
  async (context) => {
    const { idOrKey } = context.params;
    const service = getDocumentMetadataSchemaService();

    // First find the schema by ID or key
    const existing = await service.findSchemaByIdOrKey(idOrKey, context.userId);
    if (!existing) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    // Update using the pre-fetched schema object to avoid redundant lookup
    const schema = await service.updateSchema(existing, context.body as IUpdateMetadataSchemaInput, context.userId);
    return {
      data: SchemaDocumentMetadataSchemaResponse.parse(schema),
      status: 200,
    };
  },
);

/**
 * Delete metadata schema handler (supports ID or key)
 */
export const deleteMetadataSchemaHandler = defineHandler<typeof deleteMetadataSchemaRoute>(
  {
    operationName: "metadata_schema_delete",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
  },
  async (context) => {
    const { idOrKey } = context.params;
    const service = getDocumentMetadataSchemaService();

    // First find the schema by ID or key
    const existing = await service.findSchemaByIdOrKey(idOrKey, context.userId);
    if (!existing) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    // Delete using the pre-fetched schema object to avoid redundant lookup
    await service.deleteSchema(existing, context.userId);
    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * List metadata schemas handler
 */
export const listMetadataSchemasHandler = defineHandler<typeof listMetadataSchemasRoute>(
  {
    operationName: "metadata_schema_list",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
  },
  async (context) => {
    const query = context.query as IMetadataSchemaListQuery;
    const service = getDocumentMetadataSchemaService();

    // Extract filters from query
    const filters = {
      search: query.search,
      type: query.type,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder,
    };

    const schemas = await service.listSchemas(context.userId, filters);

    return {
      data: schemas.map((schema) => SchemaDocumentMetadataSchemaResponse.parse(schema)),
      status: 200,
    };
  },
);
