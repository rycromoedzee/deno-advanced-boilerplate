/**
 * @file routes/documents-public/documents-public.route.ts
 * @description Public document routes with OpenAPI specifications (no authentication required)
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * - shareId: Query parameter (used for database lookup)
 * - shareKey: Header "Share-Key" (from URL fragment, never sent to server in URL)
 *
 * The frontend extracts the shareKey from the URL fragment (#) and sends it via
 * the Share-Key header. This ensures the key never appears in server logs or
 * browser history.
 */

import { createRoute, z } from "@deps";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { httpResponseBadRequest } from "@utils/openapi/open-api-shared.ts";
import { SchemaPublicFolderDocumentsResponse } from "@models/documents/folder-sharing.model.ts";

/**
 * Minimal public document response schema
 * Used for public document access to return only essential information
 */
export const SchemaPublicDocumentResponsePublic = z.object({
  document: z.object({
    name: z.string(),
    description: z.string().nullable(),
    contentType: z.string().nullable(),
    mimeType: z.string().nullable(),
    fileSize: z.number().int().nonnegative(),
  }),
  shareId: z.string(),
});

/**
 * Access public document route (no authentication required)
 * GET /api/v1/public/documents?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 */
export const accessPublicDocumentRoutePublic = createRoute({
  method: "get",
  path: "/",
  summary: "Access public document",
  operationId: "documentPublicShareGet",
  security: [],
  description:
    "Accesses a publicly shared document and returns its metadata (no authentication required).\n\n**Behavior:** Looks up the share by `shareId` (query), validates optional password protection, and returns document name/description/content-type/mime/size. Zero-knowledge access is gated by the `Share-Key` header (derived from the share URL fragment, never sent in the URL).\n**Auth:** public (share id + Share-Key header + optional password)\n**Permissions:** none — access is granted by possession of the share key\n**Notes:** rate-limited more strictly than authenticated endpoints; password failures return 401, all other failures collapse to 404 to prevent enumeration.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    query: z.object({
      shareId: z.string().trim().openapi({
        description: "Share ID for the public share (lookup key)",
        example: "iyhp6NCE52Wl8Hjme5UqEaUKF0QSB2hwpOCuOcinu2-Fz_USJrMVsS2p56k2u7P1FI1CFWH17hveoTNYICLNtg",
      }),
      password: z.string().trim().nullable().optional().openapi({
        description: "Optional password for password-protected shares",
        example: "Password123!",
      }),
    }),
    headers: z.object({
      "share-key": z.string().trim().optional().openapi({
        description: "Share key from URL fragment (required for zero-knowledge shares)",
        example: "xviq9SOUOarOto-XZug9hsg_IOHuurh7eixU3C7LxD1qsKUUDOh9ObN47G9Ni36a4Ox2NUoYe1Y9DcZ6H8qM0w",
      }),
    }),
  },
  responses: {
    200: {
      description: "Document metadata retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaPublicDocumentResponsePublic,
        },
      },
    },
    ...httpResponseBadRequest,
    401: {
      description: "Password required or invalid",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string().openapi({ example: "Password required or invalid" }),
            code: z.string().openapi({ example: "PASSWORD_REQUIRED" }),
          }),
        },
      },
    },
    404: {
      description: "Public share not found, invalid token, or expired",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string().openapi({ example: "Public share not found, invalid token, or expired" }),
            code: z.string().openapi({ example: "SHARE_NOT_FOUND" }),
          }),
        },
      },
    },
  },
});

/**
 * Download public document route (no authentication required)
 * GET /api/public/documents/download?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 */
