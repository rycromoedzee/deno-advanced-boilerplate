/**
 * @file routes/notes-collections/index.ts
 * @description Barrel/Hono app wiring for notes collections routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  archiveCollectionHandler,
  createCollectionHandler,
  deleteCollectionHandler,
  getCollectionHandler,
  listCollectionsHandler,
  restoreCollectionHandler,
  updateCollectionHandler,
} from "@handlers/notes-collections/index.ts";
import {
  archiveCollectionRoute,
  createCollectionRoute,
  deleteCollectionRoute,
  getCollectionRoute,
  listCollectionsRoute,
  restoreCollectionRoute,
  updateCollectionRoute,
} from "./notes-collections.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const notesCollectionsApp = createRateLimitedApp();

notesCollectionsApp.openapiWithRateLimit(listCollectionsRoute, listCollectionsHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(createCollectionRoute, createCollectionHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(archiveCollectionRoute, archiveCollectionHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(restoreCollectionRoute, restoreCollectionHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(getCollectionRoute, getCollectionHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(updateCollectionRoute, updateCollectionHandler, STANDARD_RATE_LIMIT);
notesCollectionsApp.openapiWithRateLimit(deleteCollectionRoute, deleteCollectionHandler, STANDARD_RATE_LIMIT);

export default notesCollectionsApp;
