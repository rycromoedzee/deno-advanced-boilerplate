/**
 * @file services/encryption/file-encryption.service.ts
 * @description Service for encrypting and storing files with streaming to avoid RAM overload
 * Handles file streams directly with encryption and storage in the same operation
 * Includes media streaming optimizations for video/audio content
 */

import { EncryptionValidationHelper } from "./encryption-validation.helper.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { IHashingContext } from "@utils/text/hashing.ts";
import { DataEncryptionHelperService } from "./data-encryption.helper.ts";
import { getStorage } from "../storage/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { calculateChunkRange, isValidRange } from "@utils/streaming/chunk-range-calculator.ts";
import { CHUNKED_UPLOAD_CONFIG } from "@constants/documents/chunked-upload.ts";

/**
 * Result interface for file encryption operations
 */
export interface FileEncryptionResult {
  storagePath: string;
  encryptedDataKey: Uint8Array;
  bytesWritten: number;
}

/**
 * Service for encrypting and storing files with streaming to avoid RAM overload
 * Handles file streams directly with encryption and storage in the same operation
 *
 * Note: This is a utility class with all static methods. Do not instantiate.
 * @example
 * ```typescript
 * // Correct usage - call static methods directly
 * await FileEncryptionService.encryptWithKey(key, type, stream, path);
 *
 * // Incorrect - do not instantiate
 * const service = new FileEncryptionService(); // Don't do this
 * ```
 */
export class FileEncryptionService {
  /**
   * Encrypts file stream with encryption key and stores it directly
   * Processes file in chunks to avoid RAM overload
   * Works with both user and app encryption keys
   *
   * @public - Primary encryption method
   * @param encryptionKey - Encryption key as Uint8Array (user or app key)
   * @param encryptionType - The encryption context type
   * @param fileStream - File stream to encrypt
   * @param storagePath - Path where to store the encrypted file
   * @returns Promise resolving to file encryption result with master key
   */
  static async encryptWithKey(
    encryptionKey: Uint8Array,
    encryptionType: IHashingContext,
    fileStream: ReadableStream<Uint8Array>,
    storagePath: string,
    encryptionChunkSize?: number,
  ): Promise<FileEncryptionResult> {
    return await tracedWithServiceErrorHandling(
      "FileEncryptionService.encryptWithKey",
      {
        service: "FileEncryptionService",
        method: "encryptWithKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { storagePath, encryptionType },
      },
      "ENCRYPTION.ENCRYPTION_FAILED",
      async (span) => {
        span.attributes["encryption_type"] = encryptionType;
        span.attributes["storage_path"] = storagePath;
        span.attributes["encryption_chunk_size"] = encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES;

        // Validate inputs
        EncryptionValidationHelper.validateEncryptionKey(encryptionKey);
        EncryptionValidationHelper.validateEncryptionType(encryptionType);
        EncryptionValidationHelper.validateFileStream(fileStream);

        if (!storagePath || typeof storagePath !== "string") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        const { encryptedStream, encryptedDataKey } = await DataEncryptionHelperService
          .encryptStreamWithKey(
            encryptionKey,
            fileStream,
            encryptionChunkSize,
          );

        const { bytesWritten } = await (getStorage()).uploadFile(storagePath, encryptedStream);

        span.attributes["success"] = true;
        span.attributes["bytes_written"] = bytesWritten;

        return {
          storagePath,
          encryptedDataKey,
          bytesWritten,
        };
      },
      {
        logOverrides: {
          message: "Unexpected error encrypting file",
          messageKey: "encryption.encrypt_with_key.unexpected_error",
        },
      },
    );
  }

