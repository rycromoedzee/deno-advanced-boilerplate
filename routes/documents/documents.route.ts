/**
 * @file routes/documents/documents.route.ts
 * @description Documents route definition
 */
import { createRoute, z } from "@deps";
import {
  SchemaDocumentArchiveRequest,
  SchemaDocumentDetailedResponse,
  SchemaDocumentDuplicateRequest,
  SchemaDocumentListQuery,
  SchemaDocumentMoveRequest,
  SchemaDocumentResponse,
  SchemaDocumentUpdateRequest,
} from "@models/documents/document.model.ts";
import { SchemaDocumentCreateOptionsResponse } from "@models/documents/document-create-options.model.ts";
import { SchemaPaginatedResponse } from "@models/shared.model.ts";
import {
  httpResponseBadRequest,
  httpResponseContentTooLarge,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsDocumentFeature } from "@utils/openapi/tags.ts";
import { SCHEMA_DOCUMENT_ID } from "@models/documents/index.ts";
import { SchemaDocumentTreeResponse } from "@models/documents/folder.model.ts";

// List documents route
export const listDocumentsRoute = createRoute({
  method: "get",
  path: "/",
  operationId: "documentsList",
  summary: "List documents",
  description: `Retrieves a paginated list of documents with optional filtering.

**Behavior:** Returns documents the current user owns or can access, filtered by folder, tags, content type, archive status, favorites, and free-text search. When a \`folderId\` filter is supplied, the user must have READ access to that folder or an empty page is returned.
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; folder access is checked when filtering by folder.
**Notes:** tenant-scoped; pagination via \`page\`/\`limit\`/\`sortBy\`/\`sortOrder\`; \`archived\` defaults to \`false\` (excludes archived).`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: SchemaDocumentListQuery,
  },
  responses: {
    200: {
      description: "Documents retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaPaginatedResponse(SchemaDocumentResponse),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
    ...httpResponseUnauthorized,
  },
});

