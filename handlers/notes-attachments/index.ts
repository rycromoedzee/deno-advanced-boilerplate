/**
 * @file handlers/notes-attachments/index.ts
 * @description Barrel for note-attachment handlers (mirrors routes/notes-attachments/).
 *
 * Route ↔ handler mirror:
 *   notes-attachments.handler.ts ↔ notes-attachments.route.ts (upload, list, stats, delete + content download stream)
 */

export {
  deleteNoteAttachmentHandler,
  getNoteAttachmentContentHandler,
  getNoteAttachmentStatsHandler,
  listAllNoteAttachmentsHandler,
  listNoteAttachmentsForNoteHandler,
  uploadNoteAttachmentHandler,
  uploadNoteAttachmentMultipartHandler,
} from "./notes-attachments.handler.ts";
