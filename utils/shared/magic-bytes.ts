/**
 * @file utils/shared/magic-bytes.ts
 * @description Magic bytes (file signature) detection for MIME type identification
 *
 * Detects file types by reading the first few bytes of a file/buffer
 * and matching against known file signatures (magic numbers).
 */

/**
 * Map of magic byte patterns to MIME types.
 * Each entry is a tuple of [bytePattern, offset, mimeType].
 * offset is the byte position where the pattern starts (usually 0).
 */
const MAGIC_BYTE_PATTERNS: Array<{ pattern: number[]; offset: number; mime: string }> = [
  // Images
  { pattern: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], offset: 0, mime: "image/png" },
  { pattern: [0xff, 0xd8, 0xff], offset: 0, mime: "image/jpeg" },
  { pattern: [0x47, 0x49, 0x46, 0x38], offset: 0, mime: "image/gif" },
  { pattern: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "image/webp" }, // RIFF header, could be webp
  { pattern: [0x42, 0x4d], offset: 0, mime: "image/bmp" },
  { pattern: [0x00, 0x00, 0x01, 0x00], offset: 0, mime: "image/x-icon" },
  { pattern: [0x25, 0x50, 0x44, 0x46], offset: 0, mime: "application/pdf" },

  // Documents
  { pattern: [0x50, 0x4b, 0x03, 0x04], offset: 0, mime: "application/zip" }, // Also xlsx, docx, pptx
  { pattern: [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], offset: 0, mime: "application/msword" },

  // Archives
  { pattern: [0x50, 0x4b, 0x05, 0x06], offset: 0, mime: "application/zip" },
  { pattern: [0x1f, 0x8b], offset: 0, mime: "application/gzip" },
  { pattern: [0x52, 0x61, 0x72, 0x21], offset: 0, mime: "application/x-rar-compressed" },
  { pattern: [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c], offset: 0, mime: "application/x-7z-compressed" },

  // Video
  { pattern: [0x66, 0x74, 0x79, 0x70], offset: 4, mime: "video/mp4" }, // ftyp at offset 4
  { pattern: [0x1a, 0x45, 0xdf, 0xa3], offset: 0, mime: "video/webm" },

  // Audio
  { pattern: [0x49, 0x44, 0x33], offset: 0, mime: "audio/mpeg" }, // ID3 tag
  { pattern: [0xff, 0xfb], offset: 0, mime: "audio/mpeg" },
  { pattern: [0x52, 0x49, 0x46, 0x46], offset: 0, mime: "audio/wav" }, // RIFF header (also used by webp)

  // Text (not really detectable via magic bytes, but common patterns)
  { pattern: [0x7b], offset: 0, mime: "application/json" }, // Starts with {
  { pattern: [0x3c, 0x3f, 0x78, 0x6d, 0x6c], offset: 0, mime: "application/xml" }, // <?xml
];

/**
 * Detect the MIME type of a file from its initial bytes (magic bytes).
 *
 * @param bytes - The first bytes of the file (Uint8Array or number[])
 * @returns The detected MIME type, or null if not recognized
 */
export function detectMimeTypeFromBytes(bytes: Uint8Array | number[]): string | null {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);

  if (data.length === 0) {
    return null;
  }

  for (const { pattern, offset, mime } of MAGIC_BYTE_PATTERNS) {
    if (data.length < offset + pattern.length) {
      continue;
    }

    let match = true;
    for (let i = 0; i < pattern.length; i++) {
      if (data[offset + i] !== pattern[i]) {
        match = false;
        break;
      }
    }

    if (match) {
      return mime;
    }
  }

  return null;
}
