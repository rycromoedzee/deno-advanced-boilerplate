/**
 * @file services/media-stream/media-stream.service.ts
 * @description Service layer for video streaming with database operations
 */

import { eq } from "@deps";
import { FileEncryptionService } from "@services/encryption/file-encryption.service.ts";
import { traced } from "@services/tracing/index.ts";
import { envConfig } from "@config/env.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { parseRangeHeader } from "@utils/streaming/index.ts";
import type { IHashingContext } from "@utils/text/hashing.ts";
import { CHUNKED_UPLOAD_CONFIG } from "@constants/documents/chunked-upload.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

export interface MediaFileMetadata {
  id: string;
  originalName: string;
  mimeType: string;
  originalFileSize: number;
  encryptedFileSize: number;
  folderPath: string;
  userId: string;
  encryptionChunkSize: number;
  contentHash?: string;
  duplicateAllowed?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MediaEncryptionContext {
  userId?: string;
  userEncryptionKey?: Uint8Array;
  appEncryptionKey?: Uint8Array;
  keySource: "user" | "app";
  encryptedMasterKey?: Uint8Array;
}

export interface MediaRangeStreamResponse {
  status: number;
  headers: Record<string, string>;
  body: ReadableStream<Uint8Array>;
}

type ByteRange = {
  start: number;
  end: number;
};

interface CreateRangeStreamOptions {
  rangeHeader: string | null | undefined;
  fileSize: number;
  mimeType: string;
  additionalHeaders?: Record<string, string>;
  getRangeChunk: (range: ByteRange) => Promise<ReadableStream<Uint8Array>>;
}

type BasicFileMetadata = Pick<MediaFileMetadata, "folderPath" | "mimeType" | "originalFileSize" | "originalName">;

function zeroKeyMaterial(key: Uint8Array | null | undefined): void {
  if (key) {
    key.fill(0);
  }
}

export class MediaStreamService {
  /**
   * Get file metadata from database
   */
  static async getFileMetadata(fileId: string): Promise<MediaFileMetadata | null> {
    return await traced("MediaStreamService.getFileMetadata", "service", async (span) => {
      span.attributes["file_id"] = fileId;

      try {
        const db = await getTenantDB();

        const result = await db
          .select()
          .from(tenantTables.storageMetadata)
          .where(eq(tenantTables.storageMetadata.id, fileId))
          .limit(1);

        if (result.length === 0) {
          span.attributes["found"] = false;
          return null;
        }

        span.attributes["found"] = true;
        return result[0] as MediaFileMetadata;
      } catch (error) {
        console.error("Error fetching file metadata:", error);
        throw new Error("Failed to fetch file metadata");
      }
    });
  }

  /**
   * Get decrypted media stream
   */
  static async getDecryptedMediaStream(
    fileMetadata: MediaFileMetadata,
    encryptedMasterKey: Uint8Array,
    encryptionContext: MediaEncryptionContext,
    contextType: IHashingContext,
  ): Promise<ReadableStream> {
    return await traced("MediaStreamService.getDecryptedMediaStream", "service", async (span) => {
      span.attributes["file_id"] = fileMetadata.id;
      span.attributes["key_source"] = encryptionContext.keySource;
      span.attributes["mime_type"] = fileMetadata.mimeType;
      span.attributes["context_type"] = contextType;

      let encryptionKey: Uint8Array | null = null;
      try {
        encryptionKey = this.resolveEncryptionKey(encryptionContext, span);

        const encryptionService = FileEncryptionService;
        const encryptionChunkSize = fileMetadata.encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES;

        const decryptedStream = await encryptionService.decryptWithKey(
          encryptionKey,
          encryptedMasterKey,
          contextType,
          fileMetadata.folderPath,
          encryptionChunkSize,
        );

        if (!decryptedStream) {
          throw new Error("Decrypted stream is null or undefined");
        }

        span.attributes["success"] = true;
        return decryptedStream;
      } catch (error) {
        console.error("Error decrypting media stream:", error);
        if (error instanceof Error) throw error;
        throw new Error(`Failed to decrypt media stream: ${String(error)}`);
      } finally {
        zeroKeyMaterial(encryptionKey);
        zeroKeyMaterial(encryptionContext.userEncryptionKey);
        zeroKeyMaterial(encryptionContext.appEncryptionKey);
      }
    });
  }

  static async createEncryptedRangeStreamResponse(options: {
    rangeHeader: string | null | undefined;
    fileMetadata: Pick<MediaFileMetadata, "folderPath" | "mimeType" | "originalFileSize" | "encryptionChunkSize">;
    encryptionContext: MediaEncryptionContext;
    encryptedMasterKey: Uint8Array;
    hashingContext: IHashingContext;
    additionalHeaders?: Record<string, string>;
  }): Promise<MediaRangeStreamResponse | null> {
    const encryptionKey = this.resolveEncryptionKey(options.encryptionContext);
    const encryptionChunkSize = options.fileMetadata.encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES;

    return await this.createRangeStreamResponse({
      rangeHeader: options.rangeHeader,
      fileSize: options.fileMetadata.originalFileSize,
      mimeType: options.fileMetadata.mimeType,
      additionalHeaders: options.additionalHeaders,
      getRangeChunk: async ({ start, end }) => {
        return await FileEncryptionService.decryptWithKeyAndRange(
          encryptionKey,
          options.encryptedMasterKey,
          options.hashingContext,
          options.fileMetadata.folderPath,
          start,
          end,
          options.fileMetadata.originalFileSize,
          encryptionChunkSize,
        );
      },
    });
  }

