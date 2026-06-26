/**
 * @file handlers/document-folders-sharing/index.ts
 * @description Barrel for document folder sharing handlers (mirrors routes/document-folders-sharing/)
 */

export {
  createPublicShareHandler,
  disablePublicShareHandler,
  getFolderAccessLogsHandler,
  listFolderPermissionsHandler,
  revokeUserAccessHandler,
  shareFolderHandler,
  updateUserPermissionHandler,
} from "./document-folders-sharing.handler.ts";
