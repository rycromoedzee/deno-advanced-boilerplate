/**
 * @file models/documents/document-create-options.model.ts
 * @description Document Create Options model/types
 */
import { z } from "@deps";
import { SchemaDocumentFolderResponse } from "@models/documents/folder.model.ts";
import { SchemaDocumentTagResponse } from "@models/documents/tag.model.ts";

/**
 * @file models/documents/document-create-options.model.ts
 * @description Schema for document create options endpoint
 * Provides available options for document creation (folders, tags, users)
 */

/**
 * Shared user option schema - users available for sharing
 */
export const SchemaSharedUserOption = z.object({
  id: z.string().openapi({
    description: "User identifier",
    example: "user_abc123",
  }),
  firstName: z.string().openapi({
    description: "User's first name",
    example: "John",
  }),
  lastName: z.string().openapi({
    description: "User's last name",
    example: "Doe",
  }),
  email: z.string().email().openapi({
    description: "User's email address",
    example: "john.doe@example.com",
  }),
});

export type ISharedUserOption = z.infer<typeof SchemaSharedUserOption>;

/**
 * Folder option schema - folders available for document placement
 * Includes both owned folders and folders with write access
 */
export const SchemaFolderOption = SchemaDocumentFolderResponse.extend({
  isOwned: z.boolean().openapi({
    description: "Whether the current user owns this folder",
    example: true,
  }),
  permissionLevel: z.number().int().min(0).max(5).optional().openapi({
    description: "Permission level if folder is shared (only present for shared folders)",
    example: 2,
  }),
});

export type IFolderOption = z.infer<typeof SchemaFolderOption>;

/**
 * Document create options response schema
 * Provides all available options for creating a new document
 */
export const SchemaDocumentCreateOptionsResponse = z.object({
  folders: z.array(SchemaFolderOption).openapi({
    description: "Available folders (owned by user or with write access)",
    example: [],
  }),
  tags: z.array(SchemaDocumentTagResponse).openapi({
    description: "Available tags owned by the current user",
    example: [],
  }),
  sharedUsers: z.array(SchemaSharedUserOption).openapi({
    description: "Users in the same environment that can be shared with",
    example: [],
  }),
});

export type IDocumentCreateOptionsResponse = z.infer<typeof SchemaDocumentCreateOptionsResponse>;
