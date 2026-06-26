/**
 * @file routes/documents-operations/index.ts
 * @description Barrel/Hono app wiring for documents operations routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  cancelMoveOperationHandler,
  getMoveOperationDetailsHandler,
  getMoveOperationStatusHandler,
  streamMoveOperationHandler,
} from "@handlers/documents-operations/index.ts";
import {
  cancelMoveOperationRoute,
  getMoveOperationDetailsRoute,
  getMoveOperationStatusRoute,
  streamMoveOperationRoute,
} from "./documents-operations.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(getMoveOperationStatusRoute, getMoveOperationStatusHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(streamMoveOperationRoute, streamMoveOperationHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(cancelMoveOperationRoute, cancelMoveOperationHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getMoveOperationDetailsRoute, getMoveOperationDetailsHandler, STANDARD_RATE_LIMIT);

export default app;
