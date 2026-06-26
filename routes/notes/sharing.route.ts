/**
 * @file routes/notes/sharing.route.ts
 * @description Sharing route definition
 */
import { createRoute, z } from "@deps";
import { SCHEMA_NOTE_ID } from "@models/notes/note.model.ts";
import {
  SchemaNotePermissionsListResponse,
  SchemaNotePublicShareRequest,
  SchemaNotePublicShareResponse,
  SchemaNoteShareListQuery,
  SchemaNoteShareListResponse,
  SchemaNoteShareRequest,
  SchemaNoteShareRevokeRequest,
} from "@models/notes/note-sharing.model.ts";
import {
  httpResponseBadRequest,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseNotFound,
  httpResponseUnauthorized,
  withJsonBody,
} from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.sharing];

export const listSharesRoute = createRoute({
  method: "get",
  path: "/shares",
  summary: "List shares created by the user",
  description: [
    "Lists all shares (internal and/or public) created by the authenticated user.",
    "",
    "**Behavior:** Aggregates internal user-shares and public link-shares owned by the caller; the `type` query selects `all`, `internal`, or `public`. Items are normalized with internal and public fields populated per type.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; only shares created by the caller are returned.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteSharesList",
  tags,
  request: {
    query: SchemaNoteShareListQuery,
  },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNoteShareListResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

const idParam = z.object({
  id: SCHEMA_NOTE_ID.openapi({ param: { name: "id", in: "path" } }),
});

export const shareNoteRoute = createRoute({
  method: "post",
  path: "/{id}/share",
  summary: "Share note with another user",
  description: [
    "Grants an internal user access to a note at the given permission level.",
    "",
    "**Behavior:** Creates or updates an internal share grant for the target user. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required (only the note owner may share); otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteShareCreate",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNoteShareRequest) },
  responses: {
    204: { description: "No Content" },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const revokeNoteShareRoute = createRoute({
  method: "delete",
  path: "/{id}/share",
  summary: "Revoke a user's note access",
  description: [
    "Revokes an internal user's access to a note.",
    "",
    "**Behavior:** Removes the target user's share grant. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required (only the note owner may revoke); otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteShareRevoke",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNoteShareRevokeRequest) },
  responses: {
    204: { description: "No Content" },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const listNotePermissionsRoute = createRoute({
  method: "get",
  path: "/{id}/permissions",
  summary: "List users with note access",
  description: [
    "Lists the internal users who have explicit access to a note, with their profiles and permission levels.",
    "",
    "**Behavior:** Returns shared users with denormalized profile data for display.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership or an existing share grant; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "notePermissionsList",
  tags,
  request: { params: idParam },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNotePermissionsListResponse } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const createNotePublicShareRoute = createRoute({
  method: "post",
  path: "/{id}/public-share",
  summary: "Create public share link for note",
  description: [
    "Creates (or refreshes) a public share link for a note, optionally password-protected and/or expiring.",
    "",
    "**Behavior:** Resolves the caller's data master key to re-wrap the per-note key with a generated `shareKey` (zero-knowledge: the server cannot read the note body without the fragment-held key). Returns the share token/key pair. The `shareKey` is the secret half and must live in the URL fragment on the client.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** E2EE/zero-knowledge — the server only stores the key wrapped with the share key; tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteSharePublicCreate",
  tags,
  request: { params: idParam, ...withJsonBody(SchemaNotePublicShareRequest) },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaNotePublicShareResponse } },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseNotFound,
    ...httpResponseInternalServerError,
  },
});

export const disableNotePublicShareRoute = createRoute({
  method: "delete",
  path: "/{id}/public-share",
  summary: "Disable public sharing for note",
  description: [
    "Disables the active public share link for a note.",
    "",
    "**Behavior:** Deactivates the public share so the link no longer grants access. Returns 204 on success.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** ownership required; otherwise 403/404.",
    "**Notes:** tenant-scoped via `environmentId`; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "noteSharePublicDisable",
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
