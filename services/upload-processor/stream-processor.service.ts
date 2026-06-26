/**
 * @file services/upload-processor/stream-processor.service.ts
 * @description Core file processing service that does the heavy lifting for uploads
 *
 * This service is responsible for:
 * - Automatic detection of file type (video/audio/other)
 * - Metadata extraction from video/audio files (codecs, resolution, bitrate, duration, etc.)
 * - File size calculation (original and encrypted)
 * - Encryption using FileEncryptionService
 * - Upload to storage
 *
 * It returns all the extracted information for the calling service to persist to the database.
 * This separation allows document management services to focus on business logic
 * while this service handles file processing concerns.
 */

import { FileEncryptionService } from "@services/encryption/file-encryption.service.ts";
import { MediaStreamService } from "@services/media-stream/media-stream.service.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import type { IHashingContext } from "@utils/text/hashing.ts";
import { validateBinaryFile } from "@utils/shared/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { createHash } from "@deps";
import { traced } from "@services/tracing/index.ts";

export interface StreamProcessingResult {
  fileId: string;
  storagePath: string;
  encryptedDataKey: Uint8Array;
  originalFileSize: number;
  encryptedFileSize: number;
  contentHash: string; // SHA-256 hash of original file content (hex encoded)
  thumbnail?: {
    path: string;
    size: number;
    width: number;
    height: number;
  };
}

export interface ProcessStreamOptions {
  fileId: string;
  originalName: string;
  mimeType: string;
  userId: string;
  encryptionKey: Uint8Array;
  storagePath: string;
  hashingContext: string; // From HASHING_CONTEXTS constant
  environmentId: string;
  encryptionChunkSize?: number; // Optional chunk size for encryption
}

export class StreamProcessorService {
  /**
   * Process an uploaded file stream: extract metadata, encrypt, and store
   * This handles the complete pipeline for file uploads from the browser
   */
  static async processUploadStream(
    stream: ReadableStream,
    options: ProcessStreamOptions,
  ): Promise<StreamProcessingResult> {
    const processedStream = stream;

    // Note: We no longer load the entire file into memory for thumbnails
    // Thumbnails are generated from the file AFTER it's been uploaded to storage
    // This prevents memory issues with large files

    // Note: Video/audio metadata extraction has been removed
    // Metadata is already embedded in video containers and can be read by players

    let originalFileSize = 0;
    const hasher = createHash("sha256");

    const analysisStream = new TransformStream({
      transform(chunk, controller) {
        originalFileSize += chunk.byteLength;
        hasher.update(chunk);
        controller.enqueue(chunk);
      },
    });

    const analyzedStream = processedStream.pipeThrough(analysisStream);

    const encryptionResult = await traced(
      "StreamProcessorService.processUploadStream",
      "service",
      async (span) => {
        span.attributes["file.id"] = options.fileId;
        span.attributes["storage.path"] = options.storagePath;
        span.attributes["file.mime_type"] = options.mimeType;

        const result = await FileEncryptionService.encryptWithKey(
          options.encryptionKey,
          options.hashingContext as IHashingContext,
          analyzedStream,
          options.storagePath,
          options.encryptionChunkSize,
        );

        span.attributes["file.original_size"] = originalFileSize;
        span.attributes["file.encrypted_size"] = result.bytesWritten;
        return result;
      },
    );

    const contentHash = hasher.digest("hex");

    const encryptedFileSize = encryptionResult.bytesWritten;

    // Note: Thumbnail generation has been moved to a separate process
    // to avoid loading large files into memory during upload.
    // Thumbnails will be generated after upload is complete, if needed.
    let thumbnailInfo: StreamProcessingResult["thumbnail"] | undefined;

    return {
      fileId: options.fileId,
      storagePath: encryptionResult.storagePath,
      encryptedDataKey: encryptionResult.encryptedDataKey,
      originalFileSize,
      encryptedFileSize,
      contentHash,
      thumbnail: thumbnailInfo,
    };
  }

  /**
   * Process and store a complete file upload with database record creation
   */
  static async processAndStoreUpload(
    stream: ReadableStream,
    options: ProcessStreamOptions,
  ): Promise<string> {
    // Process the stream
    const result = await this.processUploadStream(stream, options);

    // Create database record
    const mediaMetadata = await MediaStreamService.createMediaMetadata({
      id: options.fileId,
      originalName: options.originalName,
      mimeType: options.mimeType,
      originalFileSize: result.originalFileSize,
      encryptedFileSize: result.encryptedFileSize,
      folderPath: result.storagePath,
      userId: options.userId,
      contentHash: result.contentHash, // For de-duplication
    });

    // Store the encrypted data key
    const { getDB: _getDB, tables: _tables } = await import("@db/db.ts");
    const db = await getTenantDB();

    await db.insert(tenantTables.documentsDataKeys).values({
      id: `${options.fileId}-key`,
      documentId: options.fileId,
      userId: options.userId,
      encryptedMasterKey: result.encryptedDataKey,
      encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
      permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      isActive: true,
      keyVersion: 1,
    });

    return mediaMetadata.id;
  }

  /**
   * Create a readable stream from a File object (for browser uploads)
   */
  static createStreamFromFile(file: File): ReadableStream {
    return file.stream();
  }

  /**
   * Create a readable stream from FormData file field
   */
  static createStreamFromFormData(formData: FormData, fieldName: string): ReadableStream | null {
    const file = formData.get(fieldName) as File;
    if (!file || !(file instanceof File)) {
      return null;
    }
    return file.stream();
  }

  /**
   * Validate file type and size before processing
   */
  static validateUpload(file: File, options: {
    maxSizeBytes?: number;
    allowedMimeTypes?: string[];
  } = {}): { valid: boolean; error?: string } {
    const { maxSizeBytes = 100 * 1024 * 1024, allowedMimeTypes } = options; // Default 100MB
    return validateBinaryFile(
      { size: file.size, mimeType: file.type, name: file.name },
      { maxFileSize: maxSizeBytes, allowedMimeTypes },
    );
  }
}
