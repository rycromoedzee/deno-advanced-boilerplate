/**
 * @file services/storage/bunny.ts
 * @description Bunny service module (storage)
 */
import { BunnyStorageSDK } from "@deps";
import { envConfig } from "@config/env.ts";
import type { DownloadResult, IStorageFileEntry, IUploadResult, StorageProvider, StorageProviderConfig } from "./types.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";

export class BunnyStorage implements StorageProvider {
  private storageClient: BunnyStorageSDK.StorageZone;
  private bunnyUrl: string;
  private readonly accessKey: string;

  constructor(config?: StorageProviderConfig) {
    const regionName = config?.region ?? envConfig.storage.region;
    const zoneName = config?.name ?? envConfig.storage.name;
    const accessKey = config?.key ?? envConfig.storage.key;
    if (!regionName || !zoneName || !accessKey) {
      throw new Error(
        "Bunny Storage region, zone, or key is not set in environment variables",
      );
    }
    this.accessKey = accessKey;
    const region = BunnyStorageSDK.regions
      .StorageRegion[
        regionName as keyof typeof BunnyStorageSDK.regions.StorageRegion
      ];
    if (!region) {
      throw new Error(`Invalid Bunny Storage region: ${regionName}`);
    }
    this.storageClient = BunnyStorageSDK.zone.connect_with_accesskey(
      region,
      zoneName,
      accessKey,
    );
    this.bunnyUrl = `https://${region}.storage.bunnycdn.com/${zoneName}`;
  }

