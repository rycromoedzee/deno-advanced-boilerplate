/**
 * @file services/storage/s3.ts
 * @description S3 service module (storage)
 */
import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  Upload,
} from "@deps";
import { envConfig } from "@config/env.ts";
import type { DownloadResult, IUploadResult, StorageProvider, StorageProviderConfig } from "./types.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";

interface AWSS3Error extends Error {
  $metadata?: { httpStatusCode?: number };
  statusCode?: number;
  name: string;
}

interface S3FileInfo {
  name: string;
  key: string;
  isFile: boolean;
  isDirectory: boolean;
  size: number;
  lastModified: Date;
}

export class S3Storage implements StorageProvider {
  private s3Client: S3Client;
  private bucket: string;

  constructor(config?: StorageProviderConfig) {
    const accessKeyId = config?.key ?? envConfig.storage.key;
    const secretAccessKey = config?.secretKey ?? envConfig.storage.secretKey;
    const region = config?.region ?? envConfig.storage.region;
    const bucket = config?.name ?? envConfig.storage.name;
    const endpoint = config?.endpoint ?? envConfig.storage.endpoint;

    if (!accessKeyId || !secretAccessKey || !region || !bucket || !endpoint) {
      throw new Error(
        "S3 storage credentials (STORAGE_ACCESS_KEY, STORAGE_SECRET_KEY, STORAGE_REGION, STORAGE_NAME, STORAGE_ENDPOINT) are not set in environment variables",
      );
    }

    this.s3Client = new S3Client({
      region,
      endpoint,
      forcePathStyle: true,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
    });

    this.bucket = bucket;
  }

  async listFiles(path = "/"): Promise<S3FileInfo[]> {
    const prefix = path === "/" ? "" : path.replace(/^\//, "");

    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);
      const files = response.Contents || [];

      return files.map((file) => ({
        name: file.Key?.split("/").pop() || file.Key || "",
        key: file.Key || "",
        isFile: true,
        isDirectory: false,
        size: file.Size || 0,
        lastModified: file.LastModified || new Date(),
      }));
    } catch (error) {
      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error listing files in S3 storage",
        messageKey: "storage.s3.list_files.unexpected_error",
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
    return await traced("S3Storage.uploadFile", "storage", async (span) => {
      span.attributes["service"] = "s3";
      span.attributes["path"] = path;
      span.attributes["data_type"] = data instanceof Uint8Array ? "buffer" : "stream";

      let upload: Upload | undefined;

      try {
        const key = path.replace(/^\//, "");
        let bytesWritten = 0;

        if (data instanceof Uint8Array) {
          const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: data,
          });
          await this.s3Client.send(command);
          bytesWritten = data.byteLength;
        } else {
          const countingStream = new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
              bytesWritten += chunk.byteLength;
              controller.enqueue(chunk);
            },
          });

          upload = new Upload({
            client: this.s3Client,
            params: {
              Bucket: this.bucket,
              Key: key,
              // @ts-ignore: lib-storage accepts ReadableStream as Body
              Body: data.pipeThrough(countingStream),
            },
            partSize: 5 * 1024 * 1024,
            queueSize: 1,
          });

          await upload.done();
        }

        span.attributes["file_size"] = bytesWritten;
        span.attributes["success"] = true;

