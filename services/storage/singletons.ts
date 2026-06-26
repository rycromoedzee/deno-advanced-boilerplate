/**
 * @file services/storage/singletons.ts
 * @description Singleton instance management for storage providers.
 *
 * Two memoized providers:
 * - `getStorage()` — the LIVE provider, from `envConfig.storage`.
 * - `getBackupStorage()` — the INDEPENDENT off-site destination for
 *   object-storage backup (DD5), from `envConfig.backupStorage`. Only
 *   constructed on first use (the object-backup job / restore tooling); its
 *   independence from the live provider is enforced at boot by the fail-closed
 *   preflight guard (`services/object-backup/preflight.ts`, DD7).
 *
 * `buildStorageProvider(config)` is the shared constructor switch both getters
 * delegate to. It is exported (and takes an explicit config) so the factory
 * logic is unit-testable without env vars or network access.
 */
import { envConfig } from "@config/env.ts";
import { BunnyStorage } from "./bunny.ts";
import { LocalStorage } from "./local.ts";
import { S3Storage } from "./s3.ts";
import type { IStorageProvider } from "@interfaces/storage.ts";
import type { StorageProviderConfig } from "./types.ts";

// Singleton instances
let storageInstance: IStorageProvider | null = null;
let backupStorageInstance: IStorageProvider | null = null;

/**
 * Construct a concrete provider from an explicit config. Throws on unknown
 * type; each provider validates its own required fields in its constructor.
 */
export function buildStorageProvider(config: StorageProviderConfig): IStorageProvider {
  try {
    switch (config.type) {
      case "bunny":
        return new BunnyStorage(config);
      case "local":
        return new LocalStorage(config);
      case "s3":
        return new S3Storage(config);
      default:
        throw new Error(
          `Unknown storage type: ${config.type}. Supported: bunny, local, s3`,
        );
    }
  } catch (e) {
    throw new Error(`Storage could not init \n ${e}`);
  }
}

/** Config for the live provider, derived from `envConfig.storage`. */
function liveStorageConfig(): StorageProviderConfig {
  return {
    type: envConfig.storage.type,
    region: envConfig.storage.region,
    name: envConfig.storage.name,
    key: envConfig.storage.key,
    secretKey: envConfig.storage.secretKey,
    endpoint: envConfig.storage.endpoint,
  };
}

/** Config for the independent backup destination, derived from `envConfig.backupStorage`. */
function backupStorageConfig(): StorageProviderConfig {
  return {
    type: envConfig.backupStorage.type,
    region: envConfig.backupStorage.region,
    name: envConfig.backupStorage.name,
    key: envConfig.backupStorage.key,
    secretKey: envConfig.backupStorage.secretKey,
    endpoint: envConfig.backupStorage.endpoint,
    localBaseDir: envConfig.backupStorage.localDir,
  };
}

/**
 * Get the singleton LIVE storage provider instance.
 * Creates the appropriate provider based on configuration.
 */
export function getStorage(): IStorageProvider {
  if (!storageInstance) {
    storageInstance = buildStorageProvider(liveStorageConfig());
  }
  return storageInstance;
}

/**
 * Get the singleton BACKUP destination provider instance (object-storage
 * backup, DD5). Built from `envConfig.backupStorage` — a different account/
 * provider than the live `getStorage()` (enforced at boot by the DD7 guard).
 */
export function getBackupStorage(): IStorageProvider {
  if (!backupStorageInstance) {
    backupStorageInstance = buildStorageProvider(backupStorageConfig());
  }
  return backupStorageInstance;
}
