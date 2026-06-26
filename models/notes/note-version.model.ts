/**
 * @file models/notes/note-version.model.ts
 * @description Note Version model/types
 */
import { z } from "@deps";

const NOTE_BODY_MAX_LENGTH = 100_000;

export const SCHEMA_NOTE_VERSION_ID = z.string().min(1).openapi({
  description: "Note version ID",
  example: "clx4k2j3v0000pq3x7b9v4r2v",
});

export const SchemaNoteVersionApiResponse = z.object({
  id: z.string().openapi({ description: "Version ID (CUID2)", example: "clx4k2j3v0000pq3x7b9v4r2v" }),
  noteId: z.string().openapi({ description: "Owning note ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  authorId: z.string().openapi({ description: "Author user ID", example: "clx4k2j3a0000pq3x7b9v4r2a" }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716422400000 }),
}).openapi("NoteVersion");

export const SchemaNoteVersionDetailApiResponse = SchemaNoteVersionApiResponse.extend({
  body: z.string().openapi({ description: "Decrypted version body", example: "# Heading\nUpdated draft…" }),
}).openapi("NoteVersionDetail");

export const SchemaNoteVersionListResponse = z.array(SchemaNoteVersionApiResponse);

export const SchemaNotePutBodyRequest = z.object({
  body: z.string().trim().min(1).max(NOTE_BODY_MAX_LENGTH)
    .openapi({ description: "Encrypted/decrypted note body (1–100000 chars)", example: "# Heading\nNew body content" }),
}).openapi("NotePutBodyRequest");

export type INoteVersionResponse = z.infer<typeof SchemaNoteVersionApiResponse>;
export type INoteVersionDetail = z.infer<typeof SchemaNoteVersionDetailApiResponse>;
export type INotePutBodyRequest = z.infer<typeof SchemaNotePutBodyRequest>;
