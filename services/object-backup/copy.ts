/**
 * @file services/object-backup/copy.ts
 * @description Copy one object from the live provider to the backup destination (DD3).
 *
 * `copyObject(srcKey)` = `getStorage().downloadFile(srcKey)` →
 * `getBackupStorage().uploadFile(srcKey, stream)`. The upload is UNCONDITIONAL
 * — there is deliberately NO pre-existence probe: `getFileSize` THROWS
 * `MEDIA.FILE_NOT_FOUND` on an absent object across all three providers, so a
 * "head/size check" would throw on the very first un-backed object (the normal
 * case). The `backedUpAt` flag (catalog.ts) is the source of truth that
 * prevents redundant cross-run work; `uploadFile` is overwrite-safe, and a
 * crash between upload and mark simply re-uploads the same key safely.
 *
 * The source key is preserved verbatim on the destination — object keys are
 * already tenant-namespaced by `environmentId` (`environment-storage/<envId>/…`),
 * so no extra namespacing is needed and a shared backup bucket stays isolated.
 *
 * `deps` is an optional injection seam so the copy can be tested with two
 * local providers; production omits it and uses the singletons.
 */
import { getBackupStorage, getStorage } from "@services/storage/singletons.ts";
import type { IStorageProvider } from "@interfaces/storage.ts";

/** Optional provider injection (for tests); defaults to the live/backup singletons. */
export interface CopyObjectDeps {
  source?: IStorageProvider;
  dest?: IStorageProvider;
}

/**
 * Copy one object from the live provider to the independent backup destination.
 * Returns bytes copied. Throws on download/upload failure — the caller wraps
 * each row in try/catch so one failure does not abort the tenant.
 */
export async function copyObject(srcKey: string, deps?: CopyObjectDeps): Promise<number> {
  const source = deps?.source ?? getStorage();
  const dest = deps?.dest ?? getBackupStorage();
  const downloaded = await source.downloadFile(srcKey);
  const result = await dest.uploadFile(srcKey, downloaded.stream);
  return result.bytesWritten;
}
