/**
 * @file handlers/document-folders/index.ts
 * @description Barrel for document folder handlers (mirrors routes/document-folders/).
 *
 * folders.handler.ts ↔ folders.route.ts (CRUD)
 * folders-bulk.handler.ts ↔ folders-bulk.route.ts (bulk operations)
 * folder-settings.handler.ts ↔ folder-settings.route.ts (folder settings)
 */

export {
  archiveFolderHandler,
  createFolderHandler,
  deleteFolderHandler,
  duplicateFolderHandler,
  getFolderHandler,
  listFoldersHandler,
  listSharedFoldersHandler,
  moveFolderHandler,
  restoreFolderHandler,
  updateFolderHandler,
} from "./folders.handler.ts";

export { bulkArchiveFoldersHandler, bulkDeleteFoldersHandler, bulkMoveFoldersHandler } from "./folders-bulk.handler.ts";

export { getFolderSettingsHandler } from "./folder-settings.handler.ts";