  async listFiles(path = "/"): Promise<IStorageFileEntry[]> {
    try {
      const files = await BunnyStorageSDK.file.list(this.storageClient, path);
      return files.map((file) => ({
        name: file.objectName,
        isFile: !file.isDirectory,
        isDirectory: file.isDirectory,
        size: file.length,
      }));
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error listing files in Bunny storage",
        messageKey: "storage.bunny.list_files.unexpected_error",
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
    return await traced("BunnyStorage.uploadFile", "storage", async (span) => {
      span.attributes["service"] = "bunny";
      span.attributes["path"] = path;
      span.attributes["data_type"] = data instanceof Uint8Array ? "buffer" : "stream";

      try {
        let bytesWritten = 0;

        if (data instanceof Uint8Array) {
          bytesWritten = data.byteLength;
          // @ts-ignore: BunnyStorageSDK types are incompatible with Deno's type definitions
          await BunnyStorageSDK.file.upload(this.storageClient, path, data);
        } else {
          const countingStream = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesWritten += chunk.byteLength;
              controller.enqueue(chunk);
            },
          });
          const countedStream = data.pipeThrough(countingStream);
          // @ts-ignore: BunnyStorageSDK types are incompatible with Deno's ReadableStream type definition
          await BunnyStorageSDK.file.upload(this.storageClient, path, countedStream);
        }

        span.attributes["file_size"] = bytesWritten;
        span.attributes["success"] = true;

        return { bytesWritten };
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof AppHttpException) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("quota") || errorMessage.includes("413")) {
          throwHttpError("MEDIA.STORAGE_QUOTA_EXCEEDED");
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error uploading file to Bunny storage",
          messageKey: "storage.bunny.upload_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  /**
   * Downloads file with optional HTTP range support for partial content
   * Uses direct HTTP requests to Bunny CDN for better range support
   * @param path - File path in storage
   * @param range - Optional range object { start?: number, end?: number }
   * @returns DownloadResult with stream and metadata
   */
  async downloadFile(
    path: string,
    range?: { start?: number; end?: number },
  ): Promise<DownloadResult> {
    return await traced("BunnyStorage.downloadFile", "storage", async (span) => {
      span.attributes["service"] = "bunny";
      span.attributes["path"] = path;
      span.attributes["has_range"] = !!range;

      try {
        let filePath = path;
        if (filePath.startsWith("/")) {
          filePath = filePath.substring(1);
        }

        const url = `${this.bunnyUrl}/${filePath}`;
        let headers: HeadersInit = {
          "AccessKey": this.accessKey,
        };
        let isPartial = false;

        if (range) {
          const start = range.start || 0;
          const end = range.end !== undefined ? range.end : "";
          headers = { ...headers, "Range": `bytes=${start}-${end}` };
          isPartial = true;
        }

        const response = await fetch(url, {
          method: "GET",
          headers,
        });

        if (response.status === 404) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        if (!response.ok) {
          throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
        }

        const stream = response.body!;
        const contentLength = parseInt(
          response.headers.get("content-length") || "0",
        );
        const contentRange = response.headers.get("content-range") || undefined;

        let totalSize: number | undefined;
        if (isPartial && contentRange) {
          // Parse total size from Content-Range: bytes 0-999/105906176
          const match = contentRange.match(/\/(\d+)$/);
          if (match) {
            totalSize = parseInt(match[1]);
          }
        }

        if (!totalSize && isPartial) {
          totalSize = await this.getFileSize(path);
        }

        const status = isPartial ? 206 : 200;

        span.attributes["status_code"] = status;
        span.attributes["content_length"] = contentLength;
        span.attributes["success"] = true;

        return {
          stream: stream as ReadableStream<Uint8Array>,
          contentLength,
          totalSize,
          contentRange,
          status,
        };
      } catch (error) {
        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error downloading file from Bunny storage",
          messageKey: "storage.bunny.download_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  /**
   * Gets file size using BunnyStorageSDK
   * @param path - File path in storage
   * @returns File size in bytes
   */
  async getFileSize(path: string): Promise<number> {
    try {
      // @ts-ignore: BunnyStorageSDK types are incompatible with Deno's ReadableStream type definition
      const fileInfo = await BunnyStorageSDK.file.get(this.storageClient, path);

      if (!fileInfo || typeof fileInfo.length !== "number") {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }

      if (fileInfo.length === 0) {
        throwHttpError("MEDIA.INVALID_FILE");
      }

      return fileInfo.length;
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting file size from Bunny storage",
        messageKey: "storage.bunny.get_file_size.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { path },
        raw: error,
      });

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    return await traced("BunnyStorage.deleteFile", "storage", async (span) => {
      span.attributes["service"] = "bunny";
      span.attributes["path"] = path;

      try {
        await BunnyStorageSDK.file.remove(this.storageClient, path);
        span.attributes["success"] = true;
      } catch (error) {
        if (error instanceof AppHttpException) {
          throw error;
        }

        // Check for file not found errors
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error deleting file from Bunny storage",
          messageKey: "storage.bunny.delete_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  async deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void> {
    return await traced("BunnyStorage.deleteDirectory", "storage", async (span) => {
      span.attributes["service"] = "bunny";
      span.attributes["path"] = path;
      span.attributes["recursive"] = options?.recursive ?? false;

      try {
        // Ensure path starts with /
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        if (options?.recursive) {
          // Use removeDirectory for recursive deletion
          // @ts-ignore: BunnyStorageSDK types may not include removeDirectory
          await BunnyStorageSDK.file.removeDirectory(this.storageClient, normalizedPath);
        } else {
          // Use remove for non-recursive (empty directory) deletion
          // @ts-ignore: BunnyStorageSDK file.remove can also delete empty directories
          await BunnyStorageSDK.file.remove(this.storageClient, normalizedPath);
        }

        span.attributes["success"] = true;
      } catch (error) {
        span.attributes["success"] = false;

        // Check for not found errors - silently succeed
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (errorMessage.includes("404") || errorMessage.includes("not found")) {
          span.attributes["success"] = true;
          span.attributes["note"] = "Directory does not exist";
          return;
        }

        if (error instanceof AppHttpException) {
          throw error;
        }

        // Log but don't throw for directory cleanup failures
        // This prevents upload failures due to cleanup issues
        useLogger(LoggerLevels.warn, {
          message: "Failed to delete directory from Bunny storage",
          messageKey: "storage.bunny.delete_directory.failed",
          section: loggerAppSections.STORAGE,
          details: { path, recursive: options?.recursive, error: errorMessage },
        });

        // Don't throw - directory cleanup failure shouldn't fail the upload
        span.attributes["success"] = true;
        span.attributes["note"] = "Cleanup failed but not throwing";
      }
    });
  }

  async listKeysRecursive(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    const rootPath = prefix.startsWith("/") ? prefix : `/${prefix}`;

    const listDir = async (dirPath: string): Promise<void> => {
      let entries: { objectName: string; isDirectory: boolean }[];
      try {
        // @ts-ignore: BunnyStorageSDK types are incompatible with Deno's type definitions
        entries = await BunnyStorageSDK.file.list(this.storageClient, dirPath);
      } catch (error) {
        // Only a genuinely absent/empty directory is "nothing to list". Re-throw
        // every OTHER failure (network, 5xx, rate-limit, auth) so callers —
        // notably Phase C purge — retry instead of mistaking a failed listing
        // for an empty prefix (which would drop the purge row and leave a
        // destroyed tenant's bytes on the backup forever). Mirrors deleteFile's
        // not-found detection (bunny.ts deleteFile).
        const msg = error instanceof Error ? error.message : String(error);
        if (msg.includes("404") || msg.includes("not found") || msg.includes("Not Found")) return;
        throw error;
      }
      for (const entry of entries) {
        const childPath = dirPath.endsWith("/") ? `${dirPath}${entry.objectName}` : `${dirPath}/${entry.objectName}`;
        if (entry.isDirectory) {
          await listDir(childPath);
        } else {
          keys.push(childPath.startsWith("/") ? childPath.slice(1) : childPath);
        }
      }
    };

    await listDir(rootPath);
    return keys;
  }
}
