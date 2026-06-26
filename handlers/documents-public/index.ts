/**
 * @file handlers/documents-public/index.ts
 * @description Barrel for public (unauthenticated) document access handlers.
 *
 * Divergence note (rule 7): routes/documents-public/ has a single
 * documents-public.route.ts, but the handlers are split into download and
 * stream aspect files because each implements a distinct transfer mode.
 *
 * Note: accessPublicDocumentHandler and registerDocumentPublicAccess live in
 * handlers/documents-sharing/ (they are document-sharing concerns) and are
 * re-exported from that dir's barrel.
 */

export { downloadPublicDocumentHandler } from "./download-public-document.handler.ts";
export { listPublicFolderDocumentsHandler } from "./list-public-folder-documents.handler.ts";
export { streamPublicDocumentHandler } from "./stream-public-document.handler.ts";
