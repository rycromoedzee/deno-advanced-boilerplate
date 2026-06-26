/**
 * @file models/notes/note-attachment.model.ts
 * @description Note Attachment model/types
 */
import { z } from "@deps";

export const SCHEMA_NOTE_ATTACHMENT_ID = z.string().min(1).openapi({
  description: "Note attachment id",
  example: "clx4k2j3a0000pq3x7b9v4r2a",
});

export const SchemaNoteAttachmentUploadRequest = z.object({
  noteId: z.string().min(1).openapi({ description: "Note to attach to", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  mimeType: z.string().min(1).openapi({ description: "MIME type of the ciphertext payload", example: "image/png" }),
  originalName: z.string().min(1).max(512).openapi({ description: "Original filename", example: "screenshot.png" }),
  bytesBase64: z.string().min(1).openapi({ description: "Base64-encoded attachment bytes", example: "iVBORw0KGgoAAAANSUhEUg==" }),
}).openapi("NoteAttachmentUploadRequest");

export const SchemaNoteAttachmentApiResponse = z.object({
  id: z.string().openapi({ description: "Attachment ID (CUID2)", example: "clx4k2j3a0000pq3x7b9v4r2a" }),
  noteId: z.string().openapi({ description: "Owning note ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  ownerId: z.string().openapi({ description: "Owner user ID", example: "clx4k2j3o0000pq3x7b9v4r2o" }),
  mimeType: z.string().openapi({ description: "Stored MIME type", example: "image/png" }),
  originalName: z.string().openapi({ description: "Original filename", example: "screenshot.png" }),
  sizeBytes: z.number().openapi({ description: "Decoded byte size", example: 2048576 }),
  storageKey: z.string().openapi({ description: "Encrypted object storage key", example: "notes/att/clx4k2j3a…enc" }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716336000000 }),
}).openapi("NoteAttachment");

export const SchemaNoteAttachmentListResponse = z.object({
  items: z.array(SchemaNoteAttachmentApiResponse).openapi({ description: "Attachment records" }),
}).openapi("NoteAttachmentListResponse");

export const SchemaNoteAttachmentStatsBucket = z.object({
  count: z.number().int().nonnegative().openapi({
    description: "Number of attachments",
    example: 12,
  }),
  totalBytes: z.number().int().nonnegative().openapi({
    description: "Total size in bytes",
    example: 5242880,
  }),
});

export const SchemaNoteAttachmentStatsResponse = z.object({
  active: SchemaNoteAttachmentStatsBucket.openapi({
    description: "Attachments on non-archived notes",
  }),
  archived: SchemaNoteAttachmentStatsBucket.openapi({
    description: "Attachments on archived notes",
  }),
  total: SchemaNoteAttachmentStatsBucket.openapi({
    description: "All attachments (active + archived)",
  }),
}).openapi("NoteAttachmentStats");

export type INoteAttachmentStatsResponse = z.infer<typeof SchemaNoteAttachmentStatsResponse>;
