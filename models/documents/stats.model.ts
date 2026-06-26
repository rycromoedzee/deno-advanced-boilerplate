/**
 * @file models/documents/stats.model.ts
 * @description Stats model/types
 */
import { z } from "@deps";

/**
 * Document statistics response schema
 * Returns aggregate counts and storage metrics for user's documents
 */
export const SchemaDocumentStatsResponse = z.object({
  documents: z.object({
    total: z.number().int().nonnegative().openapi({
      description: "Total number of documents (excluding archived)",
      example: 150,
    }),
    archived: z.number().int().nonnegative().openapi({
      description: "Number of archived documents",
      example: 25,
    }),
  }),
  folders: z.object({
    total: z.number().int().nonnegative().openapi({
      description: "Total number of folders (excluding archived)",
      example: 30,
    }),
    archived: z.number().int().nonnegative().openapi({
      description: "Number of archived folders",
      example: 5,
    }),
  }),
  tags: z.object({
    total: z.number().int().nonnegative().openapi({
      description: "Total number of tags created by user",
      example: 20,
    }),
  }),
  storage: z.object({
    totalBytes: z.number().int().nonnegative().openapi({
      description: "Total storage used in bytes (sum of original file sizes)",
      example: 5368709120,
    }),
    encryptedBytes: z.number().int().nonnegative().openapi({
      description: "Total encrypted storage used in bytes",
      example: 5402345472,
    }),
  }),
});

export type IDocumentStatsResponse = z.infer<typeof SchemaDocumentStatsResponse>;
