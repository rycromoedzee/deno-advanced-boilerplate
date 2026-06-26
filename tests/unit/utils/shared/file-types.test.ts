import { assert, assertEquals, assertFalse } from "@std/assert";
import {
  ALL_SUPPORTED_MIME_TYPES,
  determineContentType,
  determineFileCategory,
  FILE_SIZE_LIMITS,
  type FileCategory,
  getMimeTypesForCategory,
  getSizeLimitForMimeType,
  isMimeTypeSupported,
  MIME_TYPES_BY_CATEGORY,
  supportsMetadataExtraction,
  validateBinaryFile,
} from "@utils/shared/file-types.ts";

/**
 * Supported-upload MIME catalog grouped by category + size limits + helpers.
 * Distinct from mime-types.ts (canonical extension map) by design — see module header.
 */

Deno.test("determineFileCategory: categorises known document/image/video/audio/archive MIMEs", () => {
  assertEquals(determineFileCategory("application/pdf"), "document");
  assertEquals(determineFileCategory("image/png"), "image");
  assertEquals(determineFileCategory("video/mp4"), "video");
  assertEquals(determineFileCategory("audio/mpeg"), "audio");
  assertEquals(determineFileCategory("application/zip"), "archive");
});

Deno.test("determineFileCategory: includes the upload alias image/jpg as image", () => {
  // image/jpg is an alias present only in the upload list (no canonical extension).
  assertEquals(determineFileCategory("image/jpg"), "image");
});

Deno.test("determineFileCategory: falls back to prefix-based category then 'unknown'", () => {
  // Unknown image MIME still resolves to image via the image/ prefix fallback.
  assertEquals(determineFileCategory("image/avif"), "image");
  assertEquals(determineFileCategory("video/x-future-codec"), "video");
  assertEquals(determineFileCategory("audio/x-future"), "audio");
  assertEquals(determineFileCategory("application/x-totally-unknown"), "unknown");
  assertEquals(determineFileCategory(""), "unknown");
});

Deno.test("determineFileCategory: is case-insensitive and trims whitespace", () => {
  assertEquals(determineFileCategory("  APPLICATION/PDF  "), "document");
  assertEquals(determineFileCategory("IMAGE/PNG"), "image");
});

Deno.test("isMimeTypeSupported: true for catalogued types, false for unknown", () => {
  assertTrue(isMimeTypeSupported("application/pdf"));
  assertTrue(isMimeTypeSupported("image/jpg")); // alias
  assertFalse(isMimeTypeSupported("application/x-not-real"));
});

Deno.test("determineContentType: maps common MIMEs to display tokens", () => {
  assertEquals(determineContentType("application/pdf"), "pdf");
  assertEquals(determineContentType("image/png"), "image");
  assertEquals(determineContentType("video/mp4"), "video");
  assertEquals(determineContentType("audio/mpeg"), "audio");
  assertEquals(determineContentType("text/plain"), "text");
  assertEquals(determineContentType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"), "spreadsheet");
  // NOTE: text/csv hits the generic `text/` prefix branch BEFORE the spreadsheet
  // check, so it resolves to "text" (not "spreadsheet"). The OOXML spreadsheet
  // MIMEs (which contain "spreadsheet") are the ones that resolve to "spreadsheet".
  assertEquals(determineContentType("text/csv"), "text");
  assertEquals(determineContentType("application/vnd.openxmlformats-officedocument.presentationml.presentation"), "presentation");
  assertEquals(determineContentType("application/zip"), "archive");
  assertEquals(determineContentType("application/x-7z-compressed"), "archive");
  assertEquals(determineContentType("application/x-totally-made-up"), "other");
});

Deno.test("FILE_SIZE_LIMITS: absolute limit is the largest, every category <= absolute", () => {
  const absolute = FILE_SIZE_LIMITS.absolute;
  assert(absolute > 0);
  for (const cat of ["document", "image", "video", "audio", "archive"] as FileCategory[]) {
    const limit = FILE_SIZE_LIMITS[cat];
    assert(limit > 0, `${cat} limit should be positive`);
    assertTrue(limit <= absolute, `${cat} (${limit}) should not exceed absolute (${absolute})`);
  }
});

Deno.test("getSizeLimitForMimeType: uses the category limit, falls back to absolute for unknown", () => {
  const pdfLimit = getSizeLimitForMimeType("application/pdf");
  assertEquals(pdfLimit, FILE_SIZE_LIMITS.document);
  const unknownLimit = getSizeLimitForMimeType("application/x-made-up");
  assertEquals(unknownLimit, FILE_SIZE_LIMITS.absolute);
});

Deno.test("getMimeTypesForCategory: returns the catalogued list for a category", () => {
  const docs = getMimeTypesForCategory("document");
  assertTrue(docs.includes("application/pdf"));
  assertTrue(docs.includes("text/plain"));
  // Returns the SAME reference (no defensive copy per current impl).
  assertEquals(docs, MIME_TYPES_BY_CATEGORY.document);
});

Deno.test("ALL_SUPPORTED_MIME_TYPES: is the flattened union of all categories", () => {
  const expectedTotal = MIME_TYPES_BY_CATEGORY.document.length +
    MIME_TYPES_BY_CATEGORY.image.length +
    MIME_TYPES_BY_CATEGORY.video.length +
    MIME_TYPES_BY_CATEGORY.audio.length +
    MIME_TYPES_BY_CATEGORY.archive.length;
  assertEquals(ALL_SUPPORTED_MIME_TYPES.length, expectedTotal);
});

Deno.test("supportsMetadataExtraction: true for video/* and audio/*, false otherwise", () => {
  assertTrue(supportsMetadataExtraction("video/mp4"));
  assertTrue(supportsMetadataExtraction("audio/mpeg"));
  assertFalse(supportsMetadataExtraction("application/pdf"));
  assertFalse(supportsMetadataExtraction("image/png"));
});

Deno.test("validateBinaryFile: passes when under size and MIME is allowed", () => {
  const result = validateBinaryFile({ size: 1000, mimeType: "image/png" }, { allowedMimeTypes: ["image/png"] });
  assertEquals(result.valid, true);
  assertEquals(result.error, undefined);
});

Deno.test("validateBinaryFile: fails when size exceeds maxFileSize", () => {
  const result = validateBinaryFile({ size: 2000, mimeType: "image/png" }, { maxFileSize: 1000 });
  assertEquals(result.valid, false);
  assert(result.error !== undefined && result.error.includes("exceeds"));
});

Deno.test("validateBinaryFile: fails when MIME is not in the allow-list (case-insensitive)", () => {
  const result = validateBinaryFile(
    { size: 10, mimeType: "IMAGE/PNG" },
    { allowedMimeTypes: ["image/jpeg"] },
  );
  assertEquals(result.valid, false);
  assert(result.error !== undefined && result.error.includes("not allowed"));
});

Deno.test("validateBinaryFile: defaults to absolute size limit when no maxFileSize given", () => {
  const tiny = validateBinaryFile({ size: 1, mimeType: "image/png" });
  assertEquals(tiny.valid, true);
  const tooBig = validateBinaryFile({ size: FILE_SIZE_LIMITS.absolute + 1, mimeType: "image/png" });
  assertEquals(tooBig.valid, false);
});

function assertTrue(value: unknown, message?: string): void {
  assert(value, message ?? `expected truthy, got ${String(value)}`);
}
