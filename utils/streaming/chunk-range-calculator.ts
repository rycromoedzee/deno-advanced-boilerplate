/**
 * @file utils/streaming/chunk-range-calculator.ts
 * @description Utility for calculating encrypted chunk ranges for decrypted byte ranges
 *
 * This utility maps decrypted byte positions to encrypted chunk positions,
 * enabling efficient range requests on encrypted files without decrypting everything.
 */

/**
 * Chunk size constants matching the encryption service
 * These must stay in sync with DataEncryptionHelperService
 */
export const CHUNK_CONSTANTS = {
  // Default plaintext chunk size (512KB) - can be overridden
  DEFAULT_PLAINTEXT_CHUNK_SIZE: 512 * 1024,

  // Encryption overhead per chunk (nonce + auth tag)
  // ChaCha20-Poly1305: 12-byte nonce + 16-byte tag = 28 bytes
  ENCRYPTION_OVERHEAD: 28,

  // Default encrypted chunk size
  get DEFAULT_ENCRYPTED_CHUNK_SIZE() {
    return this.DEFAULT_PLAINTEXT_CHUNK_SIZE + this.ENCRYPTION_OVERHEAD;
  },
} as const;

/**
 * Result of chunk range calculation
 */
export interface ChunkRangeResult {
  /** First chunk index needed (0-based) */
  startChunk: number;

  /** Last chunk index needed (0-based, inclusive) */
  endChunk: number;

  /** Byte offset in encrypted file to start download */
  encryptedStartByte: number;

  /** Byte offset in encrypted file to end download (inclusive) */
  encryptedEndByte: number;

  /** Byte offset within first decrypted chunk where requested range starts */
  offsetInFirstChunk: number;

  /** Byte offset within last decrypted chunk where requested range ends (inclusive) */
  offsetInLastChunk: number;

  /** Total number of chunks to download */
  totalChunks: number;

  /** Total encrypted bytes to download */
  encryptedBytesToDownload: number;
}

/**
 * Calculate which encrypted chunks are needed for a decrypted byte range
 *
 * @param decryptedStart - Start byte in decrypted file (0-based)
 * @param decryptedEnd - End byte in decrypted file (0-based, inclusive)
 * @param totalDecryptedSize - Total size of decrypted file in bytes
 * @param plaintextChunkSize - Chunk size used during encryption (defaults to 64KB)
 * @returns Chunk range information for downloading and decrypting
 *
 * @example
 * // Request bytes 100,000-200,000 from a 10MB file
 * const range = calculateChunkRange(100000, 200000, 10485760);
 * // Returns which encrypted chunks contain these bytes
 */
export function calculateChunkRange(
  decryptedStart: number,
  decryptedEnd: number,
  totalDecryptedSize: number,
  plaintextChunkSize: number = CHUNK_CONSTANTS.DEFAULT_PLAINTEXT_CHUNK_SIZE,
): ChunkRangeResult {
  // Validate inputs
  if (decryptedStart < 0 || decryptedEnd < decryptedStart || decryptedEnd >= totalDecryptedSize) {
    throw new Error(
      `Invalid range: ${decryptedStart}-${decryptedEnd} for file size ${totalDecryptedSize}`,
    );
  }

  const { ENCRYPTION_OVERHEAD } = CHUNK_CONSTANTS;
  const ENCRYPTED_CHUNK_SIZE = plaintextChunkSize + ENCRYPTION_OVERHEAD;

  // Calculate which chunks contain the requested byte range
  const startChunk = Math.floor(decryptedStart / plaintextChunkSize);
  const endChunk = Math.floor(decryptedEnd / plaintextChunkSize);

  // Calculate encrypted file positions for these chunks
  const encryptedStartByte = startChunk * ENCRYPTED_CHUNK_SIZE;
  const encryptedEndByte = (endChunk + 1) * ENCRYPTED_CHUNK_SIZE - 1;

  // Calculate offsets within the first and last chunks
  const offsetInFirstChunk = decryptedStart % plaintextChunkSize;
  const offsetInLastChunk = decryptedEnd % plaintextChunkSize;

  // Calculate totals
  const totalChunks = endChunk - startChunk + 1;
  const encryptedBytesToDownload = encryptedEndByte - encryptedStartByte + 1;

  return {
    startChunk,
    endChunk,
    encryptedStartByte,
    encryptedEndByte,
    offsetInFirstChunk,
    offsetInLastChunk,
    totalChunks,
    encryptedBytesToDownload,
  };
}

/**
 * Calculate total encrypted file size from decrypted file size
 *
 * @param decryptedSize - Size of decrypted file in bytes
 * @returns Size of encrypted file in bytes
 *
 * @example
 * const encryptedSize = calculateEncryptedFileSize(10485760); // 10MB
 * // Returns: 10486400 (10MB + overhead for 160 chunks)
 */
export function calculateEncryptedFileSize(
  decryptedSize: number,
  plaintextChunkSize: number = CHUNK_CONSTANTS.DEFAULT_PLAINTEXT_CHUNK_SIZE,
): number {
  const { ENCRYPTION_OVERHEAD } = CHUNK_CONSTANTS;

  const totalChunks = Math.ceil(decryptedSize / plaintextChunkSize);
  return decryptedSize + (totalChunks * ENCRYPTION_OVERHEAD);
}

/**
 * Calculate decrypted file size from encrypted file size (approximate)
 *
 * @param encryptedSize - Size of encrypted file in bytes
 * @returns Approximate size of decrypted file in bytes
 *
 * Note: This is an approximation because we don't know the exact chunk count
 * without additional metadata. For exact sizes, store the original file size.
 */
export function calculateDecryptedFileSize(
  encryptedSize: number,
  plaintextChunkSize: number = CHUNK_CONSTANTS.DEFAULT_PLAINTEXT_CHUNK_SIZE,
): number {
  const { ENCRYPTION_OVERHEAD } = CHUNK_CONSTANTS;
  const ENCRYPTED_CHUNK_SIZE = plaintextChunkSize + ENCRYPTION_OVERHEAD;

  const approximateChunks = Math.ceil(encryptedSize / ENCRYPTED_CHUNK_SIZE);
  return encryptedSize - (approximateChunks * ENCRYPTION_OVERHEAD);
}

/**
 * Validate that a range request is satisfiable
 *
 * @param start - Start byte (0-based)
 * @param end - End byte (0-based, inclusive)
 * @param fileSize - Total file size
 * @returns True if range is valid
 */
export function isValidRange(
  start: number,
  end: number,
  fileSize: number,
): boolean {
  return (
    start >= 0 &&
    end >= start &&
    end < fileSize &&
    fileSize > 0
  );
}

/**
 * Format a Content-Range header value
 *
 * @param start - Start byte (0-based)
 * @param end - End byte (0-based, inclusive)
 * @param total - Total file size
 * @returns Content-Range header value (e.g., "bytes 0-1023/10485760")
 */
export function formatContentRange(
  start: number,
  end: number,
  total: number,
): string {
  return `bytes ${start}-${end}/${total}`;
}
