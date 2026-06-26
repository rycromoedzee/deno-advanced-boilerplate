/**
 * @file interfaces/chunked-upload.ts
 * @description Interfaces and types for chunked upload system
 */

import type { UploadSessionStatus } from "@constants/documents/chunked-upload.ts";

/**
 * Upload session data stored in cache
 */
export interface IUploadSession {
  /** Unique session identifier */
  id: string;

  /** User ID who initiated the upload */
  userId: string;

  /** Environment ID for multi-tenant support */
  environmentId: string;

  /** Original filename */
  fileName: string;

  /** Total file size in bytes */
  fileSize: number;

  /** MIME type of the file */
  mimeType: string;

  /** Total number of chunks */
  totalChunks: number;

  /** Size of each chunk in bytes */
  chunkSize: number;

  /** Array of successfully uploaded chunk indices */
  uploadedChunks: number[];

  /** Current session status */
  status: UploadSessionStatus;

  /** Document metadata */
  metadata?: {
    name?: string;
    description?: string | null;
    folderId?: string | null;
    tags?: string[];
    customMetadata?: Record<string, unknown>;
    initialComment?: string;
  };

  /** Encryption data (set after first chunk upload) */
  encryption?: {
    /** Encrypted data key (master key) as base64 - generated during first chunk encryption */
    encryptedDataKey: string;
    /** Encryption mode used */
    encryptionMode: "user" | "app";
    /** Encryption key as base64 (for reuse across chunks) */
    encryptionKeyBase64: string;
  };

  /** Content tracking for hash calculation */
  contentTracking?: {
    /** Temporary storage paths for original chunks (for hash calculation) */
    originalChunkPaths: string[]; // Paths to stored original chunks
    /** Total bytes processed */
    totalBytes: number;
  };

  /** Timestamp when session was created */
  createdAt: number;

  /** Timestamp when session will expire */
  expiresAt: number;

  /** Timestamp of last activity */
  lastActivityAt: number;

  /** Error message if upload failed */
  errorMessage?: string;

  /** Document ID created after successful assembly (set when status becomes "completed") */
  documentId?: string;

  /**
   * Temporary storage path for a session-level thumbnail uploaded before completion.
   * The background assembly job applies it to the document once created.
   */
  thumbnailPath?: string;

  /** Width of the pending session thumbnail in pixels */
  thumbnailWidth?: number;

  /** Height of the pending session thumbnail in pixels */
  thumbnailHeight?: number;

  /** Original (unencrypted) size of the pending session thumbnail in bytes */
  thumbnailSize?: number;

  /** Base64-encoded encrypted master key for the pending session thumbnail */
  thumbnailEncryptedKey?: string;
}

/**
 * Chunk metadata for tracking individual chunks
 */
export interface IChunkMetadata {
  /** Session ID this chunk belongs to */
  sessionId: string;

  /** Index of this chunk (0-based) */
  chunkIndex: number;

  /** Size of this chunk in bytes */
  size: number;

  /** Storage path where chunk is temporarily stored */
  storagePath: string;

  /** Timestamp when chunk was uploaded */
  uploadedAt: number;

  /** Optional checksum for validation */
  checksum?: string;
}

/**
 * Request to initiate a chunked upload
 */
export interface IInitiateUploadRequest {
  /** Filename */
  fileName: string;

  /** File size in bytes */
  fileSize: number;

  /** MIME type (auto-detected from filename if not provided) */
  mimeType?: string;

  /** Optional chunk size (defaults to config value) */
  chunkSize?: number;

  /** Optional document name */
  name?: string;

  /** Optional description */
  description?: string;

  /** Optional folder ID */
  folderId?: string;

  /** Optional tags */
  tags?: string[];

  /** Optional custom metadata */
  metadata?: Record<string, unknown>;
}

/**
 * Response from initiating upload
 */
export interface IInitiateUploadResponse {
  /** Unique session ID for this upload */
  sessionId: string;

  /** Chunk size to use for uploads */
  chunkSize: number;

  /** Total number of chunks expected */
  totalChunks: number;

  /** Expiry timestamp */
  expiresAt: number;
}

/**
 * Response for upload status/progress
 */
export interface IUploadStatusResponse {
  /** Session ID */
  sessionId: string;

  /** Current status */
  status: UploadSessionStatus;

  /** Number of chunks uploaded */
  chunksUploaded: number;

  /** Total chunks expected */
  totalChunks: number;

  /** Upload progress percentage (0-100) */
  progress: number;

  /** Missing chunk indices (for resume functionality) */
  missingChunks: number[];

  /** Expiry timestamp */
  expiresAt: number;

  /** Error message if failed */
  errorMessage?: string;

  /** Document ID — populated when status is "completed" */
  documentId?: string;
}

/**
 * Request to upload a chunk
 */
export interface IUploadChunkRequest {
  /** Session ID */
  sessionId: string;

  /** Chunk index (0-based) */
  chunkIndex: number;

  /** Chunk data as stream or buffer */
  chunkData: ReadableStream<Uint8Array> | Uint8Array;

  /** Optional checksum for validation */
  checksum?: string;
}

/**
 * Response after uploading a chunk
 */
export interface IUploadChunkResponse {
  /** Session ID */
  sessionId: string;

  /** Chunk index that was uploaded */
  chunkIndex: number;

  /** Number of chunks uploaded so far */
  chunksUploaded: number;

  /** Total chunks expected */
  totalChunks: number;

  /** Upload progress percentage */
  progress: number;

  /** Whether this was the last chunk */
  isLastChunk: boolean;
}

/**
 * Request to complete upload
 */
export interface ICompleteUploadRequest {
  /** Session ID */
  sessionId: string;
}

/**
 * Options for chunk assembly
 */
export interface IChunkAssemblyOptions {
  /** Session data */
  session: IUploadSession;

  /** User encryption key */
  encryptionKey: Uint8Array;

  /** Encryption mode */
  encryptionMode: "user" | "app";

  /** Whether to skip thumbnail generation */
  skipThumbnail?: boolean;
}

/**
 * Result from chunk assembly
 */
export interface IChunkAssemblyResult {
  /** Assembled file stream */
  fileStream: ReadableStream<Uint8Array>;

  /** Total assembled file size */
  fileSize: number;

  /** Paths of temporary chunks to clean up */
  tempChunkPaths: string[];
}
