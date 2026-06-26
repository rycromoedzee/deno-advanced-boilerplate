/**
 * @file routes/notes-tags/notes-tags.route.ts
 * @description Notes Tags route definition
 */
import { createRoute, z } from "@deps";
import {
  SCHEMA_NOTE_TAG_ID,
  SchemaNoteTagApiResponse,
  SchemaNoteTagCreateRequest,
  SchemaNoteTagListQuery,
  SchemaNoteTagListResponse,
  SchemaNoteTagUpdateRequest,
} from "@models/notes/note-tag.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.tags];

const idParam = z.object({
  id: SCHEMA_NOTE_TAG_ID.openapi({ param: { name: "id", in: "path" } }),
});

export const listNoteTagsRoute = createRoute({
  method: "get",
  path: "/",
  summary: "List note tags",
  description: [
    "Lists note tags owned by the authenticated user.",
    "",
    "**Behavior:** Supports a name search (`q`), pagination (`page`/`limit`), and optional `sortBy`/`sortOrder`. Tags are owner-scoped.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; only the caller's own tags are returned.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagsList",
  tags,
  request: { query: SchemaNoteTagListQuery },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteTagListResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const createNoteTagRoute = createRoute({
  method: "post",
  path: "/",
  summary: "Create note tag",
  description: [
    "Creates a new note tag owned by the authenticated user.",
    "",
    "**Behavior:** Persists the tag with the supplied name and optional color.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagCreate",
  tags,
  request: { ...withJsonBody(SchemaNoteTagCreateRequest) },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: SchemaNoteTagApiResponse } } },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

export const getNoteTagRoute = createRoute({
  method: "get",
  path: "/{id}",
  summary: "Get note tag",
  description: [
    "Returns a single note tag by ID.",
    "",
    "**Behavior:** Returns 404 if the tag does not exist or is not owned by the caller.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagGet",
  tags,
  request: { params: idParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteTagApiResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const updateNoteTagRoute = createRoute({
  method: "patch",
  path: "/{id}",
  summary: "Update note tag",
  description: [
    "Partially updates a note tag's name or color.",
    "",
    "**Behavior:** Applies only the supplied fields.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagUpdate",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNoteTagUpdateRequest) },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteTagApiResponse } } },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseForbidden,
    ...httpResponseInternalServerError,
  },
});

export const deleteNoteTagRoute = createRoute({
  method: "delete",
  path: "/{id}",
  summary: "Delete note tag",
  description: [
    "Permanently deletes a note tag.",
    "",
    "**Behavior:** Removes the tag; notes previously using it are detached. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagDelete",
  tags,
  request: { params: idParam },
  responses: {
    204: { description: "No Content" },
    ...httpResponseUnauthorized,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
