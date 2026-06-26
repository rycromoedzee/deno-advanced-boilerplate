/**
 * @file handlers/shared/bulk-handler.factory.ts
 * @description Bulk operation handler factory
 *
 * Generates handlers for bulk operations (delete, archive, move, assign-tags, etc.)
 * Reduces code from ~70 lines per handler to ~8 lines per config (88% reduction)
 */

import type { RouteConfig, RouteHandler } from "@deps";
import type { loggerAppSections } from "@logger/types.ts";
import { defineHandler } from "./handler.factory.ts";
import type { EntityType, HandlerContext } from "./types.ts";

/**
 * Bulk operation result interface
 */
export interface BulkOperationResult {
  success: boolean;
  failedCount: number;
  errors: Array<{
    documentId?: string;
    folderId?: string;
    error: string;
  }>;
}

/**
 * Bulk operation configuration
 */
export interface BulkOperationConfig<TRoute extends RouteConfig> {
  /** Route configuration for type inference */
  route?: TRoute;

  /** Operation name for logging and tracing */
  operationName: string;

  /** Entity type for logging section determination */
  entityType: EntityType;

  /** Logger section for this handler */
  loggerSection: loggerAppSections;

  /** Service getter function - returns service with bulk operation methods */
  serviceGetter: () => unknown;

  /** Service method name to call (required if customHandler is not provided) */
  serviceMethod?: string;

  /** Success message template (receives count) */
  successMessage: (count: number) => string;

  /** Error key for error handling */
  errorKey: string;

  /** Optional: Extract additional parameters from body */
  extractParams?: (body: unknown) => Record<string, unknown>;

  /** Optional: Custom handler for special cases (if provided, serviceMethod is not needed) */
  customHandler?: (context: HandlerContext<TRoute>) => Promise<BulkOperationResult>;
}

/**
 * Create a bulk operation handler
 *
 * @example
 * ```typescript
 * export const bulkDeleteHandler = createBulkHandler({
 *   operationName: 'bulk_delete',
 *   entityType: 'document',
 *   serviceGetter: getDocumentDeleteService,
 *   serviceMethod: 'bulkHardDelete',
 *   successMessage: (count) => `Deleted ${count} documents`,
 *   errorKey: 'DOCUMENT.BULK_DELETE_FAILED',
 * });
 * ```
 */
export function createBulkHandler<TRoute extends RouteConfig>(
  config: BulkOperationConfig<TRoute>,
): RouteHandler<TRoute> {
  const {
    route,
    operationName,
    entityType,
    loggerSection,
    serviceGetter,
    serviceMethod,
    errorKey,
    extractParams,
    customHandler,
  } = config;

  return defineHandler<TRoute>(
    {
      route,
      operationName,
      entityType,
      loggerSection,
      errorKey,
    },
    async (context) => {
      const service = serviceGetter();
      const body = context.body as Record<string, unknown>;
      const documentIds = ((body.documentIds || body.folderIds) as string[]) || [];

      // Add tracing breadcrumb with count
      context.traceService.addBreadcrumb("handler", `${operationName} started`, "info", {
        userId: context.userId,
        documentCount: documentIds.length,
      });

      let result: BulkOperationResult;

      if (customHandler) {
        result = await customHandler(context);
      } else {
        if (!serviceMethod) {
          throw new Error(`serviceMethod is required when customHandler is not provided for ${operationName}`);
        }

        // Extract additional parameters if needed
        const additionalParams = extractParams ? extractParams(body) : {};

        // Call service method
        // Most bulk methods take: (documentIds, userId, environmentId, ...additionalParams)
        const serviceRecord = service as Record<string, unknown>;
        const method = serviceRecord[serviceMethod] as (
          documentIds: string[],
          userId: string,
          environmentId: string,
          ...args: unknown[]
        ) => Promise<BulkOperationResult>;

        // DIAGNOSTIC LOG: Check if service and method exist
        console.log(`[DEBUG BULK HANDLER] Operation: ${operationName}`);
        console.log(`[DEBUG BULK HANDLER] Service type: ${typeof service}`);
        console.log(`[DEBUG BULK HANDLER] Service constructor: ${service?.constructor?.name}`);
        console.log(`[DEBUG BULK HANDLER] ServiceMethod name: ${serviceMethod}`);
        console.log(`[DEBUG BULK HANDLER] Method exists: ${serviceMethod in serviceRecord}`);
        console.log(`[DEBUG BULK HANDLER] Method type: ${typeof method}`);

        if (additionalParams && Object.keys(additionalParams).length > 0) {
          // For methods like bulkMove that need targetFolderId
          result = await method(
            documentIds,
            context.userId,
            context.environmentId,
            ...Object.values(additionalParams),
          );
        } else {
          // For methods like bulkDelete, bulkArchive
          result = await method(
            documentIds,
            context.userId,
            context.environmentId,
          );
        }
      }

      // Calculate failed count
      const failedCount = result.errors?.length || 0;

      return {
        data: {
          success: result.success,
          data: {
            failedCount,
            errors: result.errors || [],
          },
        },
        status: 200,
      };
    },
  );
}
