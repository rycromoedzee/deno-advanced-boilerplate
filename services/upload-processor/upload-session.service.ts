/**
 * @file services/upload-processor/upload-session.service.ts
 * @description Service for managing chunked upload sessions in cache
 *
 * This service handles:
 * - Creating and managing upload sessions
 * - Tracking uploaded chunks
 * - Validating chunk uploads
 * - Session cleanup and expiry
 */

import { GlobalCacheService } from "@services/cache/cache.service.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getStorage } from "@services/storage/index.ts";
import { getSessionFolderPath } from "@constants/storage-paths.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import type {
  IChunkMetadata,
  IInitiateUploadRequest,
  IInitiateUploadResponse,
  IUploadChunkResponse,
  IUploadSession,
  IUploadStatusResponse,
} from "@interfaces/chunked-upload.ts";
import {
  calculateOptimalChunkSize,
  calculateTotalChunks,
  CHUNKED_UPLOAD_CONFIG,
  isValidChunkSize,
  UPLOAD_SESSION_STATUS,
} from "@constants/documents/chunked-upload.ts";
import { getTimeNow } from "@utils/shared/index.ts";

/**
 * Service for managing chunked upload sessions
 */
export class UploadSessionService {
  private cache: GlobalCacheService;
  private readonly SESSION_NAMESPACE = "upload_sessions";
  private readonly CHUNK_NAMESPACE = "upload_chunks";

  constructor(cache: GlobalCacheService) {
    this.cache = cache;
  }

