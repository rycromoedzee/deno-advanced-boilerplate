/**
 * @file handlers/notes-tags/index.ts
 * @description Barrel for note-tag handlers (mirrors routes/notes-tags/).
 *
 * Route ↔ handler mirror:
 *   notes-tags.handler.ts ↔ notes-tags.route.ts (tag CRUD)
 */

export {
  createNoteTagHandler,
  deleteNoteTagHandler,
  getNoteTagHandler,
  listNoteTagsHandler,
  updateNoteTagHandler,
} from "./notes-tags.handler.ts";
