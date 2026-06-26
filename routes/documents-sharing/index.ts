/**
 * @file routes/documents-sharing/index.ts
 * @description Barrel/Hono app wiring for documents sharing routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  createPublicDocumentShareHandler,
  disablePublicDocumentShareHandler,
  getDocumentAccessLogsHandler,
  listDocumentPermissionsHandler,
  revokeDocumentAccessHandler,
  shareDocumentHandler,
  updateDocumentPermissionHandler,
} from "@handlers/documents-sharing/index.ts";
import {
  createPublicDocumentShareRoute,
  disablePublicDocumentShareRoute,
  getDocumentAccessLogsRoute,
  listDocumentPermissionsRoute,
  revokeDocumentAccessRoute,
  shareDocumentRoute,
  updateDocumentPermissionRoute,
} from "./documents-sharing.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(shareDocumentRoute, shareDocumentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listDocumentPermissionsRoute, listDocumentPermissionsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(revokeDocumentAccessRoute, revokeDocumentAccessHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(updateDocumentPermissionRoute, updateDocumentPermissionHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(createPublicDocumentShareRoute, createPublicDocumentShareHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(disablePublicDocumentShareRoute, disablePublicDocumentShareHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getDocumentAccessLogsRoute, getDocumentAccessLogsHandler, STANDARD_RATE_LIMIT);

export default app;
