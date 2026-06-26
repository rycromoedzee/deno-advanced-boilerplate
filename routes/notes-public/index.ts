/**
 * @file routes/notes-public/index.ts
 * @description Barrel/Hono app wiring for notes public routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import { accessPublicNoteHandler } from "@handlers/notes-public/index.ts";
import { accessPublicNoteRoute } from "./notes-public.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const publicNotesApp = createRateLimitedApp();

publicNotesApp.openapiWithRateLimit(accessPublicNoteRoute, accessPublicNoteHandler, STANDARD_RATE_LIMIT);

export default publicNotesApp;