  /**
   * Decrypts file from storage with a raw data master key
   * Use this when you already have the decrypted data master key
   * Processes file in chunks to avoid RAM overload
   *
   * @public - Decryption method for already-decrypted master keys
   * @param dataMasterKey - Raw decrypted data master key as Uint8Array
   * @param storagePath - Path where the encrypted file is stored
   * @param encryptionChunkSize - Chunk size used during encryption (defaults to 64KB)
   * @returns Promise resolving to decrypted file stream
   */
  static async decryptWithRawDataMasterKey(
    dataMasterKey: Uint8Array,
    storagePath: string,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): Promise<ReadableStream<Uint8Array>> {
    return await tracedWithServiceErrorHandling(
      "FileEncryptionService.decryptWithRawDataMasterKey",
      {
        service: "FileEncryptionService",
        method: "decryptWithRawDataMasterKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { storagePath, encryptionChunkSize, dataMasterKeyLength: dataMasterKey?.length || 0 },
      },
      "ENCRYPTION.DECRYPTION_FAILED",
      async (span) => {
        span.attributes["storage_path"] = storagePath;
        span.attributes["encryption_chunk_size"] = encryptionChunkSize;

        // Validate inputs
        EncryptionValidationHelper.validateEncryptionKey(dataMasterKey);

        if (!storagePath || typeof storagePath !== "string") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        // Download the encrypted file stream
        const downloadResult = await (getStorage()).downloadFile(storagePath);

        if (!downloadResult || !downloadResult.stream) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        span.attributes["success"] = true;

        // Use direct decryption with raw data master key
        return await DataEncryptionHelperService.decryptStreamWithRawDataMasterKey(
          dataMasterKey,
          downloadResult.stream,
          encryptionChunkSize,
        );
      },
      {
        logOverrides: {
          message: "Unexpected error decrypting file with raw data master key",
          messageKey: "encryption.decrypt_with_raw_key.unexpected_error",
        },
      },
    );
  }

  /**
   * Decrypts file from storage with decryption key and returns stream
   * Processes file in chunks to avoid RAM overload
   * Works with both user and app decryption keys
   *
   * @public - Primary decryption method
   * @param decryptionKey - Decryption key as Uint8Array (user or app key)
   * @param encryptedMasterKey - The encrypted master key (hex string)
   * @param encryptionType - The encryption context type
   * @param storagePath - Path where the encrypted file is stored
   * @param encryptionChunkSize - Chunk size used during encryption (defaults to 64KB)
   * @returns Promise resolving to decrypted file stream
   */
  static async decryptWithKey(
    decryptionKey: Uint8Array,
    encryptedMasterKey: Uint8Array,
    encryptionType: IHashingContext,
    storagePath: string,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): Promise<ReadableStream<Uint8Array>> {
    return await tracedWithServiceErrorHandling(
      "FileEncryptionService.decryptWithKey",
      {
        service: "FileEncryptionService",
        method: "decryptWithKey",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { storagePath, encryptionType },
      },
      "ENCRYPTION.DECRYPTION_FAILED",
      async (span) => {
        span.attributes["encryption_type"] = encryptionType;
        span.attributes["storage_path"] = storagePath;
        span.attributes["encryption_chunk_size"] = encryptionChunkSize;

        // Validate inputs
        EncryptionValidationHelper.validateEncryptionKey(decryptionKey);
        EncryptionValidationHelper.validateEncryptionType(encryptionType);

        if (!storagePath || typeof storagePath !== "string") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        // Download the encrypted file stream
        const downloadResult = await (getStorage()).downloadFile(storagePath);

        if (!downloadResult || !downloadResult.stream) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        span.attributes["success"] = true;

        // Use shared stream decryption from DataEncryptionHelper
        return await DataEncryptionHelperService.decryptStreamWithKey(
          decryptionKey,
          encryptedMasterKey,
          downloadResult.stream,
          encryptionChunkSize,
        );
      },
      {
        logOverrides: {
          message: "Unexpected error decrypting file",
          messageKey: "encryption.decrypt_with_key.unexpected_error",
        },
      },
    );
  }

