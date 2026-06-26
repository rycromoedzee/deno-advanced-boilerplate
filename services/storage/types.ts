/**
 * @file services/storage/types.ts
 * @description Shared types for storage services
 */
// Re-export interfaces from centralized location
import type { IStorageDownloadResult, IStorageFileEntry, IStorageProvider } from "@interfaces/storage.ts";

export type { IStorageDownloadResult, IStorageFileEntry, IStorageProvider, IUploadResult } from "@interfaces/storage.ts";

// Legacy exports for backward compatibility
export type DownloadResult = IStorageDownloadResult;
export type StorageProvider = IStorageProvider;
export type FileEntry = IStorageFileEntry;

/**
 * Concrete config used to construct a storage provider instance.
 *
 * Both the live provider (`getStorage()`, from `envConfig.storage`) and the
 * independent off-site backup destination (`getBackupStorage()`, from
 * `envConfig.backupStorage`) are built from this same shape — this is what
 * unlocks a *second* provider with different credentials without touching any
 * call site (DD5). Providers only read the fields relevant to their backend;
 * `buildStorageProvider` switches on `type`.
 */
export interface StorageProviderConfig {
  /** Backend selector: `"bunny"` | `"s3"` | `"local"`. */
  type: string;
  /** Bunny region (e.g. `"NewYork"`) or S3 region. */
  region?: string;
  /** Bunny storage-zone name OR S3 bucket name. */
  name?: string;
  /** Bunny access key OR AWS access key id. */
  key?: string;
  /** AWS secret access key (S3 only; unused by Bunny/local). */
  secretKey?: string;
  /** S3-compatible endpoint URL (S3 only). */
  endpoint?: string;
  /** Base directory for the `local` backend (local only). Defaults to `./.data`. */
  localBaseDir?: string;
}
