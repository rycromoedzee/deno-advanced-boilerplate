/**
 * @file services/notes-collections/index.ts
 * @description Main export file for notes-collections services
 */

// Service class exports
export { CollectionCreateService } from "./collection-create.service.ts";
export { CollectionReadService } from "./collection-read.service.ts";
export { CollectionUpdateService } from "./collection-update.service.ts";
export { CollectionDeleteService } from "./collection-delete.service.ts";
export { CollectionArchiveService } from "./collection-archive.service.ts";
export { CollectionSharingService } from "./collection-sharing.service.ts";
export { CollectionCrudHelpers } from "./collection-crud.helpers.ts";

// Singleton getters
export {
  getCollectionArchiveService,
  getCollectionCreateService,
  getCollectionDeleteService,
  getCollectionReadService,
  getCollectionSharingService,
  getCollectionUpdateService,
} from "./singletons.ts";
