/**
 * @file models/notes/note-sharing.model.ts
 * @description Note Sharing model/types
 */
import { z } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";

const permissionLevelEnum = z.enum(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as [string, ...string[]]);

export const SchemaNoteShareRequest = z.object({
  toUserId: z.string().min(1).openapi({ description: "User ID to share with", example: "clx4k2j3u0000pq3x7b9v4r2u" }),
  permissionLevel: permissionLevelEnum.openapi({ description: "Access level to grant", example: "read" }),
}).openapi("NoteShareRequest");

export const SchemaNoteShareRevokeRequest = z.object({
  targetUserId: z.string().min(1).openapi({ description: "User ID whose access to revoke", example: "clx4k2j3u0000pq3x7b9v4r2u" }),
}).openapi("NoteShareRevokeRequest");

export const SchemaNotePublicShareRequest = z.object({
  password: z.string().min(1).optional().openapi({
    description: "Optional password protecting the share",
    example: "correct-horse-battery-staple",
  }),
  expiresAt: z.number().int().nullable().optional().openapi({
    description: "Unix-ms expiry, or null for no expiry",
    example: 1717027200000,
  }),
  permissionLevel: permissionLevelEnum.optional().openapi({ description: "Access level for public viewers", example: "read" }),
}).openapi("NotePublicShareRequest");

export const SchemaNotePublicShareResponse = z.object({
  shareToken: z.string().openapi({ description: "Public share token used in the shareable URL", example: "wK7s9Qx2vP4m…" }),
  /**
   * Per-share random key. The frontend places this in the URL fragment (#) so
   * it is never sent back to the server in subsequent requests except as the
   * `shareKey` query/header on the public read endpoint.
   */
  shareKey: z.string().openapi({ description: "Secret per-share key (kept in the URL fragment by clients)", example: "a3F9b2C7d1E6…" }),
  expiresAt: z.number().nullable().openapi({ description: "Unix-ms expiry, null if it never expires", example: 1717027200000 }),
  isPasswordProtected: z.boolean().openapi({ description: "Whether a password protects this share", example: false }),
}).openapi("NotePublicShareResponse");

export const SchemaNoteSharedUser = z.object({
  userId: z.string().openapi({ description: "Shared user ID", example: "clx4k2j3u0000pq3x7b9v4r2u" }),
  email: z.string().nullable().openapi({ description: "User email, if available", example: "grace@example.com" }),
  name: z.string().openapi({ description: "Display name", example: "Grace Hopper" }),
  permissionLevel: z.string().openapi({ description: "Granted permission level", example: "read" }),
  grantedAt: z.number().openapi({ description: "Unix-ms grant timestamp", example: 1716336000000 }),
  grantedBy: z.string().nullable().openapi({ description: "User ID who granted access", example: "clx4k2j3o0000pq3x7b9v4r2o" }),
}).openapi("NoteSharedUser");

export const SchemaNotePermissionsListResponse = z.object({
  users: z.array(SchemaNoteSharedUser).openapi({ description: "Users with explicit access to the note" }),
}).openapi("NotePermissionsListResponse");

export type INoteShareRequest = z.infer<typeof SchemaNoteShareRequest>;
export type INotePublicShareRequest = z.infer<typeof SchemaNotePublicShareRequest>;

export const SchemaNoteShareListQuery = z.object({
  type: z.enum(["all", "internal", "public"]).default("all")
    .openapi({ description: "Filter shares by type", example: "all" }),
}).openapi("NoteShareListQuery");

export const SchemaNoteShareListItem = z.object({
  type: z.enum(["internal", "public"]).openapi({ description: "Share type", example: "internal" }),
  noteId: z.string().openapi({ description: "Shared note ID", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  noteTitle: z.string().openapi({ description: "Note title at share time", example: "Q3 launch checklist" }),
  permissionLevel: z.string().openapi({ description: "Permission level granted", example: "read" }),
  createdAt: z.number().openapi({ description: "Unix-ms share creation timestamp", example: 1716336000000 }),
  // Internal share fields (null for public shares)
  sharedWithUserId: z.string().nullable().openapi({
    description: "Internal: recipient user ID (null for public)",
    example: "clx4k2j3u0000pq3x7b9v4r2u",
  }),
  sharedWithEmail: z.string().nullable().openapi({
    description: "Internal: recipient email (null for public)",
    example: "grace@example.com",
  }),
  sharedWithName: z.string().nullable().openapi({ description: "Internal: recipient name (null for public)", example: "Grace Hopper" }),
  // Public share fields (null for internal shares)
  shareToken: z.string().nullable().openapi({ description: "Public: share token (null for internal)", example: "wK7s9Qx2vP4m…" }),
  isPasswordProtected: z.boolean().nullable().openapi({
    description: "Public: whether password-protected (null for internal)",
    example: false,
  }),
  isActive: z.boolean().nullable().openapi({ description: "Public: whether the link is active (null for internal)", example: true }),
  expiresAt: z.number().nullable().openapi({ description: "Unix-ms expiry, null if none", example: null }),
}).openapi("NoteShareListItem");

export const SchemaNoteShareListResponse = z.object({
  items: z.array(SchemaNoteShareListItem).openapi({ description: "Shares created by the caller" }),
}).openapi("NoteShareListResponse");

export type INoteShareListItem = z.infer<typeof SchemaNoteShareListItem>;
