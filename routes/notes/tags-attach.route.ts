/**
 * @file routes/notes/tags-attach.route.ts
 * @description Tags Attach route definition
 */
import { createRoute, z } from "@deps";
import { SCHEMA_NOTE_ID } from "@models/notes/note.model.ts";
import { SCHEMA_NOTE_TAG_ID, SchemaNoteTagsForNoteResponse } from "@models/notes/note-tag.model.ts";
import {
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.tags];

const noteIdParam = z.object({
  id: SCHEMA_NOTE_ID.openapi({ param: { name: "id", in: "path" } }),
});

const noteIdAndTagIdParam = z.object({
  id: SCHEMA_NOTE_ID.openapi({ param: { name: "id", in: "path" } }),
  tagId: SCHEMA_NOTE_TAG_ID.openapi({ param: { name: "tagId", in: "path" } }),
});

export const listNoteTagsForNoteRoute = createRoute({
  method: "get",
  path: "/{id}/tags",
  summary: "List tags attached to a note",
  description: [
    "Returns the tags attached to a note.",
    "",
    "**Behavior:** Returns only tags visible to the caller (ownership or existing share).",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagsForNoteList",
  tags,
  request: { params: noteIdParam },
  responses: {
    200: { description: "OK", content: { "application/json": { schema: SchemaNoteTagsForNoteResponse } } },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const attachNoteTagRoute = createRoute({
  method: "post",
  path: "/{id}/tags/{tagId}",
  summary: "Attach a tag to a note",
  description: [
    "Attaches an existing tag to a note.",
    "",
    "**Behavior:** Idempotently links the tag to the note. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagsAttach",
  tags,
  request: { params: noteIdAndTagIdParam },
  responses: {
    204: { description: "No Content" },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const detachNoteTagRoute = createRoute({
  method: "delete",
  path: "/{id}/tags/{tagId}",
  summary: "Detach a tag from a note",
  description: [
    "Removes a tag from a note.",
    "",
    "**Behavior:** Unlinks the tag from the note. Returns 204 on success (idempotent).",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or write-level share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteTagsDetach",
  tags,
  request: { params: noteIdAndTagIdParam },
  responses: {
    204: { description: "No Content" },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});
