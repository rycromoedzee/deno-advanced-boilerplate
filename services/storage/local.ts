/**
 * @file services/storage/local.ts
 * @description Local service module (storage)
 */
import type { DownloadResult, FileEntry, IUploadResult, StorageProvider, StorageProviderConfig } from "./types.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { stdResolve as resolve } from "@deps";

const DATA_DIR = "./.data";

export class LocalStorage implements StorageProvider {
  private readonly dataDir: string;
  private readonly dataDirResolved: string;

  constructor(config?: StorageProviderConfig) {
    this.dataDir = config?.localBaseDir ?? DATA_DIR;
    this.dataDirResolved = resolve(this.dataDir);
    try {
      Deno.statSync(this.dataDir);
    } catch {
      Deno.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private getFullPath(path: string): string {
    // Normalize the path to resolve any '..' or '.' segments
    let cleanPath = path;
    if (cleanPath.startsWith("/")) {
      cleanPath = cleanPath.substring(1);
    }

    // Resolve to absolute path and normalize
    const fullPath = resolve(this.dataDir, cleanPath);

    // Security check: ensure the resolved path is within DATA_DIR
    if (!fullPath.startsWith(this.dataDirResolved)) {
      useLogger(LoggerLevels.error, {
        message: "Path traversal attempt detected",
        messageKey: "storage.local.path_traversal",
        section: loggerAppSections.STORAGE,
        details: { attemptedPath: path },
      });
      throwHttpError("COMMON.INVALID_INPUT");
    }

    return fullPath;
  }

  async listFiles(path = "/"): Promise<FileEntry[]> {
    const fullPath = this.getFullPath(path === "/" ? "" : path);
    try {
      const entries: FileEntry[] = [];
      for await (const entry of Deno.readDir(fullPath)) {
        const entryPath = `${fullPath}/${entry.name}`;
        const stat = await Deno.stat(entryPath);
        entries.push({
          name: entry.name,
          isFile: stat.isFile,
          isDirectory: stat.isDirectory,
          size: stat.isFile ? stat.size : undefined,
        });
      }
      return entries;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        return [];
      }

      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error listing files in local storage",
        messageKey: "storage.local.list_files.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { path },
        raw: error,
      });

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async uploadFile(
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array,
  ): Promise<IUploadResult> {
    return await traced("LocalStorage.uploadFile", "storage", async (span) => {
      span.attributes["service"] = "local";
      span.attributes["path"] = path;
      span.attributes["data_type"] = data instanceof Uint8Array ? "buffer" : "stream";

      try {
        const fullPath = this.getFullPath(path);
        const dir = fullPath.substring(0, fullPath.lastIndexOf("/"));
        if (dir && dir !== this.dataDirResolved) {
          Deno.mkdirSync(dir, { recursive: true });
        }

        let bytesWritten = 0;

        if (data instanceof Uint8Array) {
          await Deno.writeFile(fullPath, data);
          bytesWritten = data.byteLength;
        } else {
          const file = await Deno.open(fullPath, { write: true, create: true, truncate: true });

          const countingStream = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesWritten += chunk.byteLength;
              controller.enqueue(chunk);
            },
          });

          await data.pipeThrough(countingStream).pipeTo(file.writable);
        }

        span.attributes["file_size"] = bytesWritten;
        span.attributes["success"] = true;

        return { bytesWritten };
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error uploading file to local storage",
          messageKey: "storage.local.upload_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  async downloadFile(
    path: string,
    range?: { start?: number; end?: number },
  ): Promise<DownloadResult> {
    return await traced("LocalStorage.downloadFile", "storage", async (span) => {
      span.attributes["service"] = "local";
      span.attributes["path"] = path;
      span.attributes["has_range"] = !!range;

      try {
        const fullPath = this.getFullPath(path);
        const fileInfo = await Deno.stat(fullPath);

        if (!fileInfo.isFile) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        const totalSize = fileInfo.size;
        let start = 0;
        let end = totalSize - 1;
        let isPartial = false;
        let contentLength = totalSize;

        if (range) {
          start = range.start || 0;
          end = range.end !== undefined ? range.end : totalSize - 1;
          if (start >= totalSize) {
            throwHttpError("COMMON.INVALID_INPUT");
          }
          end = Math.min(end, totalSize - 1);
          isPartial = true;
          contentLength = end - start + 1;
        }

        const file = await Deno.open(fullPath, { read: true });
        try {
          await file.seek(start, Deno.SeekMode.Start);

          let stream: ReadableStream<Uint8Array>;
          if (contentLength < totalSize - start) {
            // Need to limit the stream to contentLength bytes
            let bytesProcessed = 0;
            const limitedTransform = new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                const remaining = contentLength - bytesProcessed;
                if (remaining <= 0) {
                  controller.terminate();
                  return;
                }
                if (chunk.length > remaining) {
                  controller.enqueue(chunk.subarray(0, remaining));
                  controller.terminate();
                } else {
                  controller.enqueue(chunk);
                  bytesProcessed += chunk.length;
                }
              },
              flush(controller) {
                controller.terminate();
              },
            });
            stream = file.readable.pipeThrough(limitedTransform);
          } else {
            // Full remaining file or full file
            stream = file.readable;
          }

          let contentRange: string | undefined;
          if (isPartial) {
            contentRange = `bytes ${start}-${end}/${totalSize}`;
          }

          const status = isPartial ? 206 : 200;

          span.attributes["status_code"] = status;
          span.attributes["content_length"] = contentLength;
          span.attributes["total_size"] = totalSize;
          span.attributes["success"] = true;

          return {
            stream,
            contentLength,
            totalSize,
            contentRange,
            status,
          };
        } catch (e) {
          file.close();
          throw e;
        }
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof Deno.errors.NotFound) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error downloading file from local storage",
          messageKey: "storage.local.download_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  async getFileSize(path: string): Promise<number> {
    try {
      const fullPath = this.getFullPath(path);
      const fileInfo = await Deno.stat(fullPath);

      if (!fileInfo.isFile) {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }

      if (fileInfo.size === 0) {
        throwHttpError("MEDIA.INVALID_FILE");
      }

      return fileInfo.size;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }

      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting file size from local storage",
        messageKey: "storage.local.get_file_size.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { path },
        raw: error,
      });

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    return await traced("LocalStorage.deleteFile", "storage", async (span) => {
      span.attributes["service"] = "local";
      span.attributes["path"] = path;

      try {
        const fullPath = this.getFullPath(path);
        await Deno.remove(fullPath);
        span.attributes["success"] = true;
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof Deno.errors.NotFound) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error deleting file from local storage",
          messageKey: "storage.local.delete_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  async deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void> {
    return await traced("LocalStorage.deleteDirectory", "storage", async (span) => {
      span.attributes["service"] = "local";
      span.attributes["path"] = path;
      span.attributes["recursive"] = options?.recursive ?? false;

      try {
        const fullPath = this.getFullPath(path);

        // Check if directory exists
        try {
          const stat = await Deno.stat(fullPath);
          if (!stat.isDirectory) {
            // Not a directory - this is fine, nothing to delete
            span.attributes["success"] = true;
            span.attributes["note"] = "Path is not a directory";
            return;
          }
        } catch (error) {
          if (error instanceof Deno.errors.NotFound) {
            // Directory doesn't exist - silently succeed
            span.attributes["success"] = true;
            span.attributes["note"] = "Directory does not exist";
            return;
          }
          throw error;
        }

        // Delete directory
        await Deno.remove(fullPath, { recursive: options?.recursive ?? false });
        span.attributes["success"] = true;
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof Deno.errors.NotFound) {
          // Already gone - success
          span.attributes["success"] = true;
          return;
        }

        // Log but don't throw for directory cleanup failures
        // This prevents upload failures due to cleanup issues
        useLogger(LoggerLevels.warn, {
          message: "Failed to delete directory from local storage",
          messageKey: "storage.local.delete_directory.failed",
          section: loggerAppSections.STORAGE,
          details: { path, recursive: options?.recursive, error: error instanceof Error ? error.message : String(error) },
        });

        // Don't throw - directory cleanup failure shouldn't fail the upload
        span.attributes["success"] = true;
        span.attributes["note"] = "Cleanup failed but not throwing";
      }
    });
  }

  async listKeysRecursive(prefix: string): Promise<string[]> {
    const root = this.getFullPath(prefix);
    // Length to slice off dataDirResolved + the path separator, yielding the
    // provider-relative key (e.g. "environment-storage/<env>/documents/x.bin").
    const relOffset = this.dataDirResolved.length + 1;
    const keys: string[] = [];

    const walk = async (absDir: string): Promise<void> => {
      let entries: Deno.DirEntry[];
      try {
        entries = [];
        for await (const e of Deno.readDir(absDir)) entries.push(e);
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) return; // empty subtree
        throw error;
      }
      for (const entry of entries) {
        const abs = `${absDir}/${entry.name}`;
        if (entry.isDirectory) {
          await walk(abs);
        } else if (entry.isFile) {
          keys.push(abs.slice(relOffset));
        }
      }
    };

    try {
      await walk(root);
      return keys;
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      useLogger(LoggerLevels.error, {
        message: "Unexpected error recursively listing keys in local storage",
        messageKey: "storage.local.list_keys_recursive.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { prefix },
        raw: error,
      });
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }
}
