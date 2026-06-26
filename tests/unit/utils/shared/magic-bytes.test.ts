import { assertEquals } from "@std/assert";
import { detectMimeTypeFromBytes } from "@utils/shared/magic-bytes.ts";

/**
 * Magic-byte (file signature) content sniffing.
 * Builds Uint8Arrays from known prefixes and asserts the detected MIME.
 */

function bytes(...vals: number[]): Uint8Array {
  return new Uint8Array(vals);
}

function strBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

Deno.test("detectMimeTypeFromBytes: PNG signature → image/png", () => {
  // \x89PNG\r\n\x1a\n
  assertEquals(detectMimeTypeFromBytes(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)), "image/png");
});

Deno.test("detectMimeTypeFromBytes: %PDF prefix → application/pdf", () => {
  const pdf = new Uint8Array([...strBytes("%PDF-1.4\n"), ...bytes(0x0a, 0x0b)]);
  assertEquals(detectMimeTypeFromBytes(pdf), "application/pdf");
});

Deno.test("detectMimeTypeFromBytes: JPEG (FF D8 FF) → image/jpeg", () => {
  assertEquals(detectMimeTypeFromBytes(bytes(0xff, 0xd8, 0xff, 0xe0)), "image/jpeg");
});

Deno.test("detectMimeTypeFromBytes: GIF ('GIF8') → image/gif", () => {
  assertEquals(detectMimeTypeFromBytes(strBytes("GIF89a")), "image/gif");
});

Deno.test("detectMimeTypeFromBytes: PK\x03\x04 → application/zip", () => {
  assertEquals(detectMimeTypeFromBytes(bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x00)), "application/zip");
});

Deno.test("detectMimeTypeFromBytes: gzip (1F 8B) → application/gzip", () => {
  assertEquals(detectMimeTypeFromBytes(bytes(0x1f, 0x8b, 0x08)), "application/gzip");
});

Deno.test("detectMimeTypeFromBytes: ID3 mp3 tag → audio/mpeg", () => {
  assertEquals(detectMimeTypeFromBytes(strBytes("ID3")), "audio/mpeg");
});

Deno.test("detectMimeTypeFromBytes: ftyp box at offset 4 → video/mp4", () => {
  // MP4: 4 size bytes, then 'ftyp'
  const mp4 = new Uint8Array([0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
  assertEquals(detectMimeTypeFromBytes(mp4), "video/mp4");
});

Deno.test("detectMimeTypeFromBytes: '<?xml' → application/xml", () => {
  assertEquals(detectMimeTypeFromBytes(strBytes('<?xml version="1.0"?>')), "application/xml");
});

Deno.test("detectMimeTypeFromBytes: returns null for empty input", () => {
  assertEquals(detectMimeTypeFromBytes(new Uint8Array(0)), null);
});

Deno.test("detectMimeTypeFromBytes: returns null for unrecognised bytes", () => {
  assertEquals(detectMimeTypeFromBytes(bytes(0x00, 0x00, 0x00, 0x00)), null);
  assertEquals(detectMimeTypeFromBytes(strBytes("hello world this is plain text")), null);
});

Deno.test("detectMimeTypeFromBytes: accepts a plain number[] too", () => {
  assertEquals(detectMimeTypeFromBytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png");
});
