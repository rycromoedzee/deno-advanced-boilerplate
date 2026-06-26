/**
 * @file routes/document-folders-sharing/index.ts
 * @description Barrel/Hono app wiring for document folders sharing routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  createPublicShareHandler,
  disablePublicShareHandler,
  getFolderAccessLogsHandler,
  listFolderPermissionsHandler,
  revokeUserAccessHandler,
  shareFolderHandler,
  updateUserPermissionHandler,
} from "@handlers/document-folders-sharing/index.ts";
import {
  createPublicShareRoute,
  disablePublicShareRoute,
  getFolderAccessLogsRoute,
  listFolderPermissionsRoute,
  revokeUserAccessRoute,
  shareFolderRoute,
  updateUserPermissionRoute,
} from "./document-folders-sharing.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(shareFolderRoute, shareFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listFolderPermissionsRoute, listFolderPermissionsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(revokeUserAccessRoute, revokeUserAccessHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(updateUserPermissionRoute, updateUserPermissionHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(createPublicShareRoute, createPublicShareHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(disablePublicShareRoute, disablePublicShareHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getFolderAccessLogsRoute, getFolderAccessLogsHandler, STANDARD_RATE_LIMIT);

export default app;
