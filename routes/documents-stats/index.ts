/**
 * @file routes/documents-stats/index.ts
 * @description Barrel/Hono app wiring for documents stats routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { getDocumentStatsHandler } from "@handlers/documents-stats/index.ts";
import { getDocumentStatsRoute } from "./documents-stats.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(getDocumentStatsRoute, getDocumentStatsHandler, STANDARD_RATE_LIMIT);

export default app;
