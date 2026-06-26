/**
 * @file routes/media-stream/info.route.ts
 * @description Info route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// Video info route - GET /api/video-stream/{fileId}/info
export const mediaInfoRoute = createRoute({
  method: "get",
  path: "/media-stream/{section}/{fileId}/info",
  tags: [OpenAPITags.mediaStreaming],
  summary: "Get detailed media information",
  operationId: "mediaStreamInfoGet",
  description: `Get detailed metadata about a media file including size and streaming URLs.

**Behavior:** Resolves the section/fileId to storage metadata, validates read access, and returns file metadata plus a streaming URL.
**Auth:** cookie session
**Permissions:** read access to the file's section (validated per user)
**Notes:** Tenant-scoped; returns 404 when the file is not found.`,
  request: {
    params: z.object({
      section: z.string().min(1, withKey("validation.section-required", "Section is required")).describe(
        "The section where the file is stored (e.g., documents, to-do-files, notes)",
      ),
      fileId: z.string().min(1, withKey("validation.file-id-required", "File ID is required")).describe("Unique identifier for the file"),
    }),
  },
  responses: {
    200: {
      description: "Media file information",
      content: {
        "application/json": {
          schema: z.object({
            fileId: z.string().describe("Unique identifier for the media file"),
            originalName: z.string().describe("Original filename when uploaded"),
            mimeType: z.string().describe("Media MIME type (e.g., video/mp4 or audio/mpeg)"),
            originalFileSize: z.number().describe("Size of the original media file in bytes"),
            encryptedFileSize: z.number().describe("Size of the encrypted media file in bytes"),
            streamingUrl: z.string().describe("URL for streaming this media"),
            createdAt: z.number().describe("Unix timestamp when the media was uploaded"),
            updatedAt: z.number().describe("Unix timestamp when the media metadata was last updated"),
          }),
        },
      },
    },
  },
});
