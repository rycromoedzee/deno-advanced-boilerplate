import { assertEquals } from "@std/assert";
import { getExtensionFromMimeType, getMimeTypeFromExtension, MIME_TO_EXTENSION } from "@utils/shared/mime-types.ts";

/**
 * MIME → canonical file extension catalog (the storage-path-naming table).
 * Verified non-conflicting with the upload-category list and magic-bytes table
 * (see module header); here we test the lookup contract only.
 */

Deno.test("getExtensionFromMimeType: returns canonical extension with leading dot", () => {
  assertEquals(getExtensionFromMimeType("application/pdf"), ".pdf");
  assertEquals(getExtensionFromMimeType("image/png"), ".png");
  assertEquals(getExtensionFromMimeType("image/jpeg"), ".jpg");
  assertEquals(getExtensionFromMimeType("video/mp4"), ".mp4");
  assertEquals(getExtensionFromMimeType("application/zip"), ".zip");
  assertEquals(getExtensionFromMimeType("text/plain"), ".txt");
});

Deno.test("getExtensionFromMimeType: returns empty string for unknown MIME", () => {
  assertEquals(getExtensionFromMimeType("application/x-totally-made-up"), "");
  assertEquals(getExtensionFromMimeType(""), "");
});

Deno.test("getMimeTypeFromExtension: accepts extension with or without leading dot", () => {
  assertEquals(getMimeTypeFromExtension(".pdf"), "application/pdf");
  assertEquals(getMimeTypeFromExtension("pdf"), "application/pdf");
  assertEquals(getMimeTypeFromExtension(".JPG"), "image/jpeg"); // case-insensitive
  assertEquals(getMimeTypeFromExtension("PNG"), "image/png");
});

Deno.test("getMimeTypeFromExtension: returns octet-stream fallback for unknown extension", () => {
  assertEquals(getMimeTypeFromExtension(".zzz"), "application/octet-stream");
  assertEquals(getMimeTypeFromExtension("totallyunknown"), "application/octet-stream");
});

Deno.test("MIME round-trip: extension → MIME → extension is stable for canonical pairs", () => {
  const samples = ["application/pdf", "image/png", "image/jpeg", "video/mp4", "text/plain", "application/zip"];
  for (const mime of samples) {
    const ext = getExtensionFromMimeType(mime);
    const back = getMimeTypeFromExtension(ext);
    assertEquals(back, mime, `round-trip failed for ${mime}`);
  }
});

Deno.test("MIME_TO_EXTENSION: every value is a non-empty string starting with '.'", () => {
  for (const [mime, ext] of Object.entries(MIME_TO_EXTENSION)) {
    assertEquals(typeof ext, "string");
    assertTrue(ext.startsWith("."), `${mime} -> ${ext} should start with '.'`);
    assertTrue(ext.length > 1, `${mime} -> '${ext}' should be more than just a dot`);
  }
});

function assertTrue(value: unknown, message?: string): void {
  if (!value) throw new Error(message ?? `expected truthy, got ${String(value)}`);
}
