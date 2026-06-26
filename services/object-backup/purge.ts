/**
 * @file services/object-backup/purge.ts
 * @description Backup-side deletion helpers (Phase B/C — the additive-copy counterpart).
 *
 * - `purgeBackupObject(key)`: delete one key from the backup destination,
 *   IDEMPOTENTLY — `deleteFile` throws `MEDIA.FILE_NOT_FOUND` on an absent
 *   object (all three providers), so a tombstone for a key that was never
 *   backed up (or already purged) resolves as success.
 * - `purgeEnvironmentBackupSubtree(prefix)`: drain a destroyed tenant's whole
 *   backup subtree by enumerating keys with `listKeysRecursive` and
 *   `deleteFile`-ing each explicitly — NEVER `deleteDirectory` (S3 silently
 *   caps at 1000 keys; Bunny/Local swallow errors). Re-lists to confirm empty;
 *   a non-empty re-list throws so the purge row is retried.
 *
 * `deps` is an optional injection seam (for tests); production omits it.
 */
import { getBackupStorage } from "@services/storage/singletons.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import type { IStorageProvider } from "@interfaces/storage.ts";

export interface PurgeDeps {
  backup?: IStorageProvider;
}

export async function purgeBackupObject(key: string, deps?: PurgeDeps): Promise<void> {
  const backup = deps?.backup ?? getBackupStorage();
  try {
    await backup.deleteFile(key);
  } catch (err) {
    // Absent on the destination is a successful purge (e.g. the object was
    // deleted before it was ever backed up). deleteFile maps a missing object
    // to MEDIA.FILE_NOT_FOUND (404) across all three providers — treat any 404
    // as "already gone" and surface only real errors.
    if (err instanceof AppHttpException && err.status === 404) return;
    throw err;
  }
}

export async function purgeEnvironmentBackupSubtree(prefix: string, deps?: PurgeDeps): Promise<void> {
  const backup = deps?.backup ?? getBackupStorage();
  const keys = await backup.listKeysRecursive(prefix);
  if (keys.length === 0) return; // already clean
  for (const key of keys) {
    await purgeBackupObject(key, { backup }); // idempotent; reuse injected backup
  }
  const remaining = await backup.listKeysRecursive(prefix);
  if (remaining.length > 0) {
    throw new Error(`purge incomplete: ${remaining.length} key(s) remain under ${prefix}`);
  }
}
