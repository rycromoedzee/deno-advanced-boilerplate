/**
 * @file services/storage/index.ts
 * @description Barrel exports for storage services
 */
// Re-export types
export type { IStorageDownloadResult, IStorageFileEntry, IStorageProvider } from "@interfaces/storage.ts";

// Legacy type exports for backward compatibility
export type { DownloadResult, FileEntry, StorageProvider } from "./types.ts";
// Provider-construction config (shared by getStorage + getBackupStorage)
export type { StorageProviderConfig } from "./types.ts";

// Re-export storage providers
export { BunnyStorage } from "./bunny.ts";
export { LocalStorage } from "./local.ts";
export { S3Storage } from "./s3.ts";

// Export singleton getters + shared factory
export { buildStorageProvider, getBackupStorage, getStorage } from "./singletons.ts";
