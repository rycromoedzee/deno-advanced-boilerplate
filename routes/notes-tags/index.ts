/**
 * @file routes/notes-tags/index.ts
 * @description Barrel/Hono app wiring for notes tags routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  createNoteTagHandler,
  deleteNoteTagHandler,
  getNoteTagHandler,
  listNoteTagsHandler,
  updateNoteTagHandler,
} from "@handlers/notes-tags/index.ts";
import { createNoteTagRoute, deleteNoteTagRoute, getNoteTagRoute, listNoteTagsRoute, updateNoteTagRoute } from "./notes-tags.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const noteTagsApp = createRateLimitedApp();

noteTagsApp.openapiWithRateLimit(listNoteTagsRoute, listNoteTagsHandler, STANDARD_RATE_LIMIT);
noteTagsApp.openapiWithRateLimit(createNoteTagRoute, createNoteTagHandler, STANDARD_RATE_LIMIT);
noteTagsApp.openapiWithRateLimit(getNoteTagRoute, getNoteTagHandler, STANDARD_RATE_LIMIT);
noteTagsApp.openapiWithRateLimit(updateNoteTagRoute, updateNoteTagHandler, STANDARD_RATE_LIMIT);
noteTagsApp.openapiWithRateLimit(deleteNoteTagRoute, deleteNoteTagHandler, STANDARD_RATE_LIMIT);

export default noteTagsApp;
