/**
 * @file routes/notes-public/notes-public.route.ts
 * @description Notes Public route definition
 */
import { createRoute, z } from "@deps";
import { httpResponseBadRequest, httpResponseNotFound } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

const tags = [OpenAPITagsNotesFeature.publicAccess];

export const SchemaPublicNoteResponse = z.object({
  noteId: z.string().openapi({ description: "ID of the shared note", example: "clx4k2j3h0000pq3x7b9v4r2y" }),
  title: z.string().openapi({ description: "Note title", example: "Q3 launch checklist" }),
  permissionLevel: z.string().openapi({ description: "Permission level granted by the share", example: "read" }),
  isPasswordProtected: z.boolean().openapi({ description: "Whether the share is password-protected", example: false }),
  latestVersion: z.object({
    id: z.string().openapi({ description: "Version ID", example: "clx4k2j3v0000pq3x7b9v4r2v" }),
    body: z.string().openapi({ description: "Decrypted latest body", example: "# Heading\nShared note body…" }),
    createdAt: z.number().openapi({ description: "Unix-ms creation timestamp", example: 1716422400000 }),
  }).nullable().openapi({ description: "Latest decrypted body version, or null" }),
}).openapi("PublicNoteResponse");

export const accessPublicNoteRoute = createRoute({
  method: "get",
  path: "/",
  summary: "Access a publicly-shared note",
  description: [
    "Returns the decrypted body of a publicly-shared note, given the share id and the secret `shareKey` (and the password, for protected shares).",
    "",
    "**Behavior:** The `shareId` encodes the tenant `environmentId` (used to route to the tenant DB, since this endpoint runs without an auth context). The `shareKey` is the secret half of the URL — clients keep it in the URL fragment and forward it explicitly here; the server uses it to unwrap the per-note master key and decrypt the latest body server-side. For password-protected shares a wrong/missing password surfaces as 401 so the client can prompt and retry; an invalid/expired share or wrong `shareKey`/password combination surfaces as 404 (deliberately indistinguishable to avoid leaking which secret was wrong).",
    "**Auth:** public — no session required.",
    "**Permissions:** none; access is gated solely by possession of the (unguessable) share token plus the secret share key (and password, if set).",
    "**Notes:** E2EE/zero-knowledge — the server stores the per-note key wrapped with the share key and never logs the raw share key; tenant is derived from the share id; rate-limited (100 req/min).",
  ].join("\n"),
  operationId: "notesPublicGet",
  security: [],
  tags,
  request: {
    query: z.object({
      shareId: z.string().trim().min(1),
      // The shareKey is the secret half of the URL — frontends keep it in the
      // URL fragment and forward it explicitly on the access call. Required
      // for server-side body decryption (zero-knowledge).
      shareKey: z.string().trim().min(1),
      password: z.string().trim().nullable().optional(),
    }),
  },
  responses: {
    200: {
      description: "OK",
      content: { "application/json": { schema: SchemaPublicNoteResponse } },
    },
    ...httpResponseBadRequest,
    401: {
      description:
        "Password required or invalid for a password-protected public share. Frontends should re-prompt the user for the password and retry with the `password` query param set.",
      content: {
        "application/json": {
          schema: z.object({
            message: z.string(),
            messageKey: z.string(),
            statusCode: z.number().openapi({ example: 401 }),
          }),
        },
      },
    },
    ...httpResponseNotFound,
  },
});
