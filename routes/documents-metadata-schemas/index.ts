/**
 * @file routes/documents-metadata-schemas/index.ts
 * @description Barrel/Hono app wiring for documents metadata schemas routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  createMetadataSchemaHandler,
  deleteMetadataSchemaHandler,
  getMetadataSchemaHandler,
  listMetadataSchemasHandler,
  updateMetadataSchemaHandler,
} from "@handlers/documents-metadata-schemas/index.ts";
import {
  createMetadataSchemaRoute,
  deleteMetadataSchemaRoute,
  getMetadataSchemaRoute,
  listMetadataSchemasRoute,
  updateMetadataSchemaRoute,
} from "./documents-metadata-schemas.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(createMetadataSchemaRoute, createMetadataSchemaHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listMetadataSchemasRoute, listMetadataSchemasHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getMetadataSchemaRoute, getMetadataSchemaHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(updateMetadataSchemaRoute, updateMetadataSchemaHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(deleteMetadataSchemaRoute, deleteMetadataSchemaHandler, STANDARD_RATE_LIMIT);

export default app;
