/**
 * @file models/notes/note-tag.model.ts
 * @description Note Tag model/types
 */
import { z } from "@deps";

export const SCHEMA_NOTE_TAG_ID = z.string().min(1).openapi({
  description: "Note tag id",
  example: "0123456789abcdef01234",
});

export const SchemaNoteTagCreateRequest = z.object({
  name: z.string().min(1).max(64).openapi({ description: "Tag name", example: "urgent" }),
  color: z.string().min(1).max(16).optional().openapi({ description: "Optional color hex", example: "#ef4444" }),
}).openapi("NoteTagCreateRequest");

export const SchemaNoteTagUpdateRequest = z.object({
  name: z.string().min(1).max(64).optional().openapi({ description: "New name", example: "high-priority" }),
  color: z.string().min(1).max(16).nullable().optional().openapi({ description: "New color hex, or null to clear", example: "#f97316" }),
}).openapi("NoteTagUpdateRequest");

export const SchemaNoteTagApiResponse = z.object({
  id: z.string().openapi({ description: "Tag ID (CUID2)", example: "clx4k2j3t0000pq3x7b9v4r2t" }),
  ownerId: z.string().openapi({ description: "Owner user ID", example: "clx4k2j3o0000pq3x7b9v4r2o" }),
  name: z.string().openapi({ description: "Tag name", example: "urgent" }),
  color: z.string().nullable().openapi({ description: "Color hex, or null", example: "#ef4444" }),
  usageCount: z.number().openapi({ description: "Number of notes using this tag", example: 7 }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716336000000 }),
  updatedAt: z.number().openapi({ description: "Unix-ms last-update timestamp", example: 1716422400000 }),
}).openapi("NoteTag");

export const SchemaNoteTagListResponse = z.object({
  items: z.array(SchemaNoteTagApiResponse),
  pagination: z.object({
    page: z.number().openapi({ description: "Current page", example: 1 }),
    limit: z.number().openapi({ description: "Page size used", example: 50 }),
    total: z.number().openapi({ description: "Total matching tags", example: 23 }),
    totalPages: z.number().openapi({ description: "Total pages", example: 1 }),
    hasNext: z.boolean().openapi({ description: "A next page exists", example: false }),
    hasPrev: z.boolean().openapi({ description: "A previous page exists", example: false }),
  }),
}).openapi("NoteTagListResponse");

export const SchemaNoteTagsForNoteResponse = z.object({
  items: z.array(SchemaNoteTagApiResponse).openapi({ description: "Tags attached to the note" }),
}).openapi("NoteTagsForNoteResponse");

export const SchemaNoteTagListQuery = z.object({
  q: z.string().optional().openapi({ description: "Name search substring", example: "urg" }),
  page: z.coerce.number().int().min(1).default(1).openapi({ description: "1-based page number", example: 1 }),
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ description: "Items per page (max 200)", example: 50 }),
  sortBy: z.enum(["name", "usageCount", "createdAt"]).optional().openapi({ description: "Sort field", example: "usageCount" }),
  sortOrder: z.enum(["asc", "desc"]).optional().openapi({ description: "Sort direction", example: "desc" }),
}).openapi("NoteTagListQuery");

export type INoteTagCreateRequest = z.infer<typeof SchemaNoteTagCreateRequest>;
export type INoteTagUpdateRequest = z.infer<typeof SchemaNoteTagUpdateRequest>;
export type INoteTagListResponse = z.infer<typeof SchemaNoteTagListResponse>;
