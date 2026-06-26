/**
 * @file services/document-folders/singletons.ts
 * @description Lazy singletons for document folders services
 */
import { DocumentFolderPermissionService } from "./folder-permission.service.ts";
import { DocumentFolderPermissionCacheService } from "./folder-permission-cache.service.ts";
import { FolderReadService } from "./folder-read.service.ts";
import { FolderWriteService } from "./folder-write.service.ts";
import { FolderArchiveService } from "./folder-archive.service.ts";
import { FolderDeleteService } from "./folder-delete.service.ts";
import { FolderDuplicateService } from "./folder-duplicate.service.ts";
import { FolderMoveService } from "./folder-move.service.ts";
import { FolderSettingsService } from "./folder-settings.service.ts";

let documentFolderPermissionService: DocumentFolderPermissionService | null = null;
let documentFolderPermissionCacheService: DocumentFolderPermissionCacheService | null = null;
let folderReadService: FolderReadService;
let folderWriteService: FolderWriteService;
let folderArchiveService: FolderArchiveService;
let folderDeleteService: FolderDeleteService;
let folderDuplicateService: FolderDuplicateService;
let folderMoveService: FolderMoveService;
let folderSettingsService: FolderSettingsService;

/**
 * Gets the singleton instance of DocumentFolderPermissionCacheService
 * Initializes lazily - returns null if cache is not yet available.
 * Use initializeDocumentFolderPermissionCacheService() for async initialization.
 * @returns {DocumentFolderPermissionCacheService | null} The singleton instance or null if not initialized
 */
export function getDocumentFolderPermissionCacheService(): DocumentFolderPermissionCacheService | null {
  return documentFolderPermissionCacheService;
}

/**
 * Asynchronously initializes and gets the singleton instance of DocumentFolderPermissionCacheService.
 * This should be called at application startup or when the cache is first needed.
 * @returns {Promise<DocumentFolderPermissionCacheService>} The singleton instance
 * @throws {Error} If service initialization fails
 */
export async function initializeDocumentFolderPermissionCacheService(): Promise<DocumentFolderPermissionCacheService> {
  if (!documentFolderPermissionCacheService) {
    try {
      const { getCache } = await import("@services/cache/index.ts");
      const cache = await getCache();
      documentFolderPermissionCacheService = new DocumentFolderPermissionCacheService(cache);
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentFolderPermissionCacheService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentFolderPermissionCacheService;
}

/**
 * Gets the singleton instance of DocumentFolderPermissionService
 * The service will be created without cache if cache service is not yet initialized.
 * For optimal performance, call initializeDocumentFolderPermissionCacheService() first.
 * @returns {DocumentFolderPermissionService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getDocumentFolderPermissionService(): DocumentFolderPermissionService {
  if (!documentFolderPermissionService) {
    try {
      documentFolderPermissionService = new DocumentFolderPermissionService(
        documentFolderPermissionCacheService ?? undefined,
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize DocumentFolderPermissionService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return documentFolderPermissionService;
}

/**
 * Gets the singleton instance of FolderReadService
 * @returns {FolderReadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderReadService(): FolderReadService {
  if (!folderReadService) {
    try {
      folderReadService = new FolderReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderReadService;
}

/**
 * Gets the singleton instance of FolderWriteService
 * @returns {FolderWriteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderWriteService(): FolderWriteService {
  if (!folderWriteService) {
    try {
      folderWriteService = new FolderWriteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderWriteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderWriteService;
}

/**
 * Gets the singleton instance of FolderArchiveService
 * @returns {FolderArchiveService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderArchiveService(): FolderArchiveService {
  if (!folderArchiveService) {
    try {
      folderArchiveService = new FolderArchiveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderArchiveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderArchiveService;
}

/**
 * Gets the singleton instance of FolderDeleteService
 * @returns {FolderDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderDeleteService(): FolderDeleteService {
  if (!folderDeleteService) {
    try {
      folderDeleteService = new FolderDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderDeleteService;
}

/**
 * Gets the singleton instance of FolderDuplicateService
 * @returns {FolderDuplicateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderDuplicateService(): FolderDuplicateService {
  if (!folderDuplicateService) {
    try {
      folderDuplicateService = new FolderDuplicateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderDuplicateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderDuplicateService;
}

/**
 * Gets the singleton instance of FolderMoveService
 * @returns {FolderMoveService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderMoveService(): FolderMoveService {
  if (!folderMoveService) {
    try {
      folderMoveService = new FolderMoveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderMoveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderMoveService;
}

/**
 * Gets the singleton instance of FolderSettingsService
 * @returns {FolderSettingsService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getFolderSettingsService(): FolderSettingsService {
  if (!folderSettingsService) {
    try {
      folderSettingsService = new FolderSettingsService();
    } catch (error) {
      throw new Error(
        `Failed to initialize FolderSettingsService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return folderSettingsService;
}
