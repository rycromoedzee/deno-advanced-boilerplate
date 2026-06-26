/**
 * @file routes/document-folders/index.ts
 * @description Barrel/Hono app wiring for document folders routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  archiveFolderHandler,
  bulkArchiveFoldersHandler,
  bulkDeleteFoldersHandler,
  bulkMoveFoldersHandler,
  createFolderHandler,
  deleteFolderHandler,
  duplicateFolderHandler,
  getFolderHandler,
  getFolderSettingsHandler,
  listFoldersHandler,
  listSharedFoldersHandler,
  moveFolderHandler,
  restoreFolderHandler,
  updateFolderHandler,
} from "@handlers/document-folders/index.ts";
import {
  archiveFolderRoute,
  createFolderRoute,
  deleteFolderRoute,
  duplicateFolderRoute,
  getFolderRoute,
  listFoldersRoute,
  listSharedFoldersRoute,
  moveFolderRoute,
  restoreFolderRoute,
  updateFolderRoute,
} from "./folders.route.ts";
import { getFolderSettingsRoute } from "./folder-settings.route.ts";
import { bulkArchiveFoldersRoute, bulkDeleteFoldersRoute, bulkMoveFoldersRoute } from "./folders-bulk.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const BULK_RATE_LIMIT = {
  max: 10,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
};

const app = createRateLimitedApp();

// CRUD operations
app.openapiWithRateLimit(createFolderRoute, createFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listFoldersRoute, listFoldersHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(listSharedFoldersRoute, listSharedFoldersHandler, STANDARD_RATE_LIMIT);

// Settings operations (must be before /{id} routes to avoid conflict)
app.openapiWithRateLimit(getFolderSettingsRoute, getFolderSettingsHandler, STANDARD_RATE_LIMIT);

app.openapiWithRateLimit(getFolderRoute, getFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(updateFolderRoute, updateFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(deleteFolderRoute, deleteFolderHandler, STANDARD_RATE_LIMIT);

// Lifecycle operations
app.openapiWithRateLimit(archiveFolderRoute, archiveFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(duplicateFolderRoute, duplicateFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(moveFolderRoute, moveFolderHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(restoreFolderRoute, restoreFolderHandler, STANDARD_RATE_LIMIT);

// Bulk folder operations (strictest limits)
app.openapiWithRateLimit(bulkDeleteFoldersRoute, bulkDeleteFoldersHandler, BULK_RATE_LIMIT);
app.openapiWithRateLimit(bulkArchiveFoldersRoute, bulkArchiveFoldersHandler, BULK_RATE_LIMIT);
app.openapiWithRateLimit(bulkMoveFoldersRoute, bulkMoveFoldersHandler, BULK_RATE_LIMIT);

export default app;
