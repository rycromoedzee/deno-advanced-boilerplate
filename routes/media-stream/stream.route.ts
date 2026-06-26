/**
 * @file routes/media-stream/stream.route.ts
 * @description Stream route definition
 */
import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// Video stream route - GET
export const mediaStreamRoute = createRoute({
  method: "get",
  path: "/media-stream/{section}/{fileId}",
  tags: [OpenAPITags.mediaStreaming],
  summary: "Stream media file (video or audio)",
  operationId: "mediaStreamGet",
  description:
    `Stream a media file with support for HTTP range requests and seeking. Handles encrypted files transparently. Supports Range header for partial content requests (e.g., 'Range: bytes=0-1023').

**Behavior:** Validates read access, decrypts the file transparently, and streams full or partial (range) content with appropriate content-type and accept-ranges headers.
**Auth:** cookie session
**Permissions:** read access to the file's section (validated per user)
**Notes:** Tenant-scoped; decryption keys resolved from user or app encryption context; decrypted content is served with a private Cache-Control directive.`,
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
      description: "Full media content",
      headers: z.object({
        "content-type": z.string().describe("Media MIME type (e.g., video/mp4 or audio/mpeg)"),
        "content-length": z.string().describe("Size of the media file in bytes"),
        "accept-ranges": z.literal("bytes").describe("Indicates support for range requests"),
        "cache-control": z.string().describe("Caching directives"),
      }),
      content: {
        "video/mp4": {
          schema: z.any().describe("Video file binary data"),
        },
        "video/webm": {
          schema: z.any().describe("Video file binary data"),
        },
        "video/*": {
          schema: z.any().describe("Video file binary data"),
        },
        "audio/mpeg": {
          schema: z.any().describe("Audio file binary data"),
        },
        "audio/*": {
          schema: z.any().describe("Audio file binary data"),
        },
      },
    },
    206: {
      description: "Partial media content (range request)",
      headers: z.object({
        "content-type": z.string().describe("Media MIME type"),
        "content-length": z.string().describe("Size of the partial content in bytes"),
        "content-range": z.string().describe("Range of bytes being returned (e.g., 'bytes 0-1023/2048')"),
        "accept-ranges": z.literal("bytes").describe("Indicates support for range requests"),
      }),
      content: {
        "video/mp4": {
          schema: z.any().describe("Partial video file binary data"),
        },
        "video/webm": {
          schema: z.any().describe("Partial video file binary data"),
        },
        "video/*": {
          schema: z.any().describe("Partial video file binary data"),
        },
        "audio/mpeg": {
          schema: z.any().describe("Partial audio file binary data"),
        },
        "audio/*": {
          schema: z.any().describe("Partial audio file binary data"),
        },
      },
    },
    400: {
      description: "Bad request - invalid file ID or not a media file",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
    404: {
      description: "Media file not found",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
  },
});

// Video stream HEAD route - HEAD
export const mediaStreamHeadRoute = createRoute({
  method: "head",
  path: "/media-stream/{section}/{fileId}",
  tags: [OpenAPITags.mediaStreaming],
  summary: "Get media file metadata",
  operationId: "mediaStreamHead",
  description: `Get media file metadata without downloading the content. Useful for checking file size and type before streaming.

**Behavior:** Validates read access and returns headers (content-type, content-length, accept-ranges, cache-control) with an empty body.
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
      description: "Media file metadata",
      headers: z.object({
        "content-type": z.string().describe("Media MIME type (e.g., video/mp4 or audio/mpeg)"),
        "content-length": z.string().describe("Size of the media file in bytes"),
        "accept-ranges": z.literal("bytes").describe("Indicates support for range requests"),
        "cache-control": z.string().describe("Caching directives"),
      }),
    },
    400: {
      description: "Bad request - invalid file ID or not a media file",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
    404: {
      description: "Media file not found",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
  },
});
