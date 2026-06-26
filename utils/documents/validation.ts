/**
 * @file utils/documents/validation.ts
 * @description Re-exports document file-type/size validation helpers.
 *
 * Note: the previous module-top-level `getDB()` call and the folder-hierarchy
 * helpers (`validateFolderDepth`, `calculateFolderDepth`, `detectCircularReference`)
 * and `sanitizeStoragePath` were removed — they had zero callers and the top-level
 * DB instantiation ran at import time for code nobody invoked.
 */

export { validateFileSize, validateFileType, validateFileUpload } from "@utils/shared/file-validation.ts";
export type { FileSizeValidationResult, FileTypeValidationResult } from "@utils/shared/file-validation.ts";
