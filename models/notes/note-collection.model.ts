/**
 * @file models/notes/note-collection.model.ts
 * @description Note Collection model/types
 */
import { z } from "@deps";

export const SCHEMA_COLLECTION_ID = z.string().min(1).openapi({
  description: "Note collection ID",
  example: "abcDEF123_xyz45678901",
});

export const SchemaNoteCollectionApiResponse = z.object({
  id: z.string().openapi({ description: "Collection ID (CUID2)", example: "clx4k2j3c0000pq3x7b9v4r2c" }),
  ownerId: z.string().openapi({ description: "Owner user ID", example: "clx4k2j3o0000pq3x7b9v4r2o" }),
  name: z.string().openapi({ description: "Collection name", example: "Marketing" }),
  description: z.string().nullable().openapi({ description: "Optional description", example: "Outbound campaigns" }),
  icon: z.string().nullable().openapi({ description: "Icon identifier", example: "megaphone" }),
  color: z.string().nullable().openapi({ description: "Color hex", example: "#6366f1" }),
  isArchived: z.boolean().openapi({ description: "Whether the collection is archived", example: false }),
  archivedAt: z.number().nullable().openapi({ description: "Unix-ms archive time, null while active", example: null }),
  metadata: z.unknown().nullable().openapi({ description: "Free-form client metadata", example: { order: 2 } }),
  autoShareNewContent: z.boolean().optional().openapi({ description: "Auto-share new content added to the collection", example: false }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716336000000 }),
  updatedAt: z.number().openapi({ description: "Unix-ms last-update timestamp", example: 1716422400000 }),
}).openapi("NoteCollection");

export const SchemaNoteCollectionCreateRequest = z.object({
  name: z.string().min(1).max(200).openapi({ description: "Collection name", example: "Marketing" }),
  description: z.string().max(2000).optional().openapi({ description: "Optional description", example: "Outbound campaigns" }),
  icon: z.string().max(200).optional().openapi({ description: "Icon identifier", example: "megaphone" }),
  color: z.string().max(50).optional().openapi({ description: "Color hex", example: "#6366f1" }),
  metadata: z.record(z.string(), z.unknown()).optional().openapi({ description: "Optional client metadata", example: { order: 2 } }),
  autoShareNewContent: z.boolean().optional().openapi({ description: "Auto-share new content added to the collection", example: false }),
}).openapi("NoteCollectionCreateRequest");

export const SchemaNoteCollectionUpdateRequest = z.object({
  name: z.string().min(1).max(200).optional().openapi({ description: "New name", example: "Marketing 2026" }),
  description: z.string().max(2000).nullable().optional().openapi({
    description: "New description, or null to clear",
    example: "Outbound campaigns",
  }),
  icon: z.string().max(200).nullable().optional().openapi({ description: "Icon identifier, or null to clear", example: "megaphone" }),
  color: z.string().max(50).nullable().optional().openapi({ description: "Color hex, or null to clear", example: "#8b5cf6" }),
  metadata: z.record(z.string(), z.unknown()).nullable().optional().openapi({
    description: "Replace metadata, or null to clear",
    example: { order: 3 },
  }),
}).openapi("NoteCollectionUpdateRequest");

export const SchemaNoteCollectionListQuery = z.object({
  archived: z.enum(["true", "false", "all"]).default("false")
    .openapi({ description: "Archive filter", example: "false" }),
}).openapi("NoteCollectionListQuery");

export const SchemaNoteCollectionListResponse = z.array(SchemaNoteCollectionApiResponse);

export type INoteCollectionResponse = z.infer<typeof SchemaNoteCollectionApiResponse>;
export type INoteCollectionCreateRequest = z.infer<typeof SchemaNoteCollectionCreateRequest>;
export type INoteCollectionUpdateRequest = z.infer<typeof SchemaNoteCollectionUpdateRequest>;
