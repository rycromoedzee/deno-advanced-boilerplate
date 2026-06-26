/**
 * @file routes/notes/events.route.ts
 * @description Events route definition
 */
import { createRoute, z } from "@deps";
import { httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { OpenAPITagsNotesFeature } from "@utils/openapi/tags.ts";

/**
 * SSE stream of note mutation events scoped to the authenticated user.
 * Optional `noteId` filter pins delivery to a single note.
 */
export const getNoteEventsStreamRoute = createRoute({
  method: "get",
  path: "/events",
  summary: "Stream note events (SSE)",
  description: [
    "Establishes a Server-Sent Events connection delivering real-time mutation events (note.updated, note.archived, note.restored, note.deleted, note.shared, note.body.put) for the authenticated user.",
    "",
    "**Behavior:** Initializes pub/sub then streams events scoped to the caller; an optional `noteId` filter pins delivery to a single note. Rejects with 429 if the user already holds the per-user max of 3 concurrent note SSE connections. The connection is long-lived and intentionally not wrapped in the standard rate limiter.",
    "**Auth:** cookie session or API key (inherits the locked default).",
    "**Permissions:** none beyond auth; events are filtered to the caller's own notes/shares server-side.",
    "**Notes:** tenant-scoped via `environmentId`.",
  ].join("\n"),
  operationId: "noteEventsStream",
  tags: [OpenAPITagsNotesFeature.events],
  request: {
    query: z.object({
      noteId: z.string().optional(),
    }).partial(),
  },
  responses: {
    200: {
      description: "SSE stream established",
      content: {
        "text/event-stream": {
          schema: {
            type: "string",
            description: "Server-Sent Events stream with note mutation events",
          },
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});
