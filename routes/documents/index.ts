/**
 * @file routes/documents/index.ts
 * @description Barrel/Hono app wiring for documents routes
 */
import { createRateLimitedApp } from "@utils/openapi/openapi-wrapper.ts";

// Import document routes
import {
  archiveDocumentRoute,
  deleteDocumentRoute,
  downloadDocumentRoute,
  duplicateDocumentRoute,
  getDocumentCreateOptionsRoute,
  getDocumentRoute,
  getDocumentTreeRoute,
  listDocumentsRoute,
  listSharedDocumentsRoute,
  moveDocumentRoute,
  previewDocumentRoute,
  restoreDocumentRoute,
  updateDocumentRoute,
  uploadDocumentRoute,
} from "./documents.route.ts";

// Import thumbnail upload route
import { uploadDocumentThumbnailRoute } from "./thumbnail-upload.route.ts";

// Import bulk document operations
import { bulkArchiveRoute, bulkAssignTagsRoute, bulkDeleteRoute, bulkMoveRoute } from "./documents-bulk.route.ts";

import {
  abortChunkedUploadRoute,
  completeChunkedUploadRoute,
  getUploadStatusRoute,
  initiateChunkedUploadRoute,
  streamChunkedUploadRoute,
  uploadChunkRoute,
  uploadSessionThumbnailRoute,
} from "./chunked-upload.route.ts";

// Document handlers (all via the barrel)
import {
  abortChunkedUploadHandler,
  archiveDocumentHandler,
  bulkArchiveHandler,
  bulkAssignTagsHandler,
  bulkDeleteHandler,
  bulkMoveHandler,
  completeChunkedUploadHandler,
  deleteDocumentHandler,
  downloadDocumentHandler,
  duplicateDocumentHandler,
  getDocumentCreateOptionsHandler,
  getDocumentHandler,
  getDocumentTreeHandler,
  getUploadStatusHandler,
  initiateChunkedUploadHandler,
  listDocumentsHandler,
  listSharedDocumentsHandler,
  moveDocumentHandler,
  previewDocumentHandler,
  restoreDocumentHandler,
  streamChunkedUploadHandler,
  updateDocumentHandler,
  uploadChunkHandler,
  uploadDocumentHandler,
  uploadDocumentThumbnailHandler,
  uploadSessionThumbnailHandler,
} from "@handlers/documents/index.ts";

// Import sub-concern apps
import documentFoldersApp from "@routes/document-folders/index.ts";
import documentFoldersSharingApp from "@routes/document-folders-sharing/index.ts";
import documentsTagsApp from "@routes/documents-tags/index.ts";
import documentsMetadataSchemasApp from "@routes/documents-metadata-schemas/index.ts";
import documentsCommentsApp from "@routes/documents-comments/index.ts";
import documentsSharingApp from "@routes/documents-sharing/index.ts";
import documentsActivityLogsApp from "@routes/documents-activity-logs/index.ts";
import documentsOperationsApp from "@routes/documents-operations/index.ts";
import documentsStatsApp from "@routes/documents-stats/index.ts";
import documentsDuplicatesApp from "@routes/documents-duplicates/index.ts";

// Rate limit configurations
const STANDARD_RATE_LIMIT = {
  max: 100,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.3,
};

const BULK_RATE_LIMIT = {
  max: 10,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
};

const DOCUMENT_UPLOAD_RATE_LIMIT = {
  max: 99999,
  window: 60 * 1000, // 1 minute
  enableIPBasedAdjustment: true,
  suspiciousIPMultiplier: 0.2,
};

const documents = createRateLimitedApp();

// =====================================
// MAIN DOCUMENT APP ROUTE DEFINITIONS
// =====================================

// Most specific static routes first
documents.openapiWithRateLimit(listDocumentsRoute, listDocumentsHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(listSharedDocumentsRoute, listSharedDocumentsHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(uploadDocumentRoute, uploadDocumentHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(getDocumentTreeRoute, getDocumentTreeHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(getDocumentCreateOptionsRoute, getDocumentCreateOptionsHandler, STANDARD_RATE_LIMIT);

// Sub-mount apps with absolute path routes (stats, activity-logs, duplicates, operations)
documents.route("/", documentsStatsApp);
documents.route("/", documentsActivityLogsApp);
documents.route("/", documentsDuplicatesApp);
documents.route("/", documentsOperationsApp);

// Static-prefixed routes next
documents.openapiWithRateLimit(bulkDeleteRoute, bulkDeleteHandler, BULK_RATE_LIMIT);
documents.openapiWithRateLimit(bulkArchiveRoute, bulkArchiveHandler, BULK_RATE_LIMIT);
documents.openapiWithRateLimit(bulkMoveRoute, bulkMoveHandler, BULK_RATE_LIMIT);
documents.openapiWithRateLimit(bulkAssignTagsRoute, bulkAssignTagsHandler, BULK_RATE_LIMIT);

// Document chunked upload
documents.openapiWithRateLimit(initiateChunkedUploadRoute, initiateChunkedUploadHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(uploadChunkRoute, uploadChunkHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(getUploadStatusRoute, getUploadStatusHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(streamChunkedUploadRoute, streamChunkedUploadHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(uploadSessionThumbnailRoute, uploadSessionThumbnailHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(completeChunkedUploadRoute, completeChunkedUploadHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(abortChunkedUploadRoute, abortChunkedUploadHandler, DOCUMENT_UPLOAD_RATE_LIMIT);

// =====================================
// Mount sub-routers (relative path sub-concerns)
// =====================================
documents.route("/folders", documentFoldersApp);
documents.route("/folders", documentFoldersSharingApp);
documents.route("/tags", documentsTagsApp);
documents.route("/metadata-schemas", documentsMetadataSchemasApp);

// =====================================
// Dynamic /{id} routes
// =====================================

// Comment and sharing sub-mounts (routes use /{documentId}/... paths)
documents.route("/", documentsCommentsApp);
documents.route("/", documentsSharingApp);

// Specific dynamic action routes (e.g., /{id}/download)
documents.openapiWithRateLimit(downloadDocumentRoute, downloadDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(previewDocumentRoute, previewDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(uploadDocumentThumbnailRoute, uploadDocumentThumbnailHandler, DOCUMENT_UPLOAD_RATE_LIMIT);
documents.openapiWithRateLimit(duplicateDocumentRoute, duplicateDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(moveDocumentRoute, moveDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(archiveDocumentRoute, archiveDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(restoreDocumentRoute, restoreDocumentHandler, STANDARD_RATE_LIMIT);

// =====================================
// Generic /{id} routes
// =====================================
// These are the most generic and will catch anything that wasn't matched above.
documents.openapiWithRateLimit(getDocumentRoute, getDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(updateDocumentRoute, updateDocumentHandler, STANDARD_RATE_LIMIT);
documents.openapiWithRateLimit(deleteDocumentRoute, deleteDocumentHandler, STANDARD_RATE_LIMIT);

// Export main authenticated router
export default documents;
