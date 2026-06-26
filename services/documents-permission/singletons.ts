/**
 * @file services/documents-permission/singletons.ts
 * @description Lazy singletons for documents permission services
 */
import { DocumentPermissionService } from "./document-permission.service.ts";
import { DocumentPermissionInheritanceService } from "./permission-inheritance.service.ts";

let documentPermissionServiceInstance: DocumentPermissionService | null = null;
let documentPermissionInheritanceServiceInstance: DocumentPermissionInheritanceService | null = null;

export function getDocumentPermissionService(): DocumentPermissionService {
  if (!documentPermissionServiceInstance) {
    try {
      documentPermissionServiceInstance = new DocumentPermissionService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentPermissionService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentPermissionServiceInstance;
}

export function getDocumentPermissionInheritanceService(): DocumentPermissionInheritanceService {
  if (!documentPermissionInheritanceServiceInstance) {
    try {
      documentPermissionInheritanceServiceInstance = new DocumentPermissionInheritanceService();
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentPermissionInheritanceService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentPermissionInheritanceServiceInstance;
}
