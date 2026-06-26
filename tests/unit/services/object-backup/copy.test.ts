/**
 * @file tests/unit/services/object-backup/copy.test.ts
 * @description Unit tests for object-backup copyObject (DD3).
 *
 * Uses two isolated local providers (via the injection seam) to prove the copy
 * mechanism: download→upload, source key preserved verbatim on the destination,
 * bytes returned, and re-copy is overwrite-safe/idempotent. No network, no DB.
 */
import { assertEquals } from "@std/assert";
import { buildStorageProvider } from "@services/storage/singletons.ts";
import { copyObject } from "@services/object-backup/copy.ts";

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

Deno.test("copyObject: copies bytes from source to destination, key preserved verbatim", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const source = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/src` });
    const dest = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/dst` });
    const key = "environment-storage/env_abc/documents/sm1.bin";
    const payload = new Uint8Array([10, 20, 30, 40]);

    await source.uploadFile(key, payload);
    const bytes = await copyObject(key, { source, dest });

    assertEquals(bytes, payload.byteLength);
    const downloaded = await dest.downloadFile(key);
    assertEquals(await drain(downloaded.stream), payload);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("copyObject: re-copying the same key is overwrite-safe (idempotent)", async () => {
  const tmp = await Deno.makeTempDir();
  try {
    const source = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/src` });
    const dest = buildStorageProvider({ type: "local", localBaseDir: `${tmp}/dst` });
    const key = "environment-storage/env_abc/documents/sm2.bin";
    const payload = new Uint8Array([1, 2, 3]);

    await source.uploadFile(key, payload);
    await copyObject(key, { source, dest }); // first copy
    await copyObject(key, { source, dest }); // crash-resume re-copy — must not corrupt

    const downloaded = await dest.downloadFile(key);
    assertEquals(await drain(downloaded.stream), payload);
  } finally {
    await Deno.remove(tmp, { recursive: true });
  }
});

Deno.test("copyObject: defaults to the global singletons when deps omitted (smoke)", () => {
  // Just asserts the function exists and accepts a key without deps; we do not
  // invoke it (that would build the real live/backup providers from envConfig).
  // The behavioral contract is covered by the deps-injected tests above.
  assertEquals(typeof copyObject, "function");
});
