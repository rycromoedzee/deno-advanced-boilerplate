import { z } from "@deps";

/**
 * @file models/documents/folder-settings.model.ts
 * @description Folder settings API response schemas and types
 */

/**
 * Summary statistics schema
 */
export const SchemaFolderSettingsSummary = z.object({
  totalFolderCount: z.number().int().nonnegative().openapi({
    description: "Total number of folders owned by the user (non-archived)",
    example: 25,
  }),
  maxFolderDepth: z.number().int().nonnegative().openapi({
    description: "Maximum depth of the user's folder hierarchy",
    example: 5,
  }),
  usersWithSharedAccess: z.number().int().nonnegative().openapi({
    description: "Number of distinct users who have shared access to the user's owned folders",
    example: 8,
  }),
  foldersSharedWithMe: z.number().int().nonnegative().openapi({
    description: "Number of folders that have been shared with the current user",
    example: 12,
  }),
});

export type IFolderSettingsSummary = z.infer<typeof SchemaFolderSettingsSummary>;

/**
 * Root folder statistics schema
 */
export const SchemaRootFolderStat = z.object({
  id: z.string().openapi({
    description: "Folder ID",
    example: "folder_123",
  }),
  name: z.string().openapi({
    description: "Folder name",
    example: "Projects",
  }),
  icon: z.string().nullable().openapi({
    description: "Folder icon identifier",
    example: "folder",
  }),
  color: z.string().openapi({
    description: "Folder color (hex code)",
    example: "#3b82f6",
  }),
  isArchived: z.boolean().openapi({
    description: "Whether the folder is archived",
    example: false,
  }),
  subFolderCount: z.number().int().nonnegative().openapi({
    description: "Total number of nested subfolders (recursive count)",
    example: 15,
  }),
  documentCount: z.number().int().nonnegative().openapi({
    description: "Total number of documents in the folder tree (recursive count)",
    example: 42,
  }),
  isShared: z.boolean().openapi({
    description: "Whether the folder has any actively shared users",
    example: true,
  }),
  sharedUserCount: z.number().int().nonnegative().openapi({
    description: "Number of users the folder is shared with",
    example: 3,
  }),
  maxDepth: z.number().int().nonnegative().openapi({
    description: "Maximum nesting depth from this root folder",
    example: 4,
  }),
});

export type IRootFolderStat = z.infer<typeof SchemaRootFolderStat>;

/**
 * Base folder structure item schema (without recursive children)
 */
const SchemaFolderStructureItemBase = z.object({
  id: z.string().openapi({
    description: "Folder ID",
    example: "folder_123",
  }),
  name: z.string().openapi({
    description: "Folder name",
    example: "Projects",
  }),
  icon: z.string().nullable().openapi({
    description: "Folder icon identifier",
    example: "folder",
  }),
  color: z.string().openapi({
    description: "Folder color (hex code)",
    example: "#3b82f6",
  }),
  isArchived: z.boolean().openapi({
    description: "Whether the folder is archived",
    example: false,
  }),
  documentCount: z.number().int().nonnegative().openapi({
    description: "Number of documents directly in this folder (not recursive)",
    example: 8,
  }),
});

/**
 * Folder structure item type (defined first to avoid circular reference)
 */
export type IFolderStructureItem = z.infer<typeof SchemaFolderStructureItemBase> & {
  children: IFolderStructureItem[] | null;
};

/**
 * Folder structure item schema (recursive)
 * Used internally for type-safe recursive structures
 */
export const SchemaFolderStructureItem: z.ZodType<IFolderStructureItem> = z.lazy(() =>
  SchemaFolderStructureItemBase.extend({
    children: z.array(SchemaFolderStructureItem).nullable().openapi({
      description: "Nested child folders (recursive structure). null if no children.",
    }),
  })
);

/**
 * Non-recursive folder structure item schema for OpenAPI routes
 * Use this in route definitions to avoid lazy type issues
 */
export const SchemaFolderStructureItemApiResponse = SchemaFolderStructureItemBase.extend({
  children: z.array(z.any()).nullable().openapi({
    description: "Nested child folders (recursive structure). null if no children.",
  }),
});

/**
 * Complete folder settings response schema
 */
export const SchemaFolderSettingsResponse = z.object({
  summary: SchemaFolderSettingsSummary.openapi({
    description: "Summary statistics for the user's folders",
  }),
  rootFolderStats: z.array(SchemaRootFolderStat).openapi({
    description: "Statistics for each root folder (folders with no parent)",
  }),
  folderStructure: z.array(SchemaFolderStructureItemApiResponse).openapi({
    description: "Recursive folder structure including both owned and shared folders",
  }),
});

export type IFolderSettingsResponse = z.infer<typeof SchemaFolderSettingsResponse>;
