/**
 * @file handlers/notes-collections/index.ts
 * @description Barrel for note-collection handlers (mirrors routes/notes-collections/).
 *
 * Route ↔ handler mirror:
 *   notes-collections.handler.ts ↔ notes-collections.route.ts (CRUD + archive/restore)
 */

export {
  archiveCollectionHandler,
  createCollectionHandler,
  deleteCollectionHandler,
  getCollectionHandler,
  listCollectionsHandler,
  restoreCollectionHandler,
  updateCollectionHandler,
} from "./notes-collections.handler.ts";
