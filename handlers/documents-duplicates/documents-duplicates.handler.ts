/**
 * @file handlers/documents-duplicates/documents-duplicates.handler.ts
 * @description Handlers for document duplicate management settings
 */

import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getDocumentDeduplicationService } from "@services/documents-deduplication/index.ts";
import {
  findDuplicatesRoute,
  keepDuplicatesRoute,
  unkeepDuplicatesRoute,
} from "@routes/documents-duplicates/documents-duplicates.route.ts";
import { SchemaFindDuplicatesResponse, SchemaKeepDuplicateResponse } from "@models/documents/deduplication.model.ts";
import { defineHandler } from "@handlers/shared/index.ts";

/**
 * Find duplicates handler
 * Returns all duplicate groups for the authenticated user
 */
export const findDuplicatesHandler = defineHandler(
  {
    route: findDuplicatesRoute,
    operationName: "document_find_duplicates",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaFindDuplicatesResponse,
    errorKey: "DOCUMENT.LIST_FAILED",
  },
  async (context) => {
    const query = context.query;

    const service = getDocumentDeduplicationService();
    const result = await service.findDuplicates(
      context.userId,
      context.environmentId,
      {
        includeArchived: query.includeArchived,
        excludeAllowed: query.excludeAllowed,
      },
    );

    return {
      data: result,
      status: 200,
    };
  },
);

/**
 * Keep duplicates handler
 * Marks documents as intentionally kept duplicates
 */
export const keepDuplicatesHandler = defineHandler(
  {
    route: keepDuplicatesRoute,
    operationName: "document_keep_duplicates",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaKeepDuplicateResponse,
    errorKey: "DOCUMENT.UPDATE_FAILED",
  },
  async (context) => {
    const body = context.body;

    if (!body || !body.documentIds || body.documentIds.length === 0) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentDeduplicationService();
    const result = await service.bulkKeepDuplicates(
      body.documentIds,
      context.userId,
      context.environmentId,
    );

    return {
      data: result,
      status: 200,
    };
  },
);

/**
 * Unkeep duplicates handler
 * Removes the "allowed" flag from documents
 */
export const unkeepDuplicatesHandler = defineHandler(
  {
    route: unkeepDuplicatesRoute,
    operationName: "document_unkeep_duplicates",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaKeepDuplicateResponse,
    errorKey: "DOCUMENT.UPDATE_FAILED",
  },
  async (context) => {
    const body = context.body;

    if (!body || !body.documentIds || body.documentIds.length === 0) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    const service = getDocumentDeduplicationService();

    let success = 0;
    let failed = 0;

    for (const documentId of body.documentIds) {
      const result = await service.unkeepDuplicate(
        documentId,
        context.userId,
        context.environmentId,
      );
      if (result) {
        success++;
      } else {
        failed++;
      }
    }

    return {
      data: { success, failed },
      status: 200,
    };
  },
);
