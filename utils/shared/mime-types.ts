/**
 * @file utils/shared/mime-types.ts
 * @description MIME type utilities and mappings
 *
 * This module provides MIME type to file extension mappings
 * and utility functions for working with file types.
 *
 * MIME-knowledge split (see plans/refactor-review-log.md, Phase 9 · 9e): the
 * codebase keeps THREE purpose-specific MIME catalogs by design — they answer
 * different questions and were verified to NOT conflict on shared entries:
 *   • here      — MIME → canonical file extension (for storage-path naming)
 *   • file-types — supported-upload MIME list grouped by category (+ size limits)
 *   • magic-bytes — byte signature → MIME (for content sniffing)
 * They are composed at the call sites (e.g. document-upload cross-checks a
 * sniffed MIME against `isMimeTypeSupported`). Do not collapse them into one
 * table: the category list intentionally includes upload aliases
 * (`image/jpg`, `video/avi`, `audio/mp3`) that have no canonical extension,
 * and the extension map includes the `application/octet-stream` fallback absent
 * from the upload list — a single table would force nullable fields and lose the
 * clean "supported uploads" semantics.
 */

/**
 * MIME type to file extension mapping
 */
export const MIME_TO_EXTENSION: Record<string, string> = {
  // Documents
  "application/pdf": ".pdf",
  "application/msword": ".doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/vnd.ms-excel": ".xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": ".xlsx",
  "application/vnd.ms-powerpoint": ".ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": ".pptx",
  "text/plain": ".txt",
  "text/html": ".html",
  "text/css": ".css",
  "text/javascript": ".js",
  "application/json": ".json",
  "application/xml": ".xml",
  "text/xml": ".xml",
  "text/csv": ".csv",

  // Images
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/bmp": ".bmp",
  "image/tiff": ".tiff",
  "image/x-icon": ".ico",

  // Videos
  "video/mp4": ".mp4",
  "video/mpeg": ".mpeg",
  "video/quicktime": ".mov",
  "video/x-msvideo": ".avi",
  "video/x-matroska": ".mkv",
  "video/webm": ".webm",

  // Audio
  "audio/mpeg": ".mp3",
  "audio/wav": ".wav",
  "audio/ogg": ".ogg",
  "audio/mp4": ".m4a",
  "audio/webm": ".weba",
  "audio/aac": ".aac",
  "audio/flac": ".flac",

  // Archives
  "application/zip": ".zip",
  "application/x-rar-compressed": ".rar",
  "application/x-7z-compressed": ".7z",
  "application/x-tar": ".tar",
  "application/gzip": ".gz",

  // Other
  "application/octet-stream": ".bin",
};

/**
 * Gets the file extension for a MIME type
 *
 * @param mimeType - MIME type of the file
 * @returns File extension with leading dot (e.g., '.pdf', '.jpg'), or empty string if not found
 */
export function getExtensionFromMimeType(mimeType: string): string {
  return MIME_TO_EXTENSION[mimeType] || "";
}

/**
 * Gets the MIME type from a file extension
 *
 * @param extension - File extension (with or without leading dot)
 * @returns MIME type, or 'application/octet-stream' if not found
 */
export function getMimeTypeFromExtension(extension: string): string {
  // Normalize extension to have leading dot and lowercase
  const normalizedExt = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;

  // Find the MIME type by looking up the extension
  for (const [mimeType, ext] of Object.entries(MIME_TO_EXTENSION)) {
    if (ext === normalizedExt) {
      return mimeType;
    }
  }

  return "application/octet-stream";
}
