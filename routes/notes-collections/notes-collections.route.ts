/**
 * @file routes/notes-collections/notes-collections.route.ts
 * @description Notes Collections route definition
 */
import { createRoute, z } from "@deps";
import {
  SCHEMA_COLLECTION_ID,
  SchemaNoteCollectionApiResponse,
  SchemaNoteCollectionCreateRequest,
  SchemaNoteCollectionListQuery,
  SchemaNoteCollectionUpdateRequest,
} from "@models/notes/note-collection.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.collections];

const idParam = z.object({
  id: SCHEMA_COLLECTION_ID.openapi({ param: { name: "id", in: "path" } }),
});

export const listCollectionsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List note collections",
  description: [
    "Lists note collections owned by the authenticated user.",
    "",
    "**Behavior:** Supports an `archived` filter (`true`/`false`/`all`, default `false`); returns collections the caller owns.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; only the caller's own collections are returned.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionsList",
  tags,
  request: { query: SchemaNoteCollectionListQuery },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: z.array(SchemaNoteCollectionApiResponse) } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const createCollectionRoute = createRoute({
  method: "post",
  path: "/",
  summary: "Create note collection",
  description: [
    "Creates a new note collection owned by the authenticated user.",
    "",
    "**Behavior:** Persists the collection with the supplied name, optional description/icon/color, metadata, and `autoShareNewContent` flag.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionCreate",
  tags,
  request: { ...withJsonBody(SchemaNoteCollectionCreateRequest) },
  responses: {
    201: {
      description: "Created",
      content: { "application/json": { schema: SchemaNoteCollectionApiResponse } },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const getCollectionRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "Get note collection",
  description: [
    "Returns a single note collection by ID.",
    "",
    "**Behavior:** Returns 404 if the collection does not exist or is not owned by the caller.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionGet",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteCollectionApiResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updateCollectionRoute = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "Update note collection",
  description: [
    "Partially updates a note collection's name, description, icon, color, or metadata.",
    "",
    "**Behavior:** Applies only the supplied fields.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionUpdate",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNoteCollectionUpdateRequest) },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteCollectionApiResponse } },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const archiveCollectionRoute = createRoute({
  method: "patch",
  path: "/{id}/archive",
  summary: "Archive note collection",
  description: [
    "Soft-archives a note collection.",
    "",
    "**Behavior:** Sets the collection's archived state; reversible via the restore endpoint.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionArchive",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteCollectionApiResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const restoreCollectionRoute = createRoute({
  method: "patch",
  path: "/{id}/restore",
  summary: "Restore note collection",
  description: [
    "Restores a previously archived note collection.",
    "",
    "**Behavior:** Clears the collection's archived state.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionRestore",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteCollectionApiResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const deleteCollectionRoute = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "Hard-delete note collection",
  description: [
    "Permanently deletes a note collection.",
    "",
    "**Behavior:** Hard-deletes the collection; this is not reversible. Notes inside the collection are unassigned, not deleted.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteCollectionDelete",
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
