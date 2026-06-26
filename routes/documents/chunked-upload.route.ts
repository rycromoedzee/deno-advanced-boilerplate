/**
 * @file routes/documents/chunked-upload.route.ts
 * @description API routes for chunked file upload operations
 */

import { createRoute, z } from "@deps";
import {
  SchemaCompleteChunkedUploadRequest,
  SchemaInitiateUploadRequest,
  SchemaInitiateUploadResponse,
  SchemaSessionIdParam,
  SchemaUploadChunkResponse,
  SchemaUploadStatusResponse,
} from "@models/documents/chunked-upload.model.ts";
import {
  httpResponseBadRequest,
  httpResponseContentTooLarge,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";

/**
 * POST /api/documents/upload/chunked/initiate
 * Initiate a new chunked upload session
 */
export const initiateChunkedUploadRoute = createRoute({
  method: "post",
  path: "/upload/chunked/initiate",
  operationId: "documentChunkedUploadInit",
  summary: "Initiate chunked upload",
  description: `Create a new upload session for chunked file upload. Returns session ID and chunk configuration.

**Behavior:** Creates an upload session keyed by the caller, computes chunk size and total chunks from the declared file size (max 5 GB), and returns a session ID with an expiration timestamp. MIME type is auto-detected from the filename if not provided.
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; the caller owns the session and the resulting document.
**Notes:** tenant-scoped; sessions expire and are referenced by subsequent chunk/status/complete calls. Use this flow for large files that exceed the single-request upload path.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    ...withJsonBody(SchemaInitiateUploadRequest),
  },
  responses: {
    200: {
      description: "Upload session created successfully",
      content: {
        "application/json": {
          schema: SchemaInitiateUploadResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseContentTooLarge,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/documents/upload/chunked/chunk
 * Upload a single chunk
 */
export const uploadChunkRoute = createRoute({
  method: "post",
  path: "/upload/chunked/chunk",
  operationId: "documentChunkedUploadPart",
  summary: "Upload chunk",
  description: `Upload a single file chunk. Chunks should be uploaded sequentially.

**Behavior:** Accepts the raw chunk bytes (\`application/octet-stream\`) for the given \`sessionId\` and \`chunkIndex\`, encrypts them server-side, and records progress. Returns the running chunk count and progress percentage, plus the list of any missing chunks for resume.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session.
**Notes:** tenant-scoped; sessions can be resumed — missing chunk indices are reported so the client can re-upload only the gaps.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: z.object({
      sessionId: z.string().openapi({
        description: "Upload session ID",
        example: "session_abc123",
      }),
      chunkIndex: z.coerce.number().int().min(0).openapi({
        description: "0-based chunk index",
        example: 5,
      }),
    }),
    body: {
      content: {
        "application/octet-stream": {
          schema: z.instanceof(Blob).openapi({
            type: "string",
            format: "binary",
            description: "Raw chunk data",
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Chunk uploaded successfully",
      content: {
        "application/json": {
          schema: SchemaUploadChunkResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * GET /api/documents/upload/chunked/status/:sessionId
 * Get upload progress/status
 */
export const getUploadStatusRoute = createRoute({
  method: "get",
  path: "/upload/chunked/status/{sessionId}",
  operationId: "documentChunkedUploadStatus",
  summary: "Get upload status",
  description: `Retrieve current upload progress and missing chunks (for resume functionality).

**Behavior:** Returns the session status, chunks uploaded vs total, progress percentage, missing chunk indices, expiration timestamp, and — once assembly completes — the created \`documentId\`. Includes an \`errorMessage\` when the session has failed.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session.
**Notes:** tenant-scoped; poll this endpoint after \`complete\` returns 202 to track assembly and obtain the final \`documentId\`.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: SchemaSessionIdParam,
  },
  responses: {
    200: {
      description: "Upload status retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaUploadStatusResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/documents/upload/chunked/complete
 * Complete the chunked upload
 */
export const completeChunkedUploadRoute = createRoute({
  method: "post",
  path: "/upload/chunked/complete/{sessionId}",
  operationId: "documentChunkedUploadComplete",
  summary: "Complete chunked upload",
  description: `Finalize the upload by assembling all chunks and creating the document record with metadata.

**Behavior:** Queues background assembly of the uploaded chunks into the final encrypted document, applying the optional metadata (name, description, folder, tags, metadata, shared users, initial comment). Returns 202 immediately; poll GET \`/status/{sessionId}\` (or the SSE stream) to obtain the final \`documentId\`. The request body is optional — fields fall back to values captured at initiation.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session; the caller becomes the document owner.
**Notes:** tenant-scoped; assembly is asynchronous. An optional pre-uploaded session thumbnail (uploaded via \`/thumbnail/{sessionId}\`) is applied to the document once assembly completes.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: SchemaSessionIdParam,
    body: {
      content: {
        "application/json": {
          schema: SchemaCompleteChunkedUploadRequest.optional(),
        },
      },
      required: false,
    },
  },
  responses: {
    202: {
      description:
        "Assembly queued. Poll GET /status/:sessionId to track progress. documentId will be present in the status response once status is 'completed'.",
      content: {
        "application/json": {
          schema: z.object({
            sessionId: z.string().openapi({
              description: "Upload session ID",
              example: "xp-tWULVWWVdqtClpbKaS",
            }),
            status: z.literal("assembling").openapi({
              description: "Current session status",
              example: "assembling",
            }),
          }),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * GET /api/documents/upload/chunked/stream/:sessionId
 * SSE stream for assembly progress events
 */
export const streamChunkedUploadRoute = createRoute({
  method: "get",
  path: "/upload/chunked/stream/{sessionId}",
  operationId: "documentChunkedUploadStream",
  summary: "Stream upload assembly progress",
  description:
    `Subscribe to SSE events for chunked upload assembly. Events: assembling | completed (includes documentId) | failed (includes errorMessage).

**Behavior:** Opens a \`text/event-stream\` that emits assembly lifecycle events for the session, an alternative to polling the status endpoint.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session.
**Notes:** tenant-scoped; the \`completed\` event carries the final \`documentId\`.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: SchemaSessionIdParam,
  },
  responses: {
    200: {
      description: "SSE stream (text/event-stream)",
      content: {
        "text/event-stream": {
          schema: z.string().openapi({ description: "SSE event stream" }),
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/documents/upload/chunked/thumbnail/:sessionId
 * Upload a thumbnail for a chunked upload session (Option A: before complete)
 */
export const uploadSessionThumbnailRoute = createRoute({
  method: "post",
  path: "/upload/chunked/thumbnail/{sessionId}",
  operationId: "documentChunkedUploadThumbnail",
  summary: "Upload session thumbnail",
  description:
    `Upload a JPEG thumbnail for the document before calling the complete endpoint. The thumbnail is encrypted and stored temporarily; the background assembly job applies it to the document after creation.

**Behavior:** Validates the JPEG bytes and dimensions, encrypts the thumbnail, and stores it against the session so that the assembly job can attach it to the created document.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session.
**Notes:** tenant-scoped; max 1 MB; must be called before \`complete\`.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: SchemaSessionIdParam,
    body: {
      content: {
        "application/octet-stream": {
          schema: z.instanceof(Blob).openapi({
            type: "string",
            format: "binary",
            description: "Raw JPEG thumbnail data (max 1MB)",
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Thumbnail accepted and stored in session",
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            thumbnailSize: z.number().int(),
            thumbnailWidth: z.number().int(),
            thumbnailHeight: z.number().int(),
          }),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

/**
 * DELETE /api/documents/upload/chunked/abort/:sessionId
 * Abort/cancel an upload session
 */
export const abortChunkedUploadRoute = createRoute({
  method: "delete",
  path: "/upload/chunked/abort/{sessionId}",
  operationId: "documentChunkedUploadAbort",
  summary: "Abort chunked upload",
  description: `Cancel an ongoing upload session and cleanup uploaded chunks.

**Behavior:** Marks the session aborted and deletes any uploaded chunk data and the session record. Returns 204 on success.
**Auth:** cookie session or API key.
**Permissions:** the caller must own the upload session.
**Notes:** tenant-scoped; aborting frees the temporary chunk storage.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: SchemaSessionIdParam,
  },
  responses: {
    204: {
      description: "Upload aborted successfully",
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