  static async createRawMasterKeyRangeStreamResponse(options: {
    rangeHeader: string | null | undefined;
    fileMetadata: BasicFileMetadata & { encryptionChunkSize?: number };
    dataMasterKey: Uint8Array;
    additionalHeaders?: Record<string, string>;
  }): Promise<MediaRangeStreamResponse | null> {
    const encryptionChunkSize = options.fileMetadata.encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES;

    return await this.createRangeStreamResponse({
      rangeHeader: options.rangeHeader,
      fileSize: options.fileMetadata.originalFileSize,
      mimeType: options.fileMetadata.mimeType,
      additionalHeaders: options.additionalHeaders,
      getRangeChunk: async ({ start, end }) => {
        return await FileEncryptionService.decryptWithRawDataMasterKeyAndRange(
          options.dataMasterKey,
          options.fileMetadata.folderPath,
          start,
          end,
          options.fileMetadata.originalFileSize,
          encryptionChunkSize,
        );
      },
    });
  }

  private static async createRangeStreamResponse(options: CreateRangeStreamOptions): Promise<MediaRangeStreamResponse | null> {
    if (!options.rangeHeader) {
      return null;
    }

    const parsedRange = this.parseFirstRange(options.rangeHeader, options.fileSize);

    if (!parsedRange) {
      return null;
    }

    const stream = await options.getRangeChunk(parsedRange);
    const contentLength = parsedRange.end - parsedRange.start + 1;

    const headers: Record<string, string> = {
      "Content-Type": options.mimeType,
      "Content-Length": contentLength.toString(),
      "Content-Range": `bytes ${parsedRange.start}-${parsedRange.end}/${options.fileSize}`,
      "Accept-Ranges": "bytes",
    };

    if (options.additionalHeaders) {
      Object.assign(headers, options.additionalHeaders);
    }

    return {
      status: 206,
      headers,
      body: stream,
    };
  }

  private static parseFirstRange(rangeHeader: string, fileSize: number): ByteRange | null {
    const ranges = parseRangeHeader(rangeHeader, fileSize);

    if (!ranges || ranges.length === 0) {
      return null;
    }

    return ranges[0];
  }

  /**
   * Create new media metadata record
   */
  static async createMediaMetadata(metadata: {
    id: string;
    originalName: string;
    mimeType: string;
    originalFileSize: number;
    encryptedFileSize: number;
    folderPath: string;
    userId: string;
    encryptionChunkSize?: number;
    contentHash?: string;
  }): Promise<MediaFileMetadata> {
    try {
      const db = await getTenantDB();

      const result = await db
        .insert(tenantTables.storageMetadata)
        .values({
          id: metadata.id,
          originalName: metadata.originalName,
          mimeType: metadata.mimeType,
          originalFileSize: metadata.originalFileSize,
          encryptedFileSize: metadata.encryptedFileSize,
          folderPath: metadata.folderPath,
          userId: metadata.userId,
          encryptionChunkSize: metadata.encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
          contentHash: metadata.contentHash,
        })
        .returning();

      if (result.length === 0) {
        throw new Error("Failed to create video metadata record");
      }

      return result[0] as MediaFileMetadata;
    } catch (error) {
      console.error("Error creating video metadata:", error);
      throw new Error("Failed to create video metadata");
    }
  }

  /**
   * List video files for a user
   */
  static async listUserMedia(userId: string, limit = 50, offset = 0): Promise<MediaFileMetadata[]> {
    try {
      const db = await getTenantDB();

      const result = await db
        .select()
        .from(tenantTables.storageMetadata)
        .where(eq(tenantTables.storageMetadata.userId, userId))
        .limit(limit)
        .offset(offset)
        .orderBy(tenantTables.storageMetadata.createdAt);

      return result.filter((file) => file.mimeType.startsWith("video/") || file.mimeType.startsWith("audio/")) as MediaFileMetadata[];
    } catch (error) {
      console.error("Error listing user videos:", error);
      throw new Error("Failed to list user videos");
    }
  }

  private static resolveEncryptionKey(
    encryptionContext: MediaEncryptionContext,
    span?: { attributes: Record<string, unknown> },
  ): Uint8Array {
    switch (encryptionContext.keySource) {
      case "user":
        if (!encryptionContext.userEncryptionKey) {
          if (span) {
            span.attributes["error"] = "user_key_missing";
          }
          throw new Error("User encryption key required but not provided");
        }
        return encryptionContext.userEncryptionKey;

      case "app":
        if (!encryptionContext.appEncryptionKey) {
          return TextTransformations.base64ToBuffer(envConfig.storage.encryptionKey!);
        }
        return encryptionContext.appEncryptionKey;

      default:
        throwHttpError("ENCRYPTION.INVALID_KEY");
        throw new Error("Invalid key source");
    }
  }
}
