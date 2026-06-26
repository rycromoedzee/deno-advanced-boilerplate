/**
 * @file routes/notes-attachments/index.ts
 * @description Barrel/Hono app wiring for notes attachments routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";
import {
  deleteNoteAttachmentHandler,
  getNoteAttachmentContentHandler,
  getNoteAttachmentStatsHandler,
  listAllNoteAttachmentsHandler,
  listNoteAttachmentsForNoteHandler,
  uploadNoteAttachmentHandler,
  uploadNoteAttachmentMultipartHandler,
} from "@handlers/notes-attachments/index.ts";
import {
  deleteNoteAttachmentRoute,
  getNoteAttachmentContentRoute,
  getNoteAttachmentStatsRoute,
  listAllNoteAttachmentsRoute,
  listNoteAttachmentsForNoteRoute,
  uploadNoteAttachmentMultipartRoute,
  uploadNoteAttachmentRoute,
} from "./notes-attachments.route.ts";

const STANDARD_RATE_LIMIT = {
  max: 50,
  window: 60 * 1000,
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const app = createRateLimitedApp();

app.openapiWithRateLimit(listAllNoteAttachmentsRoute, listAllNoteAttachmentsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(uploadNoteAttachmentRoute, uploadNoteAttachmentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(
  uploadNoteAttachmentMultipartRoute,
  uploadNoteAttachmentMultipartHandler,
  STANDARD_RATE_LIMIT,
);
app.openapiWithRateLimit(listNoteAttachmentsForNoteRoute, listNoteAttachmentsForNoteHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getNoteAttachmentStatsRoute, getNoteAttachmentStatsHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(getNoteAttachmentContentRoute, getNoteAttachmentContentHandler, STANDARD_RATE_LIMIT);
app.openapiWithRateLimit(deleteNoteAttachmentRoute, deleteNoteAttachmentHandler, STANDARD_RATE_LIMIT);

export default app;
