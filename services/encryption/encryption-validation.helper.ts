/**
 * @file services/encryption/encryption-validation.helper.ts
 * @description Shared validation utilities for encryption services
 * Centralizes common validation logic to eliminate code duplication
 */

import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";

/**
 * Centralized validation utilities for encryption operations
 * Used by all encryption services to ensure consistent validation logic
 */
export class EncryptionValidationHelper {
  /**
   * Validates an encryption type against available hashing contexts
   * @param encryptionType - The encryption type to validate (case-insensitive)
   * @throws Error if type is invalid
   */
  static validateEncryptionType(
    encryptionType: string,
  ): void {
    if (!encryptionType) {
      throwHttpError("ENCRYPTION.INVALID_TYPE");
    }

    const normalizedType = encryptionType.toUpperCase().replace(/-/g, "_");
    if (!(normalizedType in HASHING_CONTEXTS)) {
      throwHttpError("ENCRYPTION.INVALID_TYPE");
    }
  }

  /**
   * Validates data input for encryption operations
   * @param data - Data to validate
   * @param paramName - Parameter name for error messages
   */
  static validateDataInput(
    data: string | Uint8Array,
    paramName: string = "Data",
  ): void {
    if (
      !data || (typeof data === "string" && data.length === 0) ||
      (data instanceof Uint8Array && data.length === 0)
    ) {
      throwHttpErrorWithCustomMessage(
        "ENCRYPTION.INVALID_DATA",
        `${paramName} to encrypt cannot be empty`,
      );
    }
  }

  /**
   * Validates file stream input
   * @param stream - File stream to validate
   * @param streamName - Name of the stream for error messages
   */
  static validateFileStream(
    stream: ReadableStream<Uint8Array>,
    streamName: string = "File stream",
  ): void {
    if (!stream) {
      throwHttpErrorWithCustomMessage(
        "ENCRYPTION.INVALID_STREAM",
        `${streamName} cannot be null or undefined`,
      );
    }

    if (!(stream instanceof ReadableStream)) {
      throwHttpErrorWithCustomMessage(
        "ENCRYPTION.INVALID_STREAM_TYPE",
        `${streamName} must be a ReadableStream`,
      );
    }

    if (stream.locked) {
      throwHttpErrorWithCustomMessage(
        "ENCRYPTION.STREAM_LOCKED",
        `${streamName} is already locked by another reader`,
      );
    }
  }

  /**
   * Validates encryption key
   * @param key - Encryption key to validate
   */
  static validateEncryptionKey(key: Uint8Array): void {
    if (!key) {
      throwHttpError("ENCRYPTION.ENCRYPTION_KEY_REQUIRED");
    }

    if (!(key instanceof Uint8Array)) {
      throwHttpError("ENCRYPTION.ENCRYPTION_KEY_UINT8ARRAY_REQUIRED");
    }

    if (key.length !== 32) {
      throwHttpError("ENCRYPTION.ENCRYPTION_KEY_INVALID_LENGTH");
    }

    // Check for weak keys (all zeros)
    const isAllZeros = key.every((byte) => byte === 0);
    if (isAllZeros) {
      throwHttpError("ENCRYPTION.WEAK_KEY");
    }
  }
}
