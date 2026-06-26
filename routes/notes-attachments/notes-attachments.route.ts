/**
 * @file routes/notes-attachments/notes-attachments.route.ts
 * @description Notes Attachments route definition
 */
import { createRoute, z } from "@deps";
import {
  SCHEMA_NOTE_ATTACHMENT_ID,
  SchemaNoteAttachmentApiResponse,
  SchemaNoteAttachmentListResponse,
  SchemaNoteAttachmentStatsResponse,
  SchemaNoteAttachmentUploadRequest,
} from "@models/notes/note-attachment.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.attachments];

const idParam = z.object({
  id: SCHEMA_NOTE_ATTACHMENT_ID.openapi({ param: { name: "id", in: "path" } }),
});

const noteIdParam = z.object({
  noteId: z.string().min(1).openapi({ param: { name: "noteId", in: "path" } }),
});

export const listAllNoteAttachmentsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List all attachments for the user",
  description: [
    "Lists all attachments owned by the authenticated user across notes.",
    "",
    "**Behavior:** Returns attachment metadata (not bytes) for every attachment the caller owns.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; only the caller's own attachments are returned.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentsListAll",
  tags,
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteAttachmentListResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const uploadNoteAttachmentRoute = createRoute({
  method: "post",
  path: "/",
  summary: "Upload attachment (base64)",
  description: [
    "Uploads a base64-encoded attachment (ciphertext) and attaches it to a note.",
    "",
    "**Behavior:** Decodes the base64 bytes and resolves the caller's data master key to encrypt them (AES-GCM) before writing to object storage; returns the created attachment record. Use the multipart endpoint for large/binary uploads.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant on the target note; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentUpload",
  tags,
  request: { ...withJsonBody(SchemaNoteAttachmentUploadRequest) },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: SchemaNoteAttachmentApiResponse } } },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const uploadNoteAttachmentMultipartRoute = createRoute({
  method: "post",
  path: "/multipart",
  summary: "Upload attachment (multipart)",
  description: [
    "Form fields: `file` (File, required) and `noteId` (string, required). Allowed mime types: image/png, image/jpeg, image/gif, image/webp, image/svg+xml. Max size 25MB.",
    "",
    "**Behavior:** Parses the multipart form, resolves the caller's data master key to encrypt the file bytes, and stores the object; returns the attachment record (with a `url` for streaming). Validation runs in soft mode.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant on the target note; otherwise 403/404.",
    "**Notes:** rejects payloads over 25MB with 413 and unsupported MIME types with 415; tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentUploadMultipart",
  tags,
  request: {
    body: {
      required: true,
      content: {
        "multipart/form-data": {
          schema: z.object({
            noteId: z.string(),
            file: z.any(),
          }),
        },
      },
    },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: SchemaNoteAttachmentApiResponse } } },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    413: { description: "Payload too large" },
    415: { description: "Unsupported media type" },
    ...httpResponseInternalServerError,
  },
});

export const listNoteAttachmentsForNoteRoute = createRoute({
  method: "get",
  path: "/by-note/{noteId}",
  summary: "List attachments for a note",
  description: [
    "Lists the attachments attached to a single note.",
    "",
    "**Behavior:** Returns attachment metadata (not bytes) for the specified note.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant on the note; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentsList",
  tags,
  request: { params: noteIdParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteAttachmentListResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const getNoteAttachmentStatsRoute = createRoute({
  method: "get",
  path: "/stats",
  summary: "Get aggregate attachment stats",
  description: [
    "Returns aggregate attachment statistics (count and total bytes) for the authenticated user.",
    "",
    "**Behavior:** Buckets counts and byte totals into `active` (non-archived notes), `archived`, and `total`.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; stats cover only the caller's own attachments.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentStats",
  tags,
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteAttachmentStatsResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const getNoteAttachmentContentRoute = createRoute({
  method: "get",
  path: "/{id}/content",
  summary: "Stream attachment content",
  description: [
    "Streams the decrypted bytes of an attachment.",
    "",
    "**Behavior:** Resolves the caller's data master key to unwrap the per-attachment key and decrypt the storage object, then streams plaintext back with a `Content-Disposition: attachment` header. This is a raw stream handler with no JSON response schema.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant on the attachment's note; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentContentStream",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "OK (stream)" },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const deleteNoteAttachmentRoute = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "Delete attachment",
  description: [
    "Permanently deletes an attachment and its stored object.",
    "",
    "**Behavior:** Removes the attachment record and its encrypted object from storage. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (50 req/min).",
  ].join("\n"),
  operationId: "noteAttachmentDelete",
  tags,
  request: { params: idParam },
  responses: {
    204: { description: "No Content" },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
