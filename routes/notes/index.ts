/**
 * @file routes/notes/index.ts
 * @description Barrel/Hono app wiring for notes routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  archiveNoteHandler,
  attachNoteTagHandler,
  createNoteHandler,
  createNotePublicShareHandler,
  deleteNoteHandler,
  detachNoteTagHandler,
  disableNotePublicShareHandler,
  getNoteEventsStreamHandler,
  getNoteHandler,
  getNoteVersionHandler,
  listNotePermissionsHandler,
  listNotesHandler,
  listNoteTagsForNoteHandler,
  listNoteVersionsHandler,
  listSharesHandler,
  putNoteBodyHandler,
  restoreNoteHandler,
  revokeNoteShareHandler,
  shareNoteHandler,
  updateNoteHandler,
} from "@handlers/notes/index.ts";
import {
  archiveNoteRoute,
  createNoteRoute,
  deleteNoteRoute,
  getNoteRoute,
  getNoteVersionRoute,
  listNotesRoute,
  listNoteVersionsRoute,
  putNoteBodyRoute,
  restoreNoteRoute,
  updateNoteRoute,
} from "./notes.route.ts";
import {
  createNotePublicShareRoute,
  disableNotePublicShareRoute,
  listNotePermissionsRoute,
  listSharesRoute,
  revokeNoteShareRoute,
  shareNoteRoute,
} from "./sharing.route.ts";
import { attachNoteTagRoute, detachNoteTagRoute, listNoteTagsForNoteRoute } from "./tags-attach.route.ts";
import { getNoteEventsStreamRoute } from "./events.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const notesApp = createRateLimitedApp();

// Most-specific routes first to avoid /{id} catching them.
// SSE stream — no rate-limit wrap (long-lived connection); mirrors documents activity-logs-stream.
notesApp.openapi(getNoteEventsStreamRoute, getNoteEventsStreamHandler);
notesApp.openapiWithRateLimit(listSharesRoute, listSharesHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(listNotesRoute, listNotesHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(createNoteRoute, createNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(archiveNoteRoute, archiveNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(restoreNoteRoute, restoreNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(putNoteBodyRoute, putNoteBodyHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(getNoteVersionRoute, getNoteVersionHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(listNoteVersionsRoute, listNoteVersionsHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(shareNoteRoute, shareNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(revokeNoteShareRoute, revokeNoteShareHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(listNotePermissionsRoute, listNotePermissionsHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(createNotePublicShareRoute, createNotePublicShareHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(disableNotePublicShareRoute, disableNotePublicShareHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(listNoteTagsForNoteRoute, listNoteTagsForNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(attachNoteTagRoute, attachNoteTagHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(detachNoteTagRoute, detachNoteTagHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(getNoteRoute, getNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(updateNoteRoute, updateNoteHandler, STANDARD_RATE_LIMIT);
notesApp.openapiWithRateLimit(deleteNoteRoute, deleteNoteHandler, STANDARD_RATE_LIMIT);

export default notesApp;