// List shared documents route
export const listSharedDocumentsRoute = createRoute({
  method: "get",
  path: "/shared-with-me",
  operationId: "documentsListSharedWithMe",
  summary: "List documents shared with me",
  description: `Retrieves a paginated list of documents that have been shared with the current user (excludes owned documents).

**Behavior:** Same filters/pagination as the document list, but restricted to documents shared with the requesting user (\`shared\` scope).
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; only documents explicitly shared with the user are returned.
**Notes:** tenant-scoped; excludes documents owned by the current user.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: SchemaDocumentListQuery,
  },
  responses: {
    200: {
      description: "Shared documents retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaPaginatedResponse(SchemaDocumentResponse),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
    ...httpResponseUnauthorized,
  },
});

// Get document tree route
export const getDocumentTreeRoute = createRoute({
  method: "get",
  path: "/tree",
  operationId: "documentTreeGet",
  summary: "Get document tree",
  description: `Retrieves a hierarchical tree structure of all folders and documents the user has access to.

**Behavior:** Builds a recursive tree of folders and documents the user can access, starting from an optional root folder and bounded by \`maxDepth\`.
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; the tree only includes folders/documents the user owns or has been granted access to.
**Notes:** tenant-scoped; \`rootId\` null/empty means all root folders; \`maxDepth\` defaults to 10 and is capped at 20.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    query: z.object({
      rootId: z.string().nullish().transform((val) => val === undefined || val === null || val === "" ? null : val).openapi({
        description: "Root folder ID to start the tree from (null or empty for all root folders)",
        example: null,
      }),
      maxDepth: z.coerce.number().int().positive().max(20).default(10).optional().openapi({
        description: "Maximum depth to traverse the folder hierarchy (default: 10, max: 20)",
        example: 10,
      }),
    }),
  },
  responses: {
    200: {
      description: "Document tree retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentTreeResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
    ...httpResponseUnauthorized,
  },
});

// Get document create options route
export const getDocumentCreateOptionsRoute = createRoute({
  method: "get",
  path: "/create-options",
  operationId: "documentCreateOptionsGet",
  summary: "Get document create options",
  description: `Retrieves available options for document creation (folders, tags, shared users).

**Behavior:** Returns folders the user owns or has write access to, tags owned by the user, and users in the same environment that can be shared with. Used to populate create/upload forms.
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; results are scoped to the user and their environment.
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  responses: {
    200: {
      description: "Create options retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentCreateOptionsResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Get document by ID route
export const getDocumentRoute = createRoute({
  method: "get",
  path: "/{id}",
  operationId: "documentGet",
  summary: "Get document by ID",
  description: `Retrieves a single document by its ID with full detail.

**Behavior:** Returns the document plus its threaded comments, access logs, shared users, and public shares. The document's view count is incremented asynchronously off the response path.
**Auth:** cookie session or API key.
**Permissions:** document-level read access (owner, shared, or public); returns 403 otherwise and 404 if not found.
**Notes:** tenant-scoped; comment/access-log/shares fetches are tolerant — a failed sub-fetch yields an empty array rather than an error.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Document retrieved successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentDetailedResponse,
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Update document route
export const updateDocumentRoute = createRoute({
  method: "patch",
  path: "/{id}",
  operationId: "documentUpdate",
  summary: "Update document",
  description: `Updates document metadata.

**Behavior:** Updates name, description, folder, tags, and/or metadata. All user-supplied fields are run through security-threat validation before the write. The tags array replaces existing tags.
**Auth:** cookie session or API key.
**Permissions:** document-level write access; 404 if not found, 403 if write is not permitted.
**Notes:** tenant-scoped; name max 255 chars, description max 1000 chars.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentUpdateRequest),
  },
  responses: {
    200: {
      description: "Document updated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

// Delete document route
export const deleteDocumentRoute = createRoute({
  method: "delete",
  path: "/{id}",
  operationId: "documentDelete",
  summary: "Delete document",
  description: `Permanently deletes a document.

**Behavior:** Performs a hard delete — removes the document record and its associated storage. (Soft-deleted documents are restored via the \`restore\` endpoint.)
**Auth:** cookie session or API key.
**Permissions:** document-level delete/admin access; 404 if not found, 403 if delete is not permitted.
**Notes:** tenant-scoped; this operation is not reversible.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    204: {
      description: "Document deleted successfully",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Upload document route
export const uploadDocumentRoute = createRoute({
  method: "post",
  path: "/upload",
  operationId: "documentUpload",
  summary: "Upload document",
  description:
    `Uploads a new document file with encryption. Accepts multipart/form-data with a 'file' field and optional text fields (name, description, folderId, tags, metadata, sharedUsers, initialComment). The request body is parsed with a streaming multipart parser — body validation is handled by the handler, not by OpenAPI middleware.

**Behavior:** Streams and encrypts the file with the caller's data key, persisting a document record. The MIME type is verified from magic bytes (falling back to the filename extension) and rejected if unsupported. Optional \`sharedUsers\` are validated and granted access after upload; an optional \`initialComment\` is created post-upload (both best-effort).
**Auth:** cookie session or API key.
**Permissions:** none beyond auth; the caller becomes the document owner.
**Notes:** tenant-scoped; use the chunked-upload flow for large files. Security-threat scanning is applied to all text fields.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  // Note: request.body is intentionally omitted to prevent @hono/zod-openapi from
  // consuming the request body stream via formData() before the handler runs.
  // The handler uses ScopedMultipartParser for streaming multipart parsing.
  responses: {
    201: {
      description: "Document uploaded successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentResponse,
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseBadRequest,
    ...httpResponseContentTooLarge,
    ...httpResponseInternalServerError,
  },
});

// Download document route
export const downloadDocumentRoute = createRoute({
  method: "get",
  path: "/{id}/download",
  operationId: "documentDownload",
  summary: "Download document",
  description: `Downloads and decrypts a document file.

**Behavior:** Resolves the document's data key, decrypts the stored file, and streams the plaintext bytes via Hono's streaming API (compatible with XHR blob responses). Increments the download count.
**Auth:** cookie session or API key.
**Permissions:** document-level download access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped; timing-protected.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Document file stream",
      content: {
        "application/octet-stream": {
          schema: z.instanceof(Blob).openapi({ type: "string", format: "binary" }),
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Head download document route - returns headers without body for caching/preflight
export const headDownloadDocumentRoute = createRoute({
  method: "head",
  path: "/{id}/download",
  operationId: "documentDownloadHeaders",
  summary: "Check document download headers",
  description: `Returns headers for a document download without the body (for caching and preflight checks).

**Behavior:** Same access checks as GET \`/{id}/download\`, but returns only response headers (e.g. content type/length) without streaming the decrypted file. Useful for client caching and range/capability preflight.
**Auth:** cookie session or API key.
**Permissions:** document-level download access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped; no body in the response. Note: this route is currently defined but not registered on the documents app.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Document headers (no body)",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Preview document thumbnail route
export const previewDocumentRoute = createRoute({
  method: "get",
  path: "/{id}/preview",
  operationId: "documentPreview",
  summary: "Get document thumbnail preview",
  description: `Retrieves the thumbnail preview image for a document (requires download permission).

**Behavior:** Decrypts the document's stored thumbnail using the document data key and streams it as JPEG with caching headers and an ETag.
**Auth:** cookie session or API key.
**Permissions:** document-level download access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped; returns 404 when no thumbnail has been uploaded.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    200: {
      description: "Thumbnail image",
      content: {
        "image/jpeg": {
          schema: z.instanceof(Blob).openapi({ type: "string", format: "binary" }),
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Duplicate document route
export const duplicateDocumentRoute = createRoute({
  method: "post",
  path: "/{id}/duplicate",
  operationId: "documentDuplicate",
  summary: "Duplicate document",
  description: `Creates a copy of an existing document.

**Behavior:** Copies the source document's encrypted bytes into a new document owned by the caller, optionally overriding the name and/or destination folder.
**Auth:** cookie session or API key.
**Permissions:** document-level read access on the source; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped; the caller owns the new copy.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentDuplicateRequest),
  },
  responses: {
    201: {
      description: "Document duplicated successfully",
      content: {
        "application/json": {
          schema: SchemaDocumentResponse,
        },
      },
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Move document route
export const moveDocumentRoute = createRoute({
  method: "patch",
  path: "/{id}/move",
  operationId: "documentMove",
  summary: "Move document",
  description: `Moves a document to a different folder (or to root).

**Behavior:** Updates the document's folder. Pass \`targetFolderId: null\` to move the document to the root level. Single-document moves run synchronously.
**Auth:** cookie session or API key.
**Permissions:** document-level write access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped; the \`asyncMode\` flag is accepted but single moves are processed synchronously.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentMoveRequest),
  },
  responses: {
    204: {
      description: "Document moved successfully",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Archive document route
export const archiveDocumentRoute = createRoute({
  method: "patch",
  path: "/{id}/archive",
  operationId: "documentArchive",
  summary: "Archive document",
  description: `Archives or unarchives a document.

**Behavior:** When \`isArchived\` is true the document is archived; when false it is restored from the archived state.
**Auth:** cookie session or API key.
**Permissions:** document-level write access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
    ...withJsonBody(SchemaDocumentArchiveRequest),
  },
  responses: {
    204: {
      description: "Document archive status updated",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});

// Restore document route
export const restoreDocumentRoute = createRoute({
  method: "patch",
  path: "/{id}/restore",
  operationId: "documentRestore",
  summary: "Restore document",
  description: `Restores an archived document to the active set.

**Behavior:** Clears the archived flag (the inverse of the archive endpoint), making the document appear in default (non-archived) listings again.
**Auth:** cookie session or API key.
**Permissions:** document-level write access; 403 if not permitted, 404 if not found.
**Notes:** tenant-scoped.`,
  tags: [OpenAPITagsDocumentFeature.documents],
  request: {
    params: z.object({
      id: SCHEMA_DOCUMENT_ID,
    }),
  },
  responses: {
    204: {
      description: "Document restored successfully",
    },
    ...httpResponseForbidden,
    ...httpResponseNotFound,
  },
});
