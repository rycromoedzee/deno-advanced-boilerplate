/**
 * @file handlers/documents-sharing/index.ts
 * @description Barrel for document sharing handlers (mirrors routes/documents-sharing/).
 *
 * Divergence note (rule 7): routes/documents-sharing/ has a single
 * documents-sharing.route.ts, but the handlers are split across two aspect
 * files: documents-sharing.handler.ts (internal share / permissions / access
 * logs) and public-share.handler.ts (public-share create/disable, revoke,
 * update permission, public access registration).
 *
 * Note: registerDocumentPublicAccess and accessPublicDocumentHandler are also
 * consumed by routes/documents-public/ via this barrel.
 */

export { getDocumentAccessLogsHandler, listDocumentPermissionsHandler, shareDocumentHandler } from "./documents-sharing.handler.ts";

export {
  accessPublicDocumentHandler,
  createPublicDocumentShareHandler,
  disablePublicDocumentShareHandler,
  registerDocumentPublicAccess,
  revokeDocumentAccessHandler,
  updateDocumentPermissionHandler,
} from "./public-share.handler.ts";
