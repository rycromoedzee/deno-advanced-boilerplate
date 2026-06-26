/**
 * @file routes/documents-tags/index.ts
 * @description Barrel/Hono app wiring for documents tags routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { createTagHandler, deleteTagHandler, getTagHandler, listTagsHandler, updateTagHandler } from "@handlers/documents-tags/index.ts";
import { createTagRoute, deleteTagRoute, getTagRoute, listTagsRoute, updateTagRoute } from "./documents-tags.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(createTagRoute, createTagHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listTagsRoute, listTagsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getTagRoute, getTagHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(updateTagRoute, updateTagHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(deleteTagRoute, deleteTagHandler, STANDARD_RATE_LIMIT);

export default app;
