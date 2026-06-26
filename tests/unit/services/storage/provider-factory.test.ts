/**
 * @file tests/unit/services/storage/provider-factory.test.ts
 * @description Unit tests for the storage provider config-arg refactor (DD5).
 *
 * Proves the actual Slice 1 change: a provider can now be built from an
 * explicit StorageProviderConfig (independent of envConfig.storage), and for
 * the local backend each instance owns its own base directory — so the live
 * provider and the backup destination never share storage. No network, no DB.
 */
import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { buildStorageProvider } from "@services/storage/singletons.ts";

/** Drain a download stream into a Uint8Array. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test("buildStorageProvider: local round-trips upload/download/delete against the configured base dir", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const provider = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/store` });
    const key = "environment-storage/env-1/documents/abc.bin";
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);

    await provider.uploadFile(key, payload);
    const downloaded = await provider.downloadFile(key);
    assertEquals(await drain(downloaded.stream), payload);

    await provider.deleteFile(key);
    // After delete the object is gone — downloadFile throws MEDIA.FILE_NOT_FOUND.
    await assertRejects(() => provider.downloadFile(key));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildStorageProvider: per-instance local base dirs are isolated (backup dir != live dir)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const live = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/live` });
    const backup = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/backup` });

    // An object written to the live dir is NOT visible in the backup dir.
    await live.uploadFile("docs/a.bin", new Uint8Array([9]));
    await assertRejects(() => backup.downloadFile("docs/a.bin"));

    // And vice-versa — the two instances do not share state.
    await backup.uploadFile("docs/b.bin", new Uint8Array([8]));
    await assertRejects(() => live.downloadFile("docs/b.bin"));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildStorageProvider: local honors a nested key path (creates parent dirs)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const provider = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/store` });
    const key = "environment-storage/env-42/documents/sub/deep/file.bin";
    const payload = new Uint8Array([42]);
    await provider.uploadFile(key, payload);
    const downloaded = await provider.downloadFile(key);
    assertEquals(await drain(downloaded.stream), payload);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("buildStorageProvider: throws on unknown type", () => {
  assertThrows(
    () => buildStorageProvider({ type: "ftp" }),
    Error,
    "Unknown storage type",
  );
});

Deno.test("buildStorageProvider: local rejects a path-traversal key", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const provider = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/store` });
    await assertRejects(() => provider.uploadFile("../escape.bin", new Uint8Array([1])));
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});