        return { bytesWritten };
      } catch (error) {
        if (upload) {
          try {
            await upload.abort();
          } catch { /* best-effort cleanup */ }
        }

        span.attributes["success"] = false;

        if (error instanceof AppHttpException) {
          throw error;
        }

        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorCode = (error as AWSS3Error)?.$metadata?.httpStatusCode || (error as AWSS3Error)?.statusCode;

        if (errorCode === 413 || errorMessage.includes("quota") || errorMessage.includes("EntityTooLarge")) {
          throwHttpError("MEDIA.STORAGE_QUOTA_EXCEEDED");
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error uploading file to S3 storage",
          messageKey: "storage.s3.upload_file.unexpected_error",
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
    return await traced("S3Storage.downloadFile", "storage", async (span) => {
      span.attributes["service"] = "s3";
      span.attributes["path"] = path;
      span.attributes["has_range"] = !!range;

      try {
        const key = path.replace(/^\//, "");

        let rangeHeader: string | undefined;
        if (range) {
          const start = range.start || 0;
          const end = range.end !== undefined ? range.end : "";
          rangeHeader = `bytes=${start}-${end}`;
        }

        const command = new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: rangeHeader,
        });

        const response = await this.s3Client.send(command);

        if (!response.Body) {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        // Properly convert AWS SDK stream to ReadableStream
        const awsStream = response.Body as unknown;
        let stream: ReadableStream<Uint8Array>;

        if (
          typeof awsStream === "object" && awsStream !== null && "transformToWebStream" in awsStream &&
          typeof (awsStream as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream === "function"
        ) {
          // AWS SDK v3 provides transformToWebStream method
          stream = (awsStream as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
        } else if (typeof awsStream === "object" && awsStream !== null && "getReader" in awsStream) {
          // Already a proper ReadableStream
          stream = awsStream as ReadableStream<Uint8Array>;
        } else {
          // Fallback: convert to ReadableStream manually
          stream = new ReadableStream({
            async start(controller) {
              try {
                const streamObj = awsStream as { getReader?: () => unknown; [key: symbol]: unknown };
                let reader: unknown;

                if (typeof streamObj.getReader === "function") {
                  reader = streamObj.getReader();
                } else if (Symbol.asyncIterator in Object(streamObj)) {
                  const asyncIteratorMethod = (streamObj as Record<symbol, unknown>)[Symbol.asyncIterator];
                  if (typeof asyncIteratorMethod === "function") {
                    reader = asyncIteratorMethod.call(streamObj);
                  }
                }

                if (reader && typeof reader === "object" && "read" in reader) {
                  // Stream with .read() method
                  while (true) {
                    const result = await (reader as { read: () => Promise<{ done: boolean; value: Uint8Array }> }).read();
                    if (result.done) break;
                    controller.enqueue(result.value);
                  }
                } else if (reader && Symbol.asyncIterator in Object(reader)) {
                  // Async iterator
                  for await (const chunk of reader as AsyncIterable<Uint8Array>) {
                    controller.enqueue(new Uint8Array(chunk));
                  }
                }
                controller.close();
              } catch (error) {
                controller.error(error);
              }
            },
          });
        }

        const contentLength = response.ContentLength || 0;
        const contentRange = response.ContentRange;
        const status = rangeHeader ? 206 : 200;

        let totalSize: number | undefined;
        if (contentRange) {
          // Parse total size from Content-Range: bytes 0-999/105906176
          const match = contentRange.match(/\/(\d+)$/);
          if (match) {
            totalSize = parseInt(match[1]);
          }
        }

        if (!totalSize && range) {
          totalSize = await this.getFileSize(path);
        }

        span.attributes["status_code"] = status;
        span.attributes["content_length"] = contentLength;
        span.attributes["success"] = true;

        return {
          stream,
          contentLength,
          totalSize,
          contentRange,
          status,
        };
      } catch (error) {
        // Check for file not found errors (404)
        const errorCode = (error as AWSS3Error)?.$metadata?.httpStatusCode || (error as AWSS3Error)?.statusCode;
        const errorName = (error as AWSS3Error)?.name;

        if (errorCode === 404 || errorName === "NoSuchKey" || errorName === "NotFound") {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error downloading file from S3 storage",
          messageKey: "storage.s3.download_file.unexpected_error",
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
      const key = path.replace(/^\//, "");

      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);
      const size = response.ContentLength;

      if (size === undefined) {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }

      if (size === 0) {
        throwHttpError("MEDIA.INVALID_FILE");
      }

      return size;
    } catch (error) {
      // Check for file not found errors (404)
      const errorCode = (error as AWSS3Error)?.$metadata?.httpStatusCode || (error as AWSS3Error)?.statusCode;
      const errorName = (error as AWSS3Error)?.name;

      if (errorCode === 404 || errorName === "NoSuchKey" || errorName === "NotFound") {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }

      if (error instanceof AppHttpException) {
        throw error;
      }

      useLogger(LoggerLevels.error, {
        message: "Unexpected error getting file size from S3 storage",
        messageKey: "storage.s3.get_file_size.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { path },
        raw: error,
      });

      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async deleteFile(path: string): Promise<void> {
    return await traced("S3Storage.deleteFile", "storage", async (span) => {
      span.attributes["service"] = "s3";
      span.attributes["path"] = path;

      try {
        const key = path.replace(/^\//, "");

        const command = new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: key,
        });

        await this.s3Client.send(command);
        span.attributes["success"] = true;
      } catch (error) {
        // Check for file not found errors (404)
        const errorCode = (error as AWSS3Error)?.$metadata?.httpStatusCode || (error as AWSS3Error)?.statusCode;
        const errorName = (error as AWSS3Error)?.name;

        if (errorCode === 404 || errorName === "NoSuchKey" || errorName === "NotFound") {
          throwHttpError("MEDIA.FILE_NOT_FOUND");
        }

        if (error instanceof AppHttpException) {
          throw error;
        }

        useLogger(LoggerLevels.error, {
          message: "Unexpected error deleting file from S3 storage",
          messageKey: "storage.s3.delete_file.unexpected_error",
          section: loggerAppSections.STORAGE,
          details: { path },
          raw: error,
        });

        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  async deleteDirectory(path: string, options?: { recursive?: boolean }): Promise<void> {
    return await traced("S3Storage.deleteDirectory", "storage", async (span) => {
      span.attributes["service"] = "s3";
      span.attributes["path"] = path;
      span.attributes["recursive"] = options?.recursive ?? false;

      try {
        // S3 doesn't have real directories - if we've already deleted all chunk files,
        // there's nothing left. Just succeed for non-recursive.
        if (!options?.recursive) {
          span.attributes["success"] = true;
          span.attributes["note"] = "S3 has no real directories - already clean";
          return;
        }

        // For recursive cleanup (orphaned folders), list and delete any remaining objects
        const prefix = path.replace(/^\//, "").replace(/\/$/, "") + "/";

        const listCommand = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
        });

        const response = await this.s3Client.send(listCommand);
        const objects = response.Contents || [];

        if (objects.length === 0) {
          span.attributes["success"] = true;
          span.attributes["objects_deleted"] = 0;
          return;
        }

        // Delete all objects with this prefix
        const deleteCommand = new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: {
            Objects: objects.map((obj) => ({ Key: obj.Key! })),
          },
        });

        await this.s3Client.send(deleteCommand);
        span.attributes["success"] = true;
        span.attributes["objects_deleted"] = objects.length;
      } catch (error) {
        span.attributes["success"] = false;

        if (error instanceof AppHttpException) {
          throw error;
        }

        // Log but don't throw for directory cleanup failures
        useLogger(LoggerLevels.warn, {
          message: "Failed to delete directory from S3 storage",
          messageKey: "storage.s3.delete_directory.failed",
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
    const p = prefix.replace(/^\//, "");
    const keys: string[] = [];
    let continuationToken: string | undefined;
    try {
      do {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: p,
          MaxKeys: 1000,
          ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
        });
        const response = await this.s3Client.send(command);
        for (const obj of response.Contents ?? []) {
          if (obj.Key) keys.push(obj.Key);
        }
        continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
      } while (continuationToken);
      return keys;
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      useLogger(LoggerLevels.error, {
        message: "Unexpected error recursively listing keys in S3 storage",
        messageKey: "storage.s3.list_keys_recursive.unexpected_error",
        section: loggerAppSections.STORAGE,
        details: { prefix },
        raw: error,
      });
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }
}
