/**
 * @file services/upload-processor/upload.service.ts
 * @description Utility service providing upload validation and helper functions
 *
 * NOTE: For full document uploads with tags, permissions, and access control,
 * use DocumentUploadService instead. This is a lightweight utility for validation.
 */

import {
  determineFileCategory,
  FILE_SIZE_LIMITS,
  getSizeLimitForCategory,
  SUPPORTED_MEDIA_MIME_TYPES,
  supportsMetadataExtraction as sharedSupportsMetadataExtraction,
  validateBinaryFile,
} from "@utils/shared/index.ts";

export interface UploadOptions {
  userId: string;
  encryptionKey: Uint8Array;
  maxFileSize?: number;
  allowedMimeTypes?: string[];
  extractMetadata?: boolean;
}

export interface UploadResult {
  fileId: string;
  originalName: string;
  mimeType: string;
  originalFileSize: number;
  encryptedFileSize: number;
  storagePath: string;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * UploadService - Utility class for upload validation and helpers
 *
 * For full document management (tags, permissions, folders), use DocumentUploadService
 * This service provides lightweight validation utilities for the upload-processor module
 */
export class UploadService {
  /**
   * Validate a file before upload
   */
  static validateFile(file: File, options: UploadOptions): ValidationResult {
    const { maxFileSize = 500 * 1024 * 1024, allowedMimeTypes } = options; // Default 500MB

    return validateBinaryFile(
      { size: file.size, mimeType: file.type, name: file.name },
      { maxFileSize, allowedMimeTypes },
    );
  }

  /**
   * Get supported media types
   */
  static getSupportedMediaTypes(): string[] {
    return Array.from(SUPPORTED_MEDIA_MIME_TYPES);
  }

  /**
   * Check if a MIME type is supported for metadata extraction
   */
  static supportsMetadataExtraction(mimeType: string): boolean {
    return sharedSupportsMetadataExtraction(mimeType);
  }

  /**
   * Get recommended upload settings based on file type
   */
  static getRecommendedSettings(mimeType: string): {
    maxFileSize: number;
    extractMetadata: boolean;
    description: string;
  } {
    const category = determineFileCategory(mimeType);

    if (category === "video") {
      const limit = getSizeLimitForCategory("video");
      return {
        maxFileSize: limit,
        extractMetadata: true,
        description: "Video file with metadata extraction",
      };
    } else if (category === "audio") {
      const limit = getSizeLimitForCategory("audio");
      return {
        maxFileSize: limit,
        extractMetadata: true,
        description: "Audio file with metadata extraction",
      };
    } else {
      return {
        maxFileSize: FILE_SIZE_LIMITS.document,
        extractMetadata: false,
        description: "General file upload",
      };
    }
  }
}
