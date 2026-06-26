/**
 * @file routes/documents-duplicates/index.ts
 * @description Barrel/Hono app wiring for documents duplicates routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { findDuplicatesHandler, keepDuplicatesHandler, unkeepDuplicatesHandler } from "@handlers/documents-duplicates/index.ts";
import { findDuplicatesRoute, keepDuplicatesRoute, unkeepDuplicatesRoute } from "./documents-duplicates.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(findDuplicatesRoute, findDuplicatesHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(keepDuplicatesRoute, keepDuplicatesHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(unkeepDuplicatesRoute, unkeepDuplicatesHandler, STANDARD_RATE_LIMIT);

export default app;
