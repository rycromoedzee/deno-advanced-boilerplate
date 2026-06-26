/**
 * @file tests/unit/services/object-backup/purge.test.ts
 * @description Tests for backup-side purge (Phase B/C, DD4/DD8) against a local
 * backup provider.
 *
 * Proves: purgeBackupObject is idempotent (absent key = success), and
 * purgeEnvironmentBackupSubtree drains an entire nested subtree — including
 * MORE than 1000 keys — by explicit per-key delete (the regression that
 * `deleteDirectory` fails: S3 silently caps at 1000 keys). No network, no DB.
 */
import { assertEquals, assertRejects } from "@std/assert";
import { buildStorageProvider } from "@services/storage/singletons.ts";
import { purgeBackupObject, purgeEnvironmentBackupSubtree } from "@services/object-backup/purge.ts";
import type { IStorageDownloadResult, IStorageFileEntry, IStorageProvider, IUploadResult } from "@interfaces/storage.ts";

Deno.test("purgeBackupObject: deletes an existing key; absent key is a no-op (idempotent)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const backup = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/b` });
    await backup.uploadFile("environment-storage/env/a.bin", new Uint8Array([1]));

    await purgeBackupObject("environment-storage/env/a.bin", { backup });
    assertEquals(await backup.listKeysRecursive("environment-storage/env"), []);

    // Already-gone + never-existed keys must NOT throw.
    await purgeBackupObject("environment-storage/env/a.bin", { backup });
    await purgeBackupObject("environment-storage/env/never.bin", { backup });
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("purgeEnvironmentBackupSubtree: drains a nested subtree (documents + notes)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const backup = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/b` });
    const prefix = "environment-storage/env1";
    await backup.uploadFile(`${prefix}/documents/d1.bin`, new Uint8Array([1]));
    await backup.uploadFile(`${prefix}/documents/sub/d2.bin`, new Uint8Array([2]));
    await backup.uploadFile(`${prefix}/notes/n1.png`, new Uint8Array([3]));

    await purgeEnvironmentBackupSubtree(prefix, { backup });

    assertEquals(await backup.listKeysRecursive(prefix), []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("purgeEnvironmentBackupSubtree: purges MORE than 1000 keys (regression vs deleteDirectory cap)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const backup = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/b` });
    const prefix = "environment-storage/envBig";
    const N = 1200; // > the S3 single-list cap of 1000 that deleteDirectory silently truncates at
    for (let i = 0; i < N; i++) {
      await backup.uploadFile(`${prefix}/documents/${i}.bin`, new Uint8Array([i % 256]));
    }

    await purgeEnvironmentBackupSubtree(prefix, { backup });

    assertEquals(await backup.listKeysRecursive(prefix), []);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("purgeEnvironmentBackupSubtree: empty prefix is a no-op", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const backup = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/b` });
    await purgeEnvironmentBackupSubtree("environment-storage/none", { backup }); // no throw
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

/** A fake backup provider whose listKeysRecursive always fails (a transient list error). */
class FailingListProvider implements IStorageProvider {
  async listFiles(): Promise<IStorageFileEntry[]> {
    return [];
  }
  async uploadFile(): Promise<IUploadResult> {
    return { bytesWritten: 0 };
  }
  async downloadFile(): Promise<IStorageDownloadResult> {
    return { stream: new ReadableStream<Uint8Array>(), status: 200 };
  }
  async getFileSize(): Promise<number> {
    return 0;
  }
  async deleteFile(): Promise<void> {}
  async deleteDirectory(): Promise<void> {}
  async listKeysRecursive(): Promise<string[]> {
    throw new Error("transient list failure (e.g. Bunny 502)");
  }
}

Deno.test("purgeEnvironmentBackupSubtree: a FAILED list throws (does not pass through as 'empty' and drop the row)", async () => {
  // Regression for the original Bunny bug: a provider that swallows list errors
  // returned [] -> purge returned success -> the purge row was dropped while
  // objects still existed (a retention hole). The contract must be: a failed
  // list THROWS so Phase C bumps attempts and leaves the row to retry.
  await assertRejects(
    () => purgeEnvironmentBackupSubtree("environment-storage/env1", { backup: new FailingListProvider() }),
    Error,
    "transient list failure",
  );
});
