/**
 * @file services/documents-permission/index.ts
 * @description Re-exports for document permission services
 */

export { DocumentPermissionService } from "./document-permission.service.ts";
export { DocumentPermissionInheritanceService } from "./permission-inheritance.service.ts";

export { getDocumentPermissionInheritanceService, getDocumentPermissionService } from "./singletons.ts";
