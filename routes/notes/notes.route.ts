/**
 * @file routes/notes/notes.route.ts
 * @description Notes route definition
 */
import { createRoute, z } from "@deps";
import {
  SCHEMA_NOTE_ID,
  SchemaNoteApiResponse,
  SchemaNoteCreateRequest,
  SchemaNoteDetailApiResponse,
  SchemaNoteListApiResponse,
  SchemaNoteListQuery,
  SchemaNoteUpdateRequest,
} from "@models/notes/note.model.ts";
import {
  SchemaNotePutBodyRequest,
  SchemaNoteVersionApiResponse,
  SchemaNoteVersionDetailApiResponse,
} from "@models/notes/note-version.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.notes];
const versionTags = [OpenAPITagsNotesFeature.versions];

const idParam = z.object({
  id: SCHEMA_NOTE_ID.openapi({ param: { name: "id", in: "path" } }),
});

const idAndVersionParam = z.object({
  id: SCHEMA_NOTE_ID.openapi({ param: { name: "id", in: "path" } }),
  versionId: z.string().min(1).openapi({ param: { name: "versionId", in: "path" } }),
});

export const listNotesRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List notes",
  description: [
    "Returns a paginated list of notes owned by or shared with the authenticated user.",
    "",
    "**Behavior:** Supports filtering by collection, archive state, pinned state, and title substring (`q`); results are paginated with `page`/`limit`. List items are denormalized with owner name, collection name, and tags.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; callers only see notes they own or are shared on.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "notesList",
  tags,
  request: { query: SchemaNoteListQuery },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteListApiResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const createNoteRoute = createRoute({
  method: "post",
  path: "/",
  summary: "Create note",
  description: [
    "Creates a new note owned by the authenticated user and returns it.",
    "",
    "**Behavior:** Persists the note and initializes its per-note encryption material using the caller's data master key; the response includes the resolved owner name.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCreate",
  tags,
  request: { ...withJsonBody(SchemaNoteCreateRequest) },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: SchemaNoteApiResponse } },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseInternalServerError,
  },
});

export const getNoteRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "Get note",
  description: [
    "Returns the full detail of a single note, including its decrypted latest body version, tags, permissions, and public shares.",
    "",
    "**Behavior:** Resolves the caller's data master key to decrypt the latest version body server-side; returns 404 if the note does not exist or is not accessible.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteGet",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteDetailApiResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updateNoteRoute = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "Update note",
  description: [
    "Partially updates a note's metadata (title, collection, pinned state, metadata).",
    "",
    "**Behavior:** Applies only the supplied fields; body content is managed separately via `PUT /{id}/body`.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteUpdate",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNoteUpdateRequest) },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteApiResponse } } },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const archiveNoteRoute = createRoute({
  method: "patch",
  path: "/{id}/archive",
  summary: "Archive note",
  description: [
    "Soft-archives a note (sets `isArchived`, `archivedAt`) without deleting it.",
    "",
    "**Behavior:** Reversible via the restore endpoint; archived notes are excluded from default list results.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteArchive",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteApiResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const restoreNoteRoute = createRoute({
  method: "patch",
  path: "/{id}/restore",
  summary: "Restore note",
  description: [
    "Restores a previously archived note (clears `isArchived`/`archivedAt`).",
    "",
    "**Behavior:** Undoes archiving so the note reappears in default list results.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteRestore",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteApiResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const deleteNoteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "Hard-delete note",
  description: [
    "Permanently deletes a note and its associated data.",
    "",
    "**Behavior:** Hard-deletes the note; this is not a soft-delete and is not reversible.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required (shared users cannot delete); otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteDelete",
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

export const putNoteBodyRoute = createRoute({
  method: "put",
  path: "/{id}/body",
  summary: "Save note body",
  description: [
    "Saves the note body, creating a new version each call.",
    "",
    "**Behavior:** Resolves the caller's data master key to encrypt the supplied body server-side and creates an immutable version record; returns the new version. Editors typically debounce calls client-side.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** body capped at 100000 chars; tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteBodyPut",
  tags: versionTags,
  request: { params: idParam, ...withJsonBody(SchemaNotePutBodyRequest) },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteVersionApiResponse } },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const listNoteVersionsRoute = createRoute({
  method: "get",
  path: "/{id}/versions",
  summary: "List note versions",
  description: [
    "Returns the version history (metadata only) for a note.",
    "",
    "**Behavior:** Lists prior body versions ordered by creation time; bodies are not included (use the version detail endpoint).",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteVersionsList",
  tags: versionTags,
  request: { params: idParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: z.array(SchemaNoteVersionApiResponse) } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const getNoteVersionRoute = createRoute({
  method: "get",
  path: "/{id}/versions/{versionId}",
  summary: "Get note version detail",
  description: [
    "Returns a single version of a note, including its decrypted body.",
    "",
    "**Behavior:** Resolves the caller's data master key to decrypt the requested version's body server-side; returns 404 if the note/version does not exist or is not accessible.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteVersionGet",
  tags: versionTags,
  request: { params: idAndVersionParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteVersionDetailApiResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
