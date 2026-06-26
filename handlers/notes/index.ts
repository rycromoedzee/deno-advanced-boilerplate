/**
 * @file handlers/notes/index.ts
 * @description Barrel for note handlers (mirrors routes/notes/).
 *
 * Route ↔ handler mirror:
 *   notes.handler.ts        ↔ notes.route.ts        (CRUD + versions)
 *   sharing.handler.ts      ↔ sharing.route.ts      (internal + public shares)
 *   tags-attach.handler.ts  ↔ tags-attach.route.ts  (note ↔ tag attach/detach/list)
 *   events.handler.ts       ↔ events.route.ts       (SSE stream — no responseSchema)
 */

export {
  archiveNoteHandler,
  createNoteHandler,
  deleteNoteHandler,
  getNoteHandler,
  getNoteVersionHandler,
  listNotesHandler,
  listNoteVersionsHandler,
  putNoteBodyHandler,
  restoreNoteHandler,
  updateNoteHandler,
} from "./notes.handler.ts";

export {
  createNotePublicShareHandler,
  disableNotePublicShareHandler,
  listNotePermissionsHandler,
  listSharesHandler,
  revokeNoteShareHandler,
  shareNoteHandler,
} from "./sharing.handler.ts";

export { attachNoteTagHandler, detachNoteTagHandler, listNoteTagsForNoteHandler } from "./tags-attach.handler.ts";

export { getNoteEventsStreamHandler } from "./events.handler.ts";
