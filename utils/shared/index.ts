/**
 * @file utils/shared/index.ts
 * @description Barrel exports for shared utilities
 */
export * from "./constants.ts";

export type { RequestContext, ValidationResult } from "./types.ts";

export { constantTimeMultiCompare, ensureMinimumProcessingTime, safeEqual, TIMING_PROFILES } from "./timing.ts";
export type { TimingProfile } from "./timing.ts";

export { getTimeNow, getTimeNowForStorage } from "./time.ts";
export { convertToApiFormat, convertToStorageFormat, detectTimestampFormat, validateTimestamp } from "./timestamp-conversion.ts";

export { IP_CONSTANTS, SECURITY_ACTIONS, SECURITY_CONSTANTS, TEXT_CONSTANTS, THREAT_INTELLIGENCE_RISK_THRESHOLDS } from "./constants.ts";

export type { SecurityAction } from "./constants.ts";

export { getExtensionFromMimeType, getMimeTypeFromExtension, MIME_TO_EXTENSION } from "./mime-types.ts";

export { detectMimeTypeFromBytes } from "./magic-bytes.ts";

export { validateFileMetadata, validateFileSize, validateFileType, validateFileUpload } from "./file-validation.ts";
export type {
  FileSizeValidationResult,
  FileTypeValidationResult,
  FileValidationMetadata,
  FileValidationResult,
} from "./file-validation.ts";

export {
  ALL_SUPPORTED_MIME_TYPES,
  type BasicFileDescriptor,
  type BasicFileValidationOptions,
  type BasicFileValidationResult,
  determineContentType,
  determineFileCategory,
  FILE_SIZE_LIMITS,
  type FileCategory,
  getMimeTypesForCategory,
  getSizeLimitForCategory,
  getSizeLimitForMimeType,
  isMimeTypeSupported,
  MIME_TYPES_BY_CATEGORY,
  SUPPORTED_MEDIA_MIME_TYPES,
  supportsMetadataExtraction,
  validateBinaryFile,
} from "./file-types.ts";

export { fireAndForgetOperation } from "./async.ts";
export type { FireAndForgetOptions } from "./async.ts";

export { calculatePagination } from "./pagination.ts";
export type { PaginationCalculation } from "./pagination.ts";