export const downloadPublicDocumentRoutePublic = createRoute({
  method: "get",
  path: "/download",
  summary: "Download public document",
  operationId: "documentPublicDownload",
  security: [],
  description:
    "Downloads a publicly shared document as a decrypted file stream with `attachment` content disposition (no authentication required).\n\n**Behavior:** Verifies the share via `shareId` (query) + `Share-Key` header (+ optional password), runs the share inputs through security-threat validation, then streams the decrypted file. The `Share-Key` header is intentionally excluded from threat logging to avoid leaking it.\n**Auth:** public (share id + Share-Key header + optional password)\n**Permissions:** none — access granted by possession of the share key\n**Notes:** zero-knowledge; rate-limited; password failures return 401, all other failures collapse to 404; timing-normalized to the auth profile.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    query: z.object({
      shareId: z.string().trim().openapi({
        description: "Share ID for the public share (lookup key)",
        example: "iyhp6NCE52Wl8Hjme5UqEaUKF0QSB2hwpOCuOcinu2-Fz_USJrMVsS2p56k2u7P1FI1CFWH17hveoTNYICLNtg",
      }),
      password: z.string().trim().nullable().optional().openapi({
        description: "Optional password for password-protected shares",
        example: "Password123!",
      }),
    }),
    headers: z.object({
      "share-key": z.string().trim().optional().openapi({
        description: "Share key from URL fragment (required for zero-knowledge shares)",
        example: "xviq9SOUOarOto-XZug9hsg_IOHuurh7eixU3C7LxD1qsKUUDOh9ObN47G9Ni36a4Ox2NUoYe1Y9DcZ6H8qM0w",
      }),
    }),
  },
  responses: {
    200: {
      description: "Document file stream",
      content: {
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    ...httpResponseBadRequest,
    400: {
      description: "Share key required",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
    401: {
      description: "Password required or invalid",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Public share not found, invalid token, or expired",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
  },
});

/**
 * Stream public document route (no authentication required)
 * GET /api/v1/public/documents/stream?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 */
export const streamPublicDocumentRoutePublic = createRoute({
  method: "get",
  path: "/stream",
  summary: "Stream public document",
  operationId: "documentPublicStream",
  security: [],
  description:
    "Streams a publicly shared document for inline browser viewing (videos, PDFs, images, audio) with `inline` content disposition (no authentication required).\n\n**Behavior:** Verifies the share via `shareId` (query) + `Share-Key` header (+ optional password). Honors the `Range` header for partial-content requests using optimized chunk-based decryption (returns `206`); otherwise streams the full decrypted document. Logs each stream access.\n**Auth:** public (share id + Share-Key header + optional password)\n**Permissions:** none — access granted by possession of the share key\n**Notes:** zero-knowledge; rate-limited; password failures return 401, all other failures collapse to 404; timing-normalized to the auth profile.",
  tags: [OpenAPITagsDocumentFeature.documentSharing],
  request: {
    query: z.object({
      shareId: z.string().trim().openapi({
        description: "Share ID for the public share (lookup key)",
        example: "iyhp6NCE52Wl8Hjme5UqEaUKF0QSB2hwpOCuOcinu2-Fz_USJrMVsS2p56k2u7P1FI1CFWH17hveoTNYICLNtg",
      }),
      password: z.string().trim().nullable().optional().openapi({
        description: "Optional password for password-protected shares",
        example: "Password123!",
      }),
    }),
    headers: z.object({
      "share-key": z.string().trim().optional().openapi({
        description: "Share key from URL fragment (required for zero-knowledge shares)",
        example: "xviq9SOUOarOto-XZug9hsg_IOHuurh7eixU3C7LxD1qsKUUDOh9ObN47G9Ni36a4Ox2NUoYe1Y9DcZ6H8qM0w",
      }),
      "range": z.string().trim().optional().openapi({
        description: "Range header for partial content requests",
        example: "bytes=0-1023",
      }),
    }),
  },
  responses: {
    200: {
      description: "Document file stream for inline viewing",
      content: {
        "video/mp4": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "video/*": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "audio/*": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "image/*": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "application/pdf": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    206: {
      description: "Partial content for range requests",
      content: {
        "video/mp4": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
        "application/octet-stream": {
          schema: z.string().openapi({ type: "string", format: "binary" }),
        },
      },
    },
    ...httpResponseBadRequest,
    400: {
      description: "Share key required",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
    401: {
      description: "Password required or invalid",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
    404: {
      description: "Public share not found, invalid token, or expired",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string(),
            code: z.string(),
          }),
        },
      },
    },
  },
});

/**
 * List documents in a public folder route (no authentication required)
 * GET /api/public/documents/folders/documents?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 */
export const listPublicFolderDocumentsRoutePublic = createRoute({
  method: "get",
  path: "/folders/documents",
  summary: "Access public folder and list documents",
  operationId: "documentPublicFolderList",
  security: [],
  description:
    "Accesses a publicly shared folder and returns folder metadata with all direct child documents (no authentication required).\n\n**Behavior:** Parses the `environmentId` and token out of the composite `shareId`, injects the environmentId into the request context for tenant routing, then returns the folder and its direct child documents (no nested subfolders). Zero-knowledge access is gated by the `Share-Key` header.\n**Auth:** public (share id + Share-Key header + optional password)\n**Permissions:** none — access granted by possession of the share key\n**Notes:** rate-limited; the shareId encodes the owning tenant so no session is required; password failures return 401, other failures collapse to 404.",
  tags: [OpenAPITagsDocumentFeature.publicAccess],
  request: {
    query: z.object({
      shareId: z.string().trim().openapi({
        description: "Share ID for the public folder share (encodes environmentId + token)",
        example: "iyhp6NCE52Wl8Hjme5UqEaUKF0QSB2hwpOCuOcinu2-Fz_USJrMVsS2p56k2u7P1FI1CFWH17hveoTNYICLNtg",
      }),
      password: z.string().trim().nullable().optional().openapi({
        description: "Optional password for password-protected shares",
        example: "Password123!",
      }),
    }),
    headers: z.object({
      "share-key": z.string().trim().optional().openapi({
        description: "Share key from URL fragment (required for zero-knowledge shares)",
        example: "xviq9SOUOarOto-XZug9hsg_IOHuurh7eixU3C7LxD1qsKUUDOh9ObN47G9Ni36a4Ox2NUoYe1Y9DcZ6H8qM0w",
      }),
    }),
  },
  responses: {
    200: {
      description: "Folder and documents retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaPublicFolderDocumentsResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    401: {
      description: "Password required or invalid",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string().openapi({ example: "Password required or invalid" }),
            code: z.string().openapi({ example: "PASSWORD_REQUIRED" }),
          }),
        },
      },
    },
    404: {
      description: "Public share not found, invalid token, or expired",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            error: z.string().openapi({ example: "Public share not found, invalid token, or expired" }),
            code: z.string().openapi({ example: "SHARE_NOT_FOUND" }),
          }),
        },
      },
    },
  },
});
