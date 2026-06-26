/**
 * @file services/notes-collections/singletons.ts
 * @description Lazy singletons for notes collections services
 */
import { CollectionCreateService } from "./collection-create.service.ts";
import { CollectionReadService } from "./collection-read.service.ts";
import { CollectionUpdateService } from "./collection-update.service.ts";
import { CollectionDeleteService } from "./collection-delete.service.ts";
import { CollectionArchiveService } from "./collection-archive.service.ts";
import { CollectionSharingService } from "./collection-sharing.service.ts";

let collectionCreateService: CollectionCreateService;
let collectionReadService: CollectionReadService;
let collectionUpdateService: CollectionUpdateService;
let collectionDeleteService: CollectionDeleteService;
let collectionArchiveService: CollectionArchiveService;
let collectionSharingService: CollectionSharingService;

/**
 * Gets the singleton instance of CollectionCreateService
 * @returns {CollectionCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionCreateService(): CollectionCreateService {
  if (!collectionCreateService) {
    try {
      collectionCreateService = new CollectionCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionCreateService;
}

/**
 * Gets the singleton instance of CollectionReadService
 * @returns {CollectionReadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionReadService(): CollectionReadService {
  if (!collectionReadService) {
    try {
      collectionReadService = new CollectionReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionReadService;
}

/**
 * Gets the singleton instance of CollectionUpdateService
 * @returns {CollectionUpdateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionUpdateService(): CollectionUpdateService {
  if (!collectionUpdateService) {
    try {
      collectionUpdateService = new CollectionUpdateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionUpdateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionUpdateService;
}

/**
 * Gets the singleton instance of CollectionDeleteService
 * @returns {CollectionDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionDeleteService(): CollectionDeleteService {
  if (!collectionDeleteService) {
    try {
      collectionDeleteService = new CollectionDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionDeleteService;
}

/**
 * Gets the singleton instance of CollectionArchiveService
 * @returns {CollectionArchiveService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionArchiveService(): CollectionArchiveService {
  if (!collectionArchiveService) {
    try {
      collectionArchiveService = new CollectionArchiveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionArchiveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionArchiveService;
}

/**
 * Gets the singleton instance of CollectionSharingService
 * @returns {CollectionSharingService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getCollectionSharingService(): CollectionSharingService {
  if (!collectionSharingService) {
    try {
      collectionSharingService = new CollectionSharingService();
    } catch (error) {
      throw new Error(
        `Failed to initialize CollectionSharingService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return collectionSharingService;
}