  /**
   * Decrypts a specific byte range from an encrypted file with optimized chunk downloading
   * Uses a raw data master key (no encrypted key decryption step)
   * Only downloads and decrypts the chunks needed for the requested range
   *
   * @param dataMasterKey - Raw decrypted data master key as Uint8Array
   * @param storagePath - Path where the encrypted file is stored
   * @param decryptedStart - Start byte in decrypted file (0-based)
   * @param decryptedEnd - End byte in decrypted file (0-based, inclusive)
   * @param totalDecryptedSize - Total size of decrypted file
   * @param encryptionChunkSize - Chunk size used during encryption (defaults to 64KB)
   * @returns Promise resolving to a ReadableStream of the decrypted byte range
   */
  static async decryptWithRawDataMasterKeyAndRange(
    dataMasterKey: Uint8Array,
    storagePath: string,
    decryptedStart: number,
    decryptedEnd: number,
    totalDecryptedSize: number,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): Promise<ReadableStream<Uint8Array>> {
    return await tracedWithServiceErrorHandling(
      "FileEncryptionService.decryptWithRawDataMasterKeyAndRange",
      {
        service: "FileEncryptionService",
        method: "decryptWithRawDataMasterKeyAndRange",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { storagePath, encryptionChunkSize, dataMasterKeyLength: dataMasterKey?.length || 0 },
      },
      "ENCRYPTION.DECRYPTION_FAILED",
      async (span) => {
        span.attributes["storage_path"] = storagePath;
        span.attributes["requested_range"] = `${decryptedStart}-${decryptedEnd}`;
        span.attributes["total_decrypted_size"] = totalDecryptedSize;

        // Validate inputs
        EncryptionValidationHelper.validateEncryptionKey(dataMasterKey);

        if (!storagePath || typeof storagePath !== "string") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        // Validate range
        if (!isValidRange(decryptedStart, decryptedEnd, totalDecryptedSize)) {
          throwHttpError("VALIDATION.INVALID_FORMAT", {
            message: `Invalid byte range: ${decryptedStart}-${decryptedEnd} for file size ${totalDecryptedSize}`,
          });
        }

        // Calculate which encrypted chunks we need
        const chunkRange = calculateChunkRange(decryptedStart, decryptedEnd, totalDecryptedSize, encryptionChunkSize);

        span.attributes["chunks_needed"] = chunkRange.totalChunks;
        span.attributes["encrypted_bytes_to_download"] = chunkRange.encryptedBytesToDownload;
        span.attributes["start_chunk"] = chunkRange.startChunk;
        span.attributes["end_chunk"] = chunkRange.endChunk;

        // Download only the encrypted chunks we need
        const downloadResult = await (getStorage()).downloadFile(storagePath, {
          start: chunkRange.encryptedStartByte,
          end: chunkRange.encryptedEndByte,
        });

        if (!downloadResult || !downloadResult.stream) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Decrypt the downloaded chunks using raw data master key
        const decryptedStream = await DataEncryptionHelperService.decryptStreamWithRawDataMasterKey(
          dataMasterKey,
          downloadResult.stream,
          encryptionChunkSize,
        );

        // Return a ReadableStream that slices the decrypted data on-the-fly,
        // skipping leading offset bytes and closing after the requested range.
        // This streams directly to the HTTP response without buffering.
        const requestedBytes = decryptedEnd - decryptedStart + 1;
        const skipBytes = chunkRange.offsetInFirstChunk;

        span.attributes["success"] = true;
        span.attributes["result_bytes"] = requestedBytes;

        return this.createSlicedStream(decryptedStream, skipBytes, requestedBytes);
      },
      {
        logOverrides: {
          message: "Unexpected error decrypting file with raw data master key and range",
          messageKey: "encryption.decrypt_with_raw_key_range.unexpected_error",
        },
      },
    );
  }

