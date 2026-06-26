/**
 * @file handlers/documents-operations/index.ts
 * @description Barrel for document move-operation handlers.
 *
 * Divergence note (rule 7): routes/documents-operations/ has a single
 * documents-operations.route.ts, but the handlers are split into finer-grained
 * aspect files (status / stream / cancel / details) because each is a
 * distinct operation on a long-running move. Kept grouped rather than
 * collapsed into one file.
 */

export { cancelMoveOperationHandler } from "./cancel.handler.ts";
export { getMoveOperationDetailsHandler } from "./details.handler.ts";
export { getMoveOperationStatusHandler } from "./status.handler.ts";
export { streamMoveOperationHandler } from "./stream.handler.ts";
