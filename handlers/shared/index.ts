/**
 * @file handlers/shared/index.ts
 * @description Exports for shared handler utilities
 */

export { createSSEResponse } from "./create-sse-response.ts";
export { defineHandler } from "./handler.factory.ts";
export { type BulkOperationConfig, type BulkOperationResult, createBulkHandler } from "./bulk-handler.factory.ts";
export type { EntityType, HandlerConfig, HandlerContext, HandlerErrorHandler, HandlerResponse, HandlerStatus } from "./types.ts";
