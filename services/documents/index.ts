/**
 * @file services/documents/index.ts
 * @description Core document CRUD service exports
 */

// Core CRUD service classes
export { DocumentReadService } from "./document-read.service.ts";
export { DocumentWriteService } from "./document-write.service.ts";
export { DocumentDeleteService } from "./document-delete.service.ts";
export { DocumentDuplicateService } from "./document-duplicate.service.ts";
export { DocumentUploadService } from "./document-upload.service.ts";
export { DocumentDownloadService } from "./document-download.service.ts";
export { DocumentCreateOptionsService } from "./document-create-options.service.ts";

// Core CRUD singleton getters
export {
  getDocumentCreateOptionsService,
  getDocumentDeleteService,
  getDocumentDownloadService,
  getDocumentDuplicateService,
  getDocumentReadService,
  getDocumentUploadService,
  getDocumentWriteService,
} from "./singletons.ts";

// Re-export folder services from document-folders
export {
  DocumentFolderCrudHelpers,
  DocumentFolderPermissionService,
  FolderArchiveService,
  FolderDeleteService,
  FolderDuplicateService,
  FolderMoveService,
  FolderReadService,
  FolderWriteService,
  getDocumentFolderPermissionService,
  getFolderArchiveService,
  getFolderDeleteService,
  getFolderDuplicateService,
  getFolderMoveService,
  getFolderReadService,
  getFolderWriteService,
} from "@services/document-folders/index.ts";
