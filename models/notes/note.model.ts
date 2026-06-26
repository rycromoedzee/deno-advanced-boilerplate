/**
 * @file models/notes/note.model.ts
 * @description Note model/types
 */
import { z } from "@deps";

export const SCHEMA_NOTE_ID = z.string().min(1).openapi({
  description: "Note ID",
  example: "abcDEF123_xyz45678901",
});

export const SchemaNoteApiResponse = z.object({
  id: z.string().openapi({ description: "Note ID (CUID2)", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  ownerId: z.string().openapi({ description: "CUID2 of the note owner", example: "clx4k2j3a0000pq3x7b9v4r2a" }),
  ownerName: z.string().nullable().optional()
    .openapi({ description: "Display name of the owner", example: "Ada Lovelace" }),
  collectionId: z.string().nullable()
    .openapi({ description: "ID of the collection this note belongs to, if any", example: "clx4k2j3c0000pq3x7b9v4r2c" }),
  title: z.string().openapi({ description: "Plain-text note title", example: "Q3 launch checklist" }),
  isArchived: z.boolean().openapi({ description: "Whether the note is soft-archived", example: false }),
  archivedAt: z.number().nullable()
    .openapi({ description: "Unix-ms timestamp when archived, null while active", example: null }),
  isPinned: z.boolean().openapi({ description: "Whether the note is pinned to the top", example: false }),
  lastVersionId: z.string().nullable()
    .openapi({ description: "ID of the most recent body version", example: "clx4k2j3v0000pq3x7b9v4r2v" }),
  metadata: z.unknown().nullable()
    .openapi({ description: "Free-form client metadata object", example: { color: "#f59e0b" } }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716336000000 }),
  updatedAt: z.number().openapi({ description: "Unix-ms last-update timestamp", example: 1716422400000 }),
}).openapi("Note");

export const SchemaNoteCreateRequest = z.object({
  title: z.string().min(1).max(500).openapi({ description: "Note title", example: "Q3 launch checklist" }),
  collectionId: z.string().nullable().optional()
    .openapi({ description: "Collection to place the note in, or null", example: "clx4k2j3c0000pq3x7b9v4r2c" }),
  metadata: z.record(z.string(), z.unknown()).optional()
    .openapi({ description: "Optional client metadata", example: { color: "#f59e0b" } }),
}).openapi("NoteCreateRequest");

export const SchemaNoteUpdateRequest = z.object({
  title: z.string().min(1).max(500).optional().openapi({ description: "New title", example: "Q3 launch checklist (final)" }),
  collectionId: z.string().nullable().optional()
    .openapi({ description: "Move the note to this collection, or null to unassign", example: null }),
  isPinned: z.boolean().optional().openapi({ description: "Pin/unpin the note", example: true }),
  metadata: z.record(z.string(), z.unknown()).nullable().optional()
    .openapi({ description: "Replace client metadata, or null to clear", example: { color: "#10b981" } }),
}).openapi("NoteUpdateRequest");

export const SchemaNoteListQuery = z.object({
  collectionId: z.string().optional().openapi({ description: "Restrict to a collection", example: "clx4k2j3c0000pq3x7b9v4r2c" }),
  archived: z.enum(["true", "false", "all"]).default("false")
    .openapi({ description: "Archive filter", example: "false" }),
  pinned: z.enum(["true", "false", "all"]).default("all")
    .openapi({ description: "Pinned filter", example: "all" }),
  q: z.string().optional().openapi({ description: "Title search substring", example: "launch" }),
  page: z.coerce.number().int().min(1).default(1).openapi({ description: "1-based page number", example: 1 }),
  limit: z.coerce.number().int().min(1).max(200).default(50).openapi({ description: "Items per page (max 200)", example: 50 }),
}).openapi("NoteListQuery");

export const SchemaNoteListTag = z.object({
  name: z.string().openapi({ description: "Tag name", example: "urgent" }),
  color: z.string().nullable().openapi({ description: "Tag color hex, if set", example: "#ef4444" }),
}).openapi("NoteListTag");

// List items carry extra denormalized fields (author name, collection name, tags)
// that the shared SchemaNoteApiResponse (used by create/update/archive/restore) does
// not, so they live on a dedicated list-item schema rather than the shared base.
export const SchemaNoteListItemApiResponse = SchemaNoteApiResponse.extend({
  ownerName: z.string().nullable()
    .openapi({ description: "Owner display name (denormalized for lists)", example: "Ada Lovelace" }),
  collectionName: z.string().nullable()
    .openapi({ description: "Collection name (denormalized for lists)", example: "Marketing" }),
  tags: z.array(SchemaNoteListTag).openapi({ description: "Tags attached to the note" }),
}).openapi("NoteListItem");

export const SchemaNoteListApiResponse = z.object({
  items: z.array(SchemaNoteListItemApiResponse),
  pagination: z.object({
    page: z.number().openapi({ description: "Current page", example: 1 }),
    limit: z.number().openapi({ description: "Page size used", example: 50 }),
    total: z.number().openapi({ description: "Total matching items", example: 137 }),
    totalPages: z.number().openapi({ description: "Total pages", example: 3 }),
    hasNext: z.boolean().openapi({ description: "A next page exists", example: true }),
    hasPrev: z.boolean().openapi({ description: "A previous page exists", example: false }),
  }),
}).openapi("NoteListResponse");

export const SchemaNoteEmbeddedLatestVersion = z.object({
  id: z.string().openapi({ description: "Version ID", example: "clx4k2j3v0000pq3x7b9v4r2v" }),
  body: z.string().openapi({ description: "Decrypted latest body", example: "# Heading\nDraft notes…" }),
  createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716422400000 }),
  createdByUserId: z.string().openapi({ description: "Author user ID", example: "clx4k2j3a0000pq3x7b9v4r2a" }),
}).openapi("NoteEmbeddedLatestVersion");

