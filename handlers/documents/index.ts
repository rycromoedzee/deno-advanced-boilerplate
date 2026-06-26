/**
 * @file handlers/documents/index.ts
 * @description Barrel for document handlers (mirrors routes/documents/).
 *
 * Route ↔ handler mirror:
 *   documents.handler.ts          ↔ documents.route.ts        (CRUD + tree)
 *   documents-bulk.handler.ts     ↔ documents-bulk.route.ts   (bulk ops)
 *   chunked-upload.handler.ts     ↔ chunked-upload.route.ts   (chunked upload)
 *   thumbnail-upload.handler.ts   ↔ thumbnail-upload.route.ts (thumbnail upload)
 *
 * Aspect handlers backing routes inside documents.route.ts (kept split because
 * each is a distinct transfer/concern — rule 7 divergence):
 *   document-upload.handler.ts          (multipart upload)
 *   document-download.handler.ts        (download stream)
 *   document-preview.handler.ts         (preview stream)
 *   document-create-options.handler.ts  (create-options metadata)
 */

export {
  archiveDocumentHandler,
  deleteDocumentHandler,
  duplicateDocumentHandler,
  getDocumentHandler,
  getDocumentTreeHandler,
  listDocumentsHandler,
  listSharedDocumentsHandler,
  moveDocumentHandler,
  restoreDocumentHandler,
  updateDocumentHandler,
} from "./documents.handler.ts";

export { bulkArchiveHandler, bulkAssignTagsHandler, bulkDeleteHandler, bulkMoveHandler } from "./documents-bulk.handler.ts";

export {
  abortChunkedUploadHandler,
  completeChunkedUploadHandler,
  getUploadStatusHandler,
  initiateChunkedUploadHandler,
  streamChunkedUploadHandler,
  uploadChunkHandler,
  uploadSessionThumbnailHandler,
} from "./chunked-upload.handler.ts";

export { uploadDocumentThumbnailHandler } from "./thumbnail-upload.handler.ts";

export { uploadDocumentHandler } from "./document-upload.handler.ts";
export { downloadDocumentHandler } from "./document-download.handler.ts";
export { previewDocumentHandler } from "./document-preview.handler.ts";
export { getDocumentCreateOptionsHandler } from "./document-create-options.handler.ts";