  /**
   * Decrypts a specific byte range from an encrypted file with optimized chunk downloading
   * Only downloads and decrypts the chunks needed for the requested range
   *
   * @param decryptionKey - Decryption key as Uint8Array (user or app key)
   * @param encryptedMasterKey - The encrypted master key
   * @param encryptionType - The encryption context type
   * @param storagePath - Path where the encrypted file is stored
   * @param decryptedStart - Start byte in decrypted file (0-based)
   * @param decryptedEnd - End byte in decrypted file (0-based, inclusive)
   * @param totalDecryptedSize - Total size of decrypted file
   * @param encryptionChunkSize - Chunk size used during encryption (defaults to 64KB)
   * @returns Promise resolving to a ReadableStream of the decrypted byte range
   */
  static async decryptWithKeyAndRange(
    decryptionKey: Uint8Array,
    encryptedMasterKey: Uint8Array,
    encryptionType: IHashingContext,
    storagePath: string,
    decryptedStart: number,
    decryptedEnd: number,
    totalDecryptedSize: number,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): Promise<ReadableStream<Uint8Array>> {
    return await tracedWithServiceErrorHandling(
      "FileEncryptionService.decryptWithKeyAndRange",
      {
        service: "FileEncryptionService",
        method: "decryptWithKeyAndRange",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { storagePath, encryptionType, range: `${decryptedStart}-${decryptedEnd}` },
      },
      "ENCRYPTION.DECRYPTION_FAILED",
      async (span) => {
        span.attributes["encryption_type"] = encryptionType;
        span.attributes["storage_path"] = storagePath;
        span.attributes["requested_range"] = `${decryptedStart}-${decryptedEnd}`;
        span.attributes["total_decrypted_size"] = totalDecryptedSize;

        // Validate inputs
        EncryptionValidationHelper.validateEncryptionKey(decryptionKey);
        EncryptionValidationHelper.validateEncryptionType(encryptionType);

        if (!storagePath || typeof storagePath !== "string") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        // Validate range
        if (!isValidRange(decryptedStart, decryptedEnd, totalDecryptedSize)) {
          throwHttpError("VALIDATION.INVALID_FORMAT", {
            message: `Invalid byte range: ${decryptedStart}-${decryptedEnd} for file size ${totalDecryptedSize}`,
          });
        }

        // Calculate which encrypted chunks we need
        const chunkRange = calculateChunkRange(decryptedStart, decryptedEnd, totalDecryptedSize, encryptionChunkSize);

        span.attributes["chunks_needed"] = chunkRange.totalChunks;
        span.attributes["encrypted_bytes_to_download"] = chunkRange.encryptedBytesToDownload;
        span.attributes["start_chunk"] = chunkRange.startChunk;
        span.attributes["end_chunk"] = chunkRange.endChunk;

        // Download only the encrypted chunks we need
        const downloadResult = await (getStorage()).downloadFile(storagePath, {
          start: chunkRange.encryptedStartByte,
          end: chunkRange.encryptedEndByte,
        });

        if (!downloadResult || !downloadResult.stream) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Decrypt the downloaded chunks
        const decryptedStream = await DataEncryptionHelperService.decryptStreamWithKey(
          decryptionKey,
          encryptedMasterKey,
          downloadResult.stream,
          encryptionChunkSize,
        );

        // Return a ReadableStream that slices the decrypted data on-the-fly,
        // skipping leading offset bytes and closing after the requested range.
        // This streams directly to the HTTP response without buffering.
        const requestedBytes = decryptedEnd - decryptedStart + 1;
        const skipBytes = chunkRange.offsetInFirstChunk;

        span.attributes["success"] = true;
        span.attributes["result_bytes"] = requestedBytes;

        return this.createSlicedStream(decryptedStream, skipBytes, requestedBytes);
      },
      {
        logOverrides: {
          message: "Unexpected error decrypting file with range",
          messageKey: "encryption.decrypt_with_key_range.unexpected_error",
        },
      },
    );
  }

  /**
   * Creates a ReadableStream that slices a source stream, skipping leading bytes
   * and closing after emitting the requested number of bytes.
   * Used by range decryption methods to avoid buffering the entire result.
   *
   * @private
   * @param source - The source decrypted stream
   * @param skipBytes - Number of leading bytes to skip (offset in first chunk)
   * @param requestedBytes - Total number of bytes to emit
   * @returns ReadableStream that emits only the requested byte range
   */
  private static createSlicedStream(
    source: ReadableStream<Uint8Array>,
    skipBytes: number,
    requestedBytes: number,
  ): ReadableStream<Uint8Array> {
    const reader = source.getReader();
    let bytesSkipped = 0;
    let bytesEmitted = 0;

    return new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          while (bytesEmitted < requestedBytes) {
            const { done, value } = await reader.read();
            if (done) {
              controller.close();
              return;
            }

            let chunkStart = 0;
            let chunkUsable = value.length;

            // Skip leading bytes from the offset in the first chunk
            if (bytesSkipped < skipBytes) {
              const toSkip = Math.min(skipBytes - bytesSkipped, value.length);
              bytesSkipped += toSkip;
              chunkStart = toSkip;
              chunkUsable -= toSkip;
            }

            if (chunkUsable <= 0) continue;

            // Only emit what we still need
            const bytesNeeded = requestedBytes - bytesEmitted;
            const toEmit = Math.min(chunkUsable, bytesNeeded);
            controller.enqueue(value.subarray(chunkStart, chunkStart + toEmit));
            bytesEmitted += toEmit;

            if (bytesEmitted >= requestedBytes) {
              controller.close();
              // Cancel (not just releaseLock) the source so its lazy decryption
              // stream tears down: zeroes its key and finalizes its work-time
              // span even though we stopped before the source was exhausted.
              reader.cancel().catch(() => {});
              return;
            }

            // Return from pull() to let the consumer process this chunk
            // before pulling again (backpressure-aware)
            return;
          }

          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        // Propagate cancellation to the source so it zeroes its key and
        // finalizes its work-time span on early client disconnect.
        reader.cancel().catch(() => {});
      },
    });
  }
}