export const SchemaNoteEmbeddedTag = z.object({
  id: z.string().openapi({ description: "Tag ID", example: "clx4k2j3t0000pq3x7b9v4r2t" }),
  name: z.string().openapi({ description: "Tag name", example: "urgent" }),
  color: z.string().nullable().openapi({ description: "Tag color hex", example: "#ef4444" }),
}).openapi("NoteEmbeddedTag");

export const SchemaNoteEmbeddedSharedUser = z.object({
  userId: z.string().openapi({ description: "Shared user ID", example: "clx4k2j3u0000pq3x7b9v4r2u" }),
  firstName: z.string().openapi({ description: "First name", example: "Grace" }),
  lastName: z.string().openapi({ description: "Last name", example: "Hopper" }),
  avatarColor: z.string().nullable().openapi({ description: "Avatar color hex", example: "#6366f1" }),
  permissionLevel: z.string().openapi({ description: "Permission level granted", example: "read" }),
}).openapi("NoteEmbeddedSharedUser");

export const SchemaNoteEmbeddedPermissions = z.object({
  users: z.array(SchemaNoteEmbeddedSharedUser).openapi({ description: "Users with explicit access" }),
  myPermissionLevel: z.string().openapi({ description: "Caller's permission level on this note", example: "owner" }),
}).openapi("NoteEmbeddedPermissions");

export const SchemaNoteEmbeddedPublicShare = z.object({
  token: z.string().openapi({ description: "Public share token (shareable URL)", example: "wK7s9Qx2vP4m…" }),
  url: z.string().openapi({ description: "Full public share URL", example: "https://app.example.com/public/notes/wK7s9Qx2vP4m…" }),
  hasPassword: z.boolean().openapi({ description: "Whether a password protects this share", example: false }),
  expiresAt: z.number().nullable().openapi({ description: "Unix-ms expiry, null if never expires", example: null }),
  recipientEmail: z.string().nullable().optional().openapi({ description: "Optional recipient email", example: null }),
  createdAt: z.number().openapi({ description: "Unix-ms share creation timestamp", example: 1716336000000 }),
}).openapi("NoteEmbeddedPublicShare");

export const SchemaNoteDetailApiResponse = SchemaNoteApiResponse.extend({
  latestVersion: SchemaNoteEmbeddedLatestVersion.nullable().openapi({ description: "Latest body version, or null" }),
  tags: z.array(SchemaNoteEmbeddedTag).openapi({ description: "Tags attached to the note" }),
  permissions: SchemaNoteEmbeddedPermissions.openapi({ description: "Access list and caller's permission level" }),
  publicShares: z.array(SchemaNoteEmbeddedPublicShare).openapi({ description: "Active public share links" }),
  collectionName: z.string().nullable().openapi({ description: "Collection name, null if unassigned", example: "Marketing" }),
  collectionDescription: z.string().nullable().openapi({ description: "Collection description", example: "Outbound campaigns" }),
  collectionIcon: z.string().nullable().openapi({ description: "Collection icon identifier", example: "megaphone" }),
  collectionColor: z.string().nullable().openapi({ description: "Collection color hex", example: "#6366f1" }),
  collectionIsArchived: z.boolean().nullable().openapi({ description: "Whether the collection is archived", example: false }),
}).openapi("NoteDetail");

export type INoteResponse = z.infer<typeof SchemaNoteApiResponse>;
export type INoteCreateRequest = z.infer<typeof SchemaNoteCreateRequest>;
export type INoteUpdateRequest = z.infer<typeof SchemaNoteUpdateRequest>;
export type INoteListQuery = z.infer<typeof SchemaNoteListQuery>;
export type INoteListTag = z.infer<typeof SchemaNoteListTag>;
export type INoteListItemResponse = z.infer<typeof SchemaNoteListItemApiResponse>;
export type INoteListApiResponse = z.infer<typeof SchemaNoteListApiResponse>;
export type INoteEmbeddedLatestVersion = z.infer<typeof SchemaNoteEmbeddedLatestVersion>;
export type INoteEmbeddedTag = z.infer<typeof SchemaNoteEmbeddedTag>;
export type INoteEmbeddedSharedUser = z.infer<typeof SchemaNoteEmbeddedSharedUser>;
export type INoteEmbeddedPermissions = z.infer<typeof SchemaNoteEmbeddedPermissions>;
export type INoteEmbeddedPublicShare = z.infer<typeof SchemaNoteEmbeddedPublicShare>;
export type INoteDetailResponse = z.infer<typeof SchemaNoteDetailApiResponse>;
