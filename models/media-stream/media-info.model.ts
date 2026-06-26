/**
 * @file models/media-stream/media-info.model.ts
 * @description Zod response schema for media info endpoint
 */

import { z } from "@deps";

/** Media file info response (GET /api/media-stream/:section/:fileId/info) */
export const SchemaMediaInfoResponse = z.object({
  fileId: z.string().openapi({
    description: "Unique identifier for the media file",
    example: "cm2f9a1b2c3d4e5f6g7h8i9j",
  }),
  originalName: z.string().openapi({
    description: "Original filename when uploaded",
    example: "quarterly-review.mp4",
  }),
  mimeType: z.string().openapi({
    description: "Media MIME type (e.g., video/mp4 or audio/mpeg)",
    example: "video/mp4",
  }),
  originalFileSize: z.number().openapi({
    description: "Size of the original (decrypted) media file in bytes",
    example: 24830274,
  }),
  encryptedFileSize: z.number().openapi({
    description: "Size of the encrypted media file in bytes",
    example: 24832512,
  }),
  streamingUrl: z.string().openapi({
    description: "URL for streaming this media",
    example: "/api/media-stream/documents/cm2f9a1b2c3d4e5f6g7h8i9j",
  }),
  createdAt: z.number().openapi({
    description: "Unix timestamp (ms) when the media was uploaded",
    example: 1718800000000,
  }),
  updatedAt: z.number().openapi({
    description: "Unix timestamp (ms) when the media metadata was last updated",
    example: 1718800100000,
  }),
});
