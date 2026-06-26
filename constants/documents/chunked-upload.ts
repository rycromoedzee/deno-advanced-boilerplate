/**
 * @file constants/documents/chunked-upload.ts
 * @description Configuration constants for chunked file upload system
 *
 * This provides centralized configuration for the chunked upload mechanism,
 * enabling efficient handling of large files by breaking them into manageable pieces.
 */

/**
 * Chunk upload size limits and configuration
 */
export const CHUNKED_UPLOAD_CONFIG = {
  /**
   * Default chunk size in bytes (10MB)
   * Files are split into chunks of this size for upload
   */
  DEFAULT_CHUNK_SIZE_BYTES: 10 * 1024 * 1024, // 10MB

  /**
   * Recommended chunk size for media files that need range-based streaming (2MB)
   *
   * WHY: During range requests (e.g., video seeking), the entire encrypted chunk
   * containing the requested byte range must be downloaded and decrypted, even if
   * only a fraction of the decrypted data is needed. Smaller chunks mean:
   * - Less data to download per range request (network savings)
   * - Less data to decrypt per range request (CPU savings, ~30ms per MB of crypto)
   * - Lower peak memory usage per request
   *
   * Trade-off: Smaller chunks increase per-chunk overhead (IV + auth tag per chunk)
   * and total encrypted file size slightly. 2MB is a good balance for media streaming.
   *
   * NOTE: Changing this does NOT affect already-uploaded files. Each file's chunk size
   * is stored in storageMetadata.encryptionChunkSize at upload time. Only new uploads
   * using this value will benefit. To optimize existing files, they must be re-encrypted.
   */
  MEDIA_CHUNK_SIZE_BYTES: 2 * 1024 * 1024, // 2MB

  /**
   * Minimum chunk size in bytes (1MB)
   * Prevents excessive number of chunks for small files
   */
  MIN_CHUNK_SIZE_BYTES: 1 * 1024 * 1024, // 1MB

  /**
   * Maximum chunk size in bytes (50MB)
   * Prevents individual chunks from being too large
   */
  MAX_CHUNK_SIZE_BYTES: 50 * 1024 * 1024, // 50MB

  /**
   * Session expiry time in milliseconds (24 hours)
   * Incomplete uploads are cleaned up after this duration
   */
  SESSION_EXPIRY: 24 * 60 * 60, // 24 hours

  /**
   * Maximum file size for thumbnail generation (100MB)
   * Files larger than this will skip thumbnail generation to save memory
   */
  THUMBNAIL_SIZE_THRESHOLD_BYTES: 100 * 1024 * 1024, // 100MB

  /**
   * Cache key prefix for upload sessions
   */
  CACHE_KEY_PREFIX: "upload_session:",

  /**
   * Cache key prefix for uploaded chunks
   */
  CHUNK_CACHE_KEY_PREFIX: "upload_chunk:",

  /**
   * Maximum number of retry attempts for chunk upload
   */
  MAX_CHUNK_RETRY_ATTEMPTS: 3,

  /**
   * Cleanup job interval in milliseconds (1 hour)
   * How often to check for and clean up expired sessions
   */
  CLEANUP_INTERVAL: 60 * 60, // 1 hour
} as const;

/**
 * Upload session status values
 */
export const UPLOAD_SESSION_STATUS = {
  INITIATED: "initiated",
  UPLOADING: "uploading",
  ASSEMBLING: "assembling",
  COMPLETED: "completed",
  FAILED: "failed",
  ABORTED: "aborted",
} as const;

export type UploadSessionStatus = typeof UPLOAD_SESSION_STATUS[keyof typeof UPLOAD_SESSION_STATUS];

/**
 * Calculate total number of chunks for a file
 */
/**
 * Check if a MIME type is a streamable media type (video/audio)
 * These benefit from smaller encryption chunks for range-based seeking
 */
function isStreamableMedia(mimeType?: string): boolean {
  if (!mimeType) return false;
  return mimeType.startsWith("video/") || mimeType.startsWith("audio/");
}

/**
 * Calculate optimal chunk size based on file size and optional MIME type
 * Returns size in bytes within API limits (1MB - 50MB)
 *
 * Adaptive sizing strategy:
 * - Smaller files use smaller chunks for faster first-byte response
 * - Larger files use larger chunks for better efficiency and less overhead
 * - Streamable media (video/audio) uses smaller chunks (2MB) to reduce the
 *   amount of data that must be downloaded and decrypted per range request
 *   during seeking. See MEDIA_CHUNK_SIZE_BYTES for rationale.
 */
export function calculateOptimalChunkSize(fileSize: number, mimeType?: string): number {
  const MB = 1024 * 1024;

  // Streamable media files use smaller chunks for efficient range requests
  if (isStreamableMedia(mimeType)) {
    return CHUNKED_UPLOAD_CONFIG.MEDIA_CHUNK_SIZE_BYTES;
  }

  // Adaptive chunk sizing based on file size
  // Small files (< 100MB): 5 MB chunks for faster processing
  if (fileSize < 100 * MB) {
    return 5 * MB;
  } // Medium files (100MB - 500MB): 10 MB chunks (standard)
  else if (fileSize < 500 * MB) {
    return 10 * MB;
  } // Large files (500MB - 2GB): 20 MB chunks for efficiency
  else if (fileSize < 2 * 1024 * MB) {
    return 20 * MB;
  } // Very large files (2GB - 5GB): 30 MB chunks
  else if (fileSize < 5 * 1024 * MB) {
    return 30 * MB;
  } // Extremely large files (> 5GB): 40 MB chunks (near max)
  else {
    return 40 * MB;
  }
}

/**
 * Calculate total number of chunks for a file
 */
export function calculateTotalChunks(fileSize: number, chunkSize: number = calculateOptimalChunkSize(fileSize)): number {
  return Math.ceil(fileSize / chunkSize);
}

/**
 * Calculate chunk size boundaries
 */
export function calculateChunkBoundaries(chunkIndex: number, fileSize: number, chunkSize: number = calculateOptimalChunkSize(fileSize)): {
  start: number;
  end: number;
  size: number;
} {
  const start = chunkIndex * chunkSize;
  const end = Math.min(start + chunkSize, fileSize);
  const size = end - start;

  return { start, end, size };
}

/**
 * Validate chunk size
 */
export function isValidChunkSize(chunkSize: number): boolean {
  return chunkSize >= CHUNKED_UPLOAD_CONFIG.MIN_CHUNK_SIZE_BYTES &&
    chunkSize <= CHUNKED_UPLOAD_CONFIG.MAX_CHUNK_SIZE_BYTES;
}

/**
 * Check if file should skip thumbnail generation
 */
export function shouldSkipThumbnail(fileSize: number): boolean {
  return fileSize > CHUNKED_UPLOAD_CONFIG.THUMBNAIL_SIZE_THRESHOLD_BYTES;
}
