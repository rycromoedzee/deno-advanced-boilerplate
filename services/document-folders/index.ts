/**
 * @file services/document-folders/index.ts
 * @description Barrel export file for document-folders services
 */

// Export all service classes
export { DocumentFolderPermissionService } from "./folder-permission.service.ts";
export { DocumentFolderPermissionCacheService } from "./folder-permission-cache.service.ts";
export { FolderReadService } from "./folder-read.service.ts";
export { FolderWriteService } from "./folder-write.service.ts";
export { FolderArchiveService } from "./folder-archive.service.ts";
export { FolderDeleteService } from "./folder-delete.service.ts";
export { FolderDuplicateService } from "./folder-duplicate.service.ts";
export { FolderMoveService } from "./folder-move.service.ts";
export { FolderSettingsService } from "./folder-settings.service.ts";

// Export helper utilities
export { DocumentFolderCrudHelpers } from "./folder-crud.helpers.ts";

// Export singleton getters
export {
  getDocumentFolderPermissionService,
  getFolderArchiveService,
  getFolderDeleteService,
  getFolderDuplicateService,
  getFolderMoveService,
  getFolderReadService,
  getFolderSettingsService,
  getFolderWriteService,
} from "./singletons.ts";
