/**
 * @file routes/documents-activity-logs/index.ts
 * @description Barrel/Hono app wiring for documents activity logs routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { getActivityLogsHandler, getActivityLogsStreamHandler } from "@handlers/documents-activity-logs/index.ts";
import { getActivityLogsRoute } from "./activity-logs.route.ts";
import { getActivityLogsStreamRoute } from "./activity-logs-stream.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(getActivityLogsRoute, getActivityLogsHandler, STANDARD_RATE_LIMIT);

// SSE stream uses concurrency-based limiting in the handler (not request-count rate limiting).
// This prevents penalizing users for disconnects (refresh, HMR, tab close) since
// the connection count is decremented immediately when connections close.
// See activity-logs-stream.handler.ts for the MAX_SSE_CONNECTIONS_PER_USER check.
app.openapi(getActivityLogsStreamRoute, getActivityLogsStreamHandler);

export default app;
