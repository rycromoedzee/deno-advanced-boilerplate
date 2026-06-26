/**
 * @file interfaces/storage.ts
 * @description Storage service interfaces
 * These interfaces define the structure for storage operations and providers
 */

/**
 * File entry returned by listFiles
 */
export interface IStorageFileEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  size?: number;
}

/**
 * Download result with range support
 */
export interface IStorageDownloadResult {
  stream: ReadableStream<Uint8Array>;
  contentLength?: number;
  totalSize?: number;
  contentRange?: string;
  status: number; // 200 or 206
}

export interface IUploadResult {
  bytesWritten: number;
}

/**
 * Storage provider interface for different storage backends
 */
export interface IStorageProvider {
  listFiles(path?: string): Promise<IStorageFileEntry[]>;
  uploadFile(
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array,
  ): Promise<IUploadResult>;
  downloadFile(
    path: string,
    range?: { start?: number; end?: number },
  ): Promise<IStorageDownloadResult>;
  getFileSize(path: string): Promise<number>;
  deleteFile(path: string): Promise<void>;

  /**
   * Delete a directory/folder from storage
   *
   * @param path - The path to the directory to delete
   * @param options - Optional configuration
   * @param options.recursive - If true, delete directory and all contents. If false, only delete empty directories.
   *
   * Behavior:
   * - Should silently succeed if directory doesn't exist
   * - With recursive=false: Should only delete empty directories, fail silently if not empty
   * - With recursive=true: Should delete directory and all contents
   *
   * Note for S3: S3 doesn't have real directories. With recursive=false, this is a no-op.
   * With recursive=true, it will list and delete all objects with the path prefix.
   */
  deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void>;

  /**
   * Recursively list every OBJECT key under `prefix` (paginated/recursive — no
   * 1000-key cap). Used by object-backup Phase C to enumerate a destroyed
   * tenant's backup subtree for explicit per-key deletion (`deleteDirectory` is
   * unsafe: S3 silently caps at 1000 keys, Bunny/Local swallow errors). Keys
   * are returned in the same format `uploadFile`/`deleteFile` use (relative to
   * the provider root, forward slashes, no leading slash).
   */
  listKeysRecursive(prefix: string): Promise<string[]>;
}