  /**
   * Create a new upload session
   */
  async initiateUpload(
    request: IInitiateUploadRequest,
    userId: string,
    environmentId: string,
    maxFileSizeBytes: number = 5 * 1024 * 1024 * 1024,
  ): Promise<IInitiateUploadResponse> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.initiateUpload",
      {
        service: "UploadSessionService",
        method: "initiateUpload",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["environment_id"] = environmentId;
        span.attributes["file_name"] = request.fileName;
        span.attributes["file_size"] = request.fileSize;
        span.attributes["mime_type"] = request.mimeType;

        // Validate file size
        if (request.fileSize <= 0) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        if (request.fileSize > maxFileSizeBytes) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        // Calculate optimal chunk size based on file size and MIME type
        // Server-side calculation takes precedence for media files to ensure
        // efficient range-based seeking (smaller chunks = less data to decrypt per seek)
        const serverOptimalChunkSize = calculateOptimalChunkSize(request.fileSize, request.mimeType);
        const chunkSize = request.chunkSize
          ? Math.min(request.chunkSize, serverOptimalChunkSize) // Don't let client exceed optimal size for this file type
          : serverOptimalChunkSize;

        if (!isValidChunkSize(chunkSize)) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const totalChunks = calculateTotalChunks(request.fileSize, chunkSize);
        const sessionId = generateIdRandom();
        const now = getTimeNow();
        const expiresAt = now + CHUNKED_UPLOAD_CONFIG.SESSION_EXPIRY * 1000;

        span.attributes["session_id"] = sessionId;
        span.attributes["chunk_size"] = chunkSize;
        span.attributes["total_chunks"] = totalChunks;

        const session: IUploadSession = {
          id: sessionId,
          userId,
          environmentId,
          fileName: request.fileName,
          fileSize: request.fileSize,
          mimeType: request.mimeType || "application/octet-stream",
          totalChunks,
          chunkSize,
          uploadedChunks: [],
          status: UPLOAD_SESSION_STATUS.INITIATED,
          metadata: {
            name: request.name,
            description: request.description,
            folderId: request.folderId,
            tags: request.tags,
            customMetadata: request.metadata,
          },
          createdAt: now,
          expiresAt,
          lastActivityAt: now,
        };

        // Store session in cache with TTL
        await this.cache.set(
          this.SESSION_NAMESPACE,
          sessionId,
          session,
          { ttl: CHUNKED_UPLOAD_CONFIG.SESSION_EXPIRY },
        );

        span.attributes["success"] = true;

        return {
          sessionId,
          chunkSize,
          totalChunks,
          expiresAt,
        };
      },
    );
  }

  /**
   * Get upload session by ID
   */
  async getSession(sessionId: string): Promise<IUploadSession | null> {
    return await traced("UploadSessionService.getSession", "cache.get", async (span) => {
      span.attributes["session_id"] = sessionId;

      const session = await this.cache.get<IUploadSession>(
        this.SESSION_NAMESPACE,
        sessionId,
      );

      span.attributes["found"] = session !== null;
      return session;
    });
  }

  /**
   * Get upload session or throw error if not found
   */
  async getSessionOrThrow(sessionId: string): Promise<IUploadSession> {
    const session = await this.getSession(sessionId);
    if (!session) {
      throwHttpError("MEDIA.UPLOAD_SESSION_NOT_FOUND");
    }
    return session;
  }

  /**
   * Update upload session
   */
  async updateSession(session: IUploadSession): Promise<void> {
    return await traced("UploadSessionService.updateSession", "cache.set", async (span) => {
      span.attributes["session_id"] = session.id;
      span.attributes["status"] = session.status;

      // Update last activity timestamp
      session.lastActivityAt = getTimeNow();

      // Calculate remaining TTL (convert ms delta to seconds for cache provider)
      const remainingTtl = Math.ceil((session.expiresAt - getTimeNow()) / 1000);
      if (remainingTtl <= 0) {
        throwHttpError("MEDIA.UPLOAD_SESSION_EXPIRED");
      }

      await this.cache.set(
        this.SESSION_NAMESPACE,
        session.id,
        session,
        { ttl: remainingTtl },
      );

      span.attributes["success"] = true;
    });
  }

  async recordChunkUploadDirect(
    session: IUploadSession,
    chunkIndex: number,
    chunkMetadata: IChunkMetadata,
  ): Promise<IUploadChunkResponse> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.recordChunkUploadDirect",
      {
        service: "UploadSessionService",
        method: "recordChunkUploadDirect",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId: session.id, chunkIndex },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = session.id;
        span.attributes["chunk_index"] = chunkIndex;

        if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        if (session.uploadedChunks.includes(chunkIndex)) {
          span.attributes["already_uploaded"] = true;
          throwHttpError("VALIDATION.DUPLICATE_VALUE");
        }

        session.uploadedChunks.push(chunkIndex);

        if (session.status === UPLOAD_SESSION_STATUS.INITIATED) {
          session.status = UPLOAD_SESSION_STATUS.UPLOADING;
        }

        session.lastActivityAt = getTimeNow();

        // Convert ms delta to seconds for cache provider TTL
        const remainingTtl = Math.ceil((session.expiresAt - getTimeNow()) / 1000);
        if (remainingTtl <= 0) {
          throwHttpError("MEDIA.UPLOAD_SESSION_EXPIRED");
        }

        const [,] = await Promise.all([
          this.cache.set(
            this.SESSION_NAMESPACE,
            session.id,
            session,
            { ttl: remainingTtl },
          ),
          this.cache.set(
            this.CHUNK_NAMESPACE,
            `${session.id}:${chunkIndex}`,
            chunkMetadata,
            { ttl: CHUNKED_UPLOAD_CONFIG.SESSION_EXPIRY },
          ),
        ]);

        const progress = Math.round((session.uploadedChunks.length / session.totalChunks) * 100);
        const isLastChunk = session.uploadedChunks.length === session.totalChunks;

        span.attributes["chunks_uploaded"] = session.uploadedChunks.length;
        span.attributes["progress"] = progress;
        span.attributes["is_last_chunk"] = isLastChunk;
        span.attributes["success"] = true;

        return {
          sessionId: session.id,
          chunkIndex,
          chunksUploaded: session.uploadedChunks.length,
          totalChunks: session.totalChunks,
          progress,
          isLastChunk,
        };
      },
    );
  }

  async recordChunkUpload(
    sessionId: string,
    chunkIndex: number,
    chunkMetadata: IChunkMetadata,
  ): Promise<IUploadChunkResponse> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.recordChunkUpload",
      {
        service: "UploadSessionService",
        method: "recordChunkUpload",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, chunkIndex },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        span.attributes["chunk_index"] = chunkIndex;

        const session = await this.getSessionOrThrow(sessionId);

        if (chunkIndex < 0 || chunkIndex >= session.totalChunks) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        if (session.uploadedChunks.includes(chunkIndex)) {
          span.attributes["already_uploaded"] = true;
        } else {
          session.uploadedChunks.push(chunkIndex);
          session.uploadedChunks.sort((a, b) => a - b);
        }

        if (session.status === UPLOAD_SESSION_STATUS.INITIATED) {
          session.status = UPLOAD_SESSION_STATUS.UPLOADING;
        }

        await this.updateSession(session);

        await this.cache.set(
          this.CHUNK_NAMESPACE,
          `${sessionId}:${chunkIndex}`,
          chunkMetadata,
          { ttl: CHUNKED_UPLOAD_CONFIG.SESSION_EXPIRY },
        );

        const progress = Math.round((session.uploadedChunks.length / session.totalChunks) * 100);
        const isLastChunk = session.uploadedChunks.length === session.totalChunks;

        span.attributes["chunks_uploaded"] = session.uploadedChunks.length;
        span.attributes["progress"] = progress;
        span.attributes["is_last_chunk"] = isLastChunk;
        span.attributes["success"] = true;

        return {
          sessionId,
          chunkIndex,
          chunksUploaded: session.uploadedChunks.length,
          totalChunks: session.totalChunks,
          progress,
          isLastChunk,
        };
      },
    );
  }

  /**
   * Store encryption data in session (called during first chunk upload)
   */
  async storeEncryptionData(
    sessionId: string,
    encryptedDataKey: Uint8Array,
    encryptionMode: "user" | "app",
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.storeEncryptionData",
      {
        service: "UploadSessionService",
        method: "storeEncryptionData",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, encryptionMode },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        span.attributes["encryption_mode"] = encryptionMode;

        const session = await this.getSessionOrThrow(sessionId);

        // Import TextTransformations for base64 encoding
        const { TextTransformations } = await import("@utils/text/index.ts");

        session.encryption = {
          encryptedDataKey: TextTransformations.fromBufferToBase64(encryptedDataKey),
          encryptionMode,
          encryptionKeyBase64: "", // Not storing raw key - retrieve from auth context each time
        };

        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Get upload status/progress
   */
  async getUploadStatus(sessionId: string): Promise<IUploadStatusResponse> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.getUploadStatus",
      {
        service: "UploadSessionService",
        method: "getUploadStatus",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;

        const session = await this.getSessionOrThrow(sessionId);

        // Calculate missing chunks for resume
        const missingChunks: number[] = [];
        for (let i = 0; i < session.totalChunks; i++) {
          if (!session.uploadedChunks.includes(i)) {
            missingChunks.push(i);
          }
        }

        const progress = Math.round((session.uploadedChunks.length / session.totalChunks) * 100);

        span.attributes["chunks_uploaded"] = session.uploadedChunks.length;
        span.attributes["missing_chunks"] = missingChunks.length;
        span.attributes["progress"] = progress;
        span.attributes["status"] = session.status;

        return {
          sessionId,
          status: session.status,
          chunksUploaded: session.uploadedChunks.length,
          totalChunks: session.totalChunks,
          progress,
          missingChunks,
          expiresAt: session.expiresAt,
          errorMessage: session.errorMessage,
          documentId: session.documentId,
        };
      },
    );
  }

  /**
   * Get all chunk metadata for a session
   */
  async getSessionChunks(sessionId: string): Promise<IChunkMetadata[]> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.getSessionChunks",
      {
        service: "UploadSessionService",
        method: "getSessionChunks",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;

        const session = await this.getSessionOrThrow(sessionId);
        const chunks: IChunkMetadata[] = [];

        for (const chunkIndex of session.uploadedChunks) {
          const chunkKey = `${sessionId}:${chunkIndex}`;
          const chunk = await this.cache.get<IChunkMetadata>(
            this.CHUNK_NAMESPACE,
            chunkKey,
          );
          if (chunk) {
            chunks.push(chunk);
          }
        }

        // Sort by chunk index
        chunks.sort((a, b) => a.chunkIndex - b.chunkIndex);

        span.attributes["chunks_retrieved"] = chunks.length;
        span.attributes["success"] = true;

        return chunks;
      },
    );
  }

  /**
   * Mark session as assembling
   */
  async markSessionAssembling(sessionId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.markSessionAssembling",
      {
        service: "UploadSessionService",
        method: "markSessionAssembling",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;

        const session = await this.getSessionOrThrow(sessionId);

        // Validate all chunks are uploaded
        if (session.uploadedChunks.length !== session.totalChunks) {
          throwHttpError("MEDIA.UPLOAD_INCOMPLETE");
        }

        session.status = UPLOAD_SESSION_STATUS.ASSEMBLING;
        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Mark session as completed and store the resulting document ID so status
   * polling clients can retrieve it without a separate DB lookup.
   */
  async markSessionCompleted(sessionId: string, documentId?: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.markSessionCompleted",
      {
        service: "UploadSessionService",
        method: "markSessionCompleted",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, documentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        if (documentId) span.attributes["document_id"] = documentId;

        const session = await this.getSessionOrThrow(sessionId);
        session.status = UPLOAD_SESSION_STATUS.COMPLETED;
        if (documentId) session.documentId = documentId;
        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Store session thumbnail metadata after the encrypted thumbnail has been uploaded to temp storage.
   * Called by POST /upload/chunked/thumbnail/:sessionId.
   */
  async storeSessionThumbnailData(
    sessionId: string,
    thumbnailPath: string,
    thumbnailWidth: number,
    thumbnailHeight: number,
    thumbnailSize: number,
    thumbnailEncryptedKey: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.storeSessionThumbnailData",
      {
        service: "UploadSessionService",
        method: "storeSessionThumbnailData",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, thumbnailPath },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        span.attributes["thumbnail_path"] = thumbnailPath;
        span.attributes["thumbnail_width"] = thumbnailWidth;
        span.attributes["thumbnail_height"] = thumbnailHeight;
        span.attributes["thumbnail_size"] = thumbnailSize;

        const session = await this.getSessionOrThrow(sessionId);
        session.thumbnailPath = thumbnailPath;
        session.thumbnailWidth = thumbnailWidth;
        session.thumbnailHeight = thumbnailHeight;
        session.thumbnailSize = thumbnailSize;
        session.thumbnailEncryptedKey = thumbnailEncryptedKey;
        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Mark session as failed
   */
  async markSessionFailed(sessionId: string, errorMessage: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.markSessionFailed",
      {
        service: "UploadSessionService",
        method: "markSessionFailed",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, errorMessage },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        span.attributes["error_message"] = errorMessage;

        const session = await this.getSessionOrThrow(sessionId);
        session.status = UPLOAD_SESSION_STATUS.FAILED;
        session.errorMessage = errorMessage;
        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Abort/cancel an upload session
   */
  async abortSession(sessionId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.abortSession",
      {
        service: "UploadSessionService",
        method: "abortSession",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;

        const session = await this.getSessionOrThrow(sessionId);
        session.status = UPLOAD_SESSION_STATUS.ABORTED;
        await this.updateSession(session);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Delete session and all associated chunks
   */
  async deleteSession(sessionId: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.deleteSession",
      {
        service: "UploadSessionService",
        method: "deleteSession",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;

        // Delete all chunk metadata
        await this.cache.deletePattern(this.CHUNK_NAMESPACE, `${sessionId}:*`);

        // Delete session
        await this.cache.delete(this.SESSION_NAMESPACE, sessionId);

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Validate that user owns the session
   */
  async validateSessionOwnership(sessionId: string, userId: string): Promise<IUploadSession> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.validateSessionOwnership",
      {
        service: "UploadSessionService",
        method: "validateSessionOwnership",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
        details: { sessionId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["session_id"] = sessionId;
        span.attributes["user_id"] = userId;

        const session = await this.getSessionOrThrow(sessionId);

        if (session.userId !== userId) {
          span.attributes["ownership_valid"] = false;
          throwHttpError("MEDIA.UPLOAD_SESSION_NOT_FOUND");
        }

        span.attributes["ownership_valid"] = true;
        return session;
      },
    );
  }

  /**
   * Cleanup expired sessions (to be called by scheduled job)
   */
  async cleanupExpiredSessions(): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "UploadSessionService.cleanupExpiredSessions",
      {
        service: "UploadSessionService",
        method: "cleanupExpiredSessions",
        section: loggerAppSections.DOCUMENTS_UPLOAD,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const now = getTimeNow();
        const allSessions = await this.cache.getAllFromNamespace(this.SESSION_NAMESPACE);

        let cleanedCount = 0;
        const storage = getStorage();

        for (const [sessionId, entry] of allSessions.entries()) {
          if (!entry.value) continue;

          // Type assertion is safe here as we control what goes into this namespace
          const session = entry.value as unknown as IUploadSession;

          if (session && session.expiresAt < now) {
            // Delete temp-chunks folder from storage before removing cache entry
            const sessionFolderPath = getSessionFolderPath(session.environmentId, sessionId);
            try {
              await storage.deleteDirectory(sessionFolderPath, { recursive: true });
            } catch (storageError) {
              // Best-effort: log but don't block cache cleanup
              await useLogger(LoggerLevels.warn, {
                message: "Failed to delete temp-chunks folder for expired session — cache entry will still be removed",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "upload_session_cleanup_storage_delete_error",
                details: {
                  sessionId,
                  sessionFolderPath,
                  error: storageError instanceof Error ? storageError.message : String(storageError),
                },
              });
            }

            await this.deleteSession(sessionId);
            cleanedCount++;
          }
        }

        span.attributes["sessions_cleaned"] = cleanedCount;
        span.attributes["success"] = true;

        return cleanedCount;
      },
    );
  }
}

/**
 * Singleton instance
 */
let uploadSessionServiceInstance: UploadSessionService | null = null;

/**
 * Get or create upload session service instance
 */
export function getUploadSessionService(cache?: GlobalCacheService): UploadSessionService {
  if (!uploadSessionServiceInstance) {
    if (!cache) {
      throw new Error("Cache service required to initialize UploadSessionService");
    }
    uploadSessionServiceInstance = new UploadSessionService(cache);
  }
  return uploadSessionServiceInstance;
}
