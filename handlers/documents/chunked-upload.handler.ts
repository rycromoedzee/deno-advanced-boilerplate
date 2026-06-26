/**
 * @file handlers/documents/chunked-upload.handler.ts
 * @description Handlers for chunked file upload operations
 */

import { and, createHash, eq, Imagescript, RouteHandler } from "@deps";
import { getAuthContext } from "@utils/auth/context.ts";
import { getTraceContext, traced } from "@services/tracing/index.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { getStorage } from "@services/storage/index.ts";
import {
  completeStoragePathForChunk,
  completeStoragePathForSessionThumbnail,
  completeStoragePathForThumbnail,
  extractSessionFolderPath,
} from "@constants/storage-paths.ts";
import { getUploadSessionService } from "@services/upload-processor/upload-session.service.ts";
import { ChunkAssemblerService } from "@services/upload-processor/chunk-assembler.service.ts";
import { getDocumentCommentService } from "@services/documents-comments/index.ts";
import { getDocumentUploadService } from "@services/documents/index.ts";
import type { IChunkMetadata } from "@interfaces/chunked-upload.ts";
import { detectMimeTypeFromBytes, getMimeTypeFromExtension, isMimeTypeSupported } from "@utils/shared/index.ts";
import { validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";
import { type ISharedUser } from "@models/documents/chunked-upload.model.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getDocumentSharingService } from "@services/documents-sharing/index.ts";
import {
  abortChunkedUploadRoute,
  completeChunkedUploadRoute,
  getUploadStatusRoute,
  initiateChunkedUploadRoute,
  streamChunkedUploadRoute,
  uploadChunkRoute,
  uploadSessionThumbnailRoute,
} from "@routes/documents/chunked-upload.route.ts";
import { broadcastChunkedUploadEvent, createChunkedUploadSSEStream } from "@services/upload-processor/sse-chunked-upload.service.ts";
import { getCache } from "@services/cache/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";

import { DataEncryptionHelperService } from "@services/encryption/data-encryption.helper.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { getEncryptPool } from "@services/workers/index.ts";

/**
 * Handler for POST /api/documents/upload/chunked/initiate
 * Initiates a new chunked upload session
 */
export const initiateChunkedUploadHandler: RouteHandler<typeof initiateChunkedUploadRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId, environmentId } = getAuthContext(c);
    const request = c.req.valid("json");

    // Auto-detect MIME type from filename if not provided
    const mimeType = request.mimeType || (() => {
      const extension = request.fileName.includes(".") ? request.fileName.substring(request.fileName.lastIndexOf(".")) : "";
      return getMimeTypeFromExtension(extension);
    })();

    traceService.addBreadcrumb("handler", "Initiating chunked upload", "info", {
      fileName: request.fileName,
      fileSize: request.fileSize,
      mimeType,
      mimeTypeSource: request.mimeType ? "client" : "auto-detected",
    });

    // Get singleton cache instance and session service
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Create upload session
    const response = await sessionService.initiateUpload(
      {
        ...request,
        mimeType,
        description: request.description ?? undefined,
        folderId: request.folderId ?? undefined,
      },
      userId,
      environmentId,
    );

    traceService.addBreadcrumb("handler", "Chunked upload session created", "info", {
      sessionId: response.sessionId,
      totalChunks: response.totalChunks,
    });

    return c.json(response, 200);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to initiate chunked upload",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "initiate_chunked_upload_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for POST /api/documents/upload/chunked/chunk
 * Uploads a single chunk
 */
export const uploadChunkHandler: RouteHandler<typeof uploadChunkRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId } = getAuthContext(c);
    const { sessionId, chunkIndex } = c.req.valid("query");

    traceService.addBreadcrumb("handler", "Uploading chunk", "info", {
      sessionId,
      chunkIndex,
    });

    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    const [session, chunkData] = await Promise.all([
      sessionService.validateSessionOwnership(sessionId, userId),
      traced(
        "UploadChunkHandler.readRequestBody",
        "handler",
        async (span) => {
          span.attributes.chunk_index = chunkIndex;
          const data = await c.req.arrayBuffer();
          if (!data || data.byteLength === 0) {
            throwHttpError("UPLOAD.CHUNK_DATA_REQUIRED");
          }
          span.attributes.bytes_read = data.byteLength;
          return new Uint8Array(data);
        },
      ),
    ]);

    const isLastChunk = chunkIndex === session.totalChunks - 1;
    if (!isLastChunk && chunkData.length !== session.chunkSize) {
      throwHttpErrorWithCustomMessage(
        "COMMON.BAD_REQUEST",
        `Invalid chunk size: expected ${session.chunkSize}, got ${chunkData.length}`,
      );
    }

    if (chunkIndex === 0 && session.mimeType) {
      const magicMimeType = detectMimeTypeFromBytes(chunkData);
      if (magicMimeType && !isMimeTypeSupported(magicMimeType)) {
        throwHttpErrorWithCustomMessage(
          "COMMON.BAD_REQUEST",
          `Unsupported file type: ${magicMimeType}`,
        );
      }
    }

    const storageService = getStorage();

    const hasher = createHash("sha256");
    hasher.update(chunkData);
    const chunkHash = hasher.digest("hex");

    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);

    let encryptedChunkData: Uint8Array;

    if (chunkIndex === 0) {
      const { DataEncryptionHelperService } = await import("@services/encryption/data-encryption.helper.ts");
      const encryptionResult = await DataEncryptionHelperService.encryptDataWithKey(
        keyDetails.key,
        chunkData,
      );

      encryptedChunkData = encryptionResult.data;

      const { TextTransformations } = await import("@utils/text/index.ts");
      session.encryption = {
        encryptedDataKey: TextTransformations.fromBufferToBase64(encryptionResult.encryptedMasterKey),
        encryptionMode: keyDetails.type,
        encryptionKeyBase64: "",
      };

      traceService.addBreadcrumb("handler", "First chunk encrypted and data key generated", "info", {
        encryptionMode: keyDetails.type,
        encryptedSize: encryptedChunkData.length,
        originalSize: chunkData.length,
      });
    } else {
      if (!session.encryption?.encryptedDataKey) {
        throwHttpError("UPLOAD.ENCRYPTION_DATA_MISSING");
      }

      const { TextTransformations } = await import("@utils/text/index.ts");
      const { useSymmetricDecrypt } = await import("@services/encryption/encryption.helper.ts");

      const encryptedDataKey = TextTransformations.base64ToBuffer(session.encryption!.encryptedDataKey);

      const dataMasterKey = await useSymmetricDecrypt({
        key: keyDetails.key,
        data: encryptedDataKey,
      });

      // Offload the bulk chunk-body encryption to a dedicated worker thread so
      // the main event loop stays responsive during large uploads. The worker
      // produces the identical [nonce | ciphertext | tag] wire format as
      // useSymmetricEncryptWithCryptoKey, so seekable-chunk offsets are unchanged.
      // NOTE: the worker transfers (consumes) both buffers — pass copies and do
      // not read chunkData/dataMasterKey afterwards. chunkData was already hashed
      // above, so it is safe to hand off here.
      encryptedChunkData = await getEncryptPool().encrypt(chunkData, dataMasterKey);

      // Zero the raw data master key from memory once encryption is dispatched.
      dataMasterKey.fill(0);

      traceService.addBreadcrumb("handler", "Chunk encrypted on worker thread", "info", {
        chunkIndex,
        encryptedSize: encryptedChunkData.length,
        originalSize: chunkData.length,
      });
    }

    const storagePath = completeStoragePathForChunk(
      session.environmentId,
      sessionId,
      chunkIndex,
    );

    await storageService.uploadFile(storagePath, encryptedChunkData);

    if (!session.contentTracking) {
      session.contentTracking = {
        originalChunkPaths: [],
        totalBytes: 0,
      };
    }
    session.contentTracking.totalBytes += chunkData.length;

    if (session.contentTracking.totalBytes > session.fileSize) {
      await storageService.deleteFile(storagePath);
      throwHttpErrorWithCustomMessage(
        "COMMON.BAD_REQUEST",
        `Cumulative chunk size (${session.contentTracking.totalBytes} bytes) exceeds declared file size (${session.fileSize} bytes)`,
      );
    }

    traceService.addBreadcrumb("handler", "Chunk hashed in memory", "info", {
      chunkIndex,
      originalSize: chunkData.length,
      totalBytes: session.contentTracking.totalBytes,
      chunkHash,
    });

    const chunkMetadata: IChunkMetadata = {
      sessionId,
      chunkIndex,
      size: encryptedChunkData.length,
      storagePath,
      uploadedAt: getTimeNow(),
      checksum: chunkHash,
    };

    const response = await sessionService.recordChunkUploadDirect(
      session,
      chunkIndex,
      chunkMetadata,
    );

    traceService.addBreadcrumb("handler", "Encrypted chunk uploaded successfully", "info", {
      chunkIndex,
      progress: response.progress,
      isLastChunk: response.isLastChunk,
    });

    return c.json(response, 200);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to upload chunk",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "upload_chunk_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for GET /api/documents/upload/chunked/status/:sessionId
 * Gets upload progress and status
 */
export const getUploadStatusHandler: RouteHandler<typeof getUploadStatusRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId } = getAuthContext(c);
    const { sessionId } = c.req.valid("param");

    traceService.addBreadcrumb("handler", "Getting upload status", "info", {
      sessionId,
    });

    // Get singleton cache instance and session service
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Validate session ownership
    await sessionService.validateSessionOwnership(sessionId, userId);

    // Get status
    const status = await sessionService.getUploadStatus(sessionId);

    traceService.addBreadcrumb("handler", "Upload status retrieved", "info", {
      status: status.status,
      progress: status.progress,
    });

    return c.json(status, 200);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to get upload status",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "get_upload_status_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for POST /api/documents/upload/chunked/complete/:sessionId
 * Completes the chunked upload by assembling chunks and creating document
 */
export const completeChunkedUploadHandler: RouteHandler<typeof completeChunkedUploadRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId, environmentId } = getAuthContext(c);
    const { sessionId } = c.req.valid("param");
    const requestBody = c.req.valid("json") || {};

    traceService.addBreadcrumb("handler", "Completing chunked upload", "info", {
      sessionId,
      hasRequestBody: Object.keys(requestBody).length > 0,
    });

    // Get singleton cache instance and session service
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Validate session ownership
    const session = await sessionService.validateSessionOwnership(sessionId, userId);

    // Verify chunks are already encrypted
    if (!session.encryption?.encryptedDataKey) {
      throwHttpError("UPLOAD.ENCRYPTION_DATA_MISSING");
    }

    // Parse and validate tags if provided
    const tags: string[] = requestBody.tags || session.metadata?.tags || [];
    if (requestBody.tags && !Array.isArray(requestBody.tags)) {
      throwHttpError("UPLOAD.TAGS_NOT_ARRAY");
    }

    // Parse and validate metadata if provided
    const metadata: Record<string, unknown> = requestBody.metadata || session.metadata?.customMetadata || {};
    if (requestBody.metadata) {
      if (typeof requestBody.metadata !== "object" || requestBody.metadata === null || Array.isArray(requestBody.metadata)) {
        throwHttpError("UPLOAD.METADATA_NOT_OBJECT");
      }
    }

    // Parse and validate shared users if provided
    const sharedUsers: ISharedUser[] = requestBody.sharedUsers || [];
    if (requestBody.sharedUsers && !Array.isArray(requestBody.sharedUsers)) {
      throwHttpError("UPLOAD.SHARED_USERS_NOT_ARRAY");
    }

    // Get initial comment if provided (only from completion request)
    const initialComment = requestBody.initialComment || null;

    // Security validation for user-provided inputs
    const inputsToValidate: Record<string, string> = {};
    const name = requestBody.name ?? session.metadata?.name ?? session.fileName;
    const description = requestBody.description ?? session.metadata?.description ?? null;
    const folderId = requestBody.folderId ?? session.metadata?.folderId ?? null;

    if (name) inputsToValidate.name = name;
    if (description) inputsToValidate.description = description;
    if (folderId) inputsToValidate.folderId = folderId;
    if (requestBody.tags) inputsToValidate.tags = JSON.stringify(requestBody.tags);
    if (requestBody.metadata) inputsToValidate.metadata = JSON.stringify(requestBody.metadata);
    if (requestBody.sharedUsers) inputsToValidate.sharedUsers = JSON.stringify(requestBody.sharedUsers);
    if (initialComment) inputsToValidate.initialComment = initialComment;

    const threatsDetected = await validateAndLogSecurityThreats(c, inputsToValidate);
    if (threatsDetected) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    // Validate shared users if provided
    if (sharedUsers.length > 0) {
      const tenantDb = await getTenantDB();

      for (const sharedUser of sharedUsers) {
        const [user] = await tenantDb
          .select({ userId: tenantTables.userProfiles.userId })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.userId, sharedUser.userId))
          .limit(1);

        if (!user) {
          throwHttpErrorWithCustomMessage(
            "COMMON.BAD_REQUEST",
            `User ${sharedUser.userId} not found or not in the same environment`,
          );
        }

        // Validate permission level
        const permissionLevel = sharedUser.permissionLevel as string;
        if (!(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as string[]).includes(permissionLevel)) {
          throwHttpErrorWithCustomMessage(
            "COMMON.BAD_REQUEST",
            `Invalid permission level: ${sharedUser.permissionLevel}`,
          );
        }

        // Cannot share with permission higher than SHARE level
        if (permissionLevel === DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN) {
          throwHttpError("UPLOAD.ADMIN_PERMISSION_FORBIDDEN");
        }
      }

      traceService.addBreadcrumb("handler", "Shared users validated", "info", {
        sharedUsersCount: sharedUsers.length,
      });
    }

    traceService.addBreadcrumb("handler", "Metadata validated", "info", {
      hasName: !!name,
      hasDescription: !!description,
      hasFolderId: !!folderId,
      tagsCount: tags.length,
      hasMetadata: Object.keys(metadata).length > 0,
      sharedUsersCount: sharedUsers.length,
    });

    // Mark session as assembling and return 202 Accepted immediately.
    // The entire assembly pipeline (chunk downloads, upload to storage, DB transaction,
    // sharing, comments, cleanup) runs as a background task.
    // Clients poll GET /status/:sessionId to track progress; documentId is surfaced
    // in the status response once status becomes "completed".
    await sessionService.markSessionAssembling(sessionId);

    // Broadcast "assembling" SSE event to any already-connected subscribers
    broadcastChunkedUploadEvent(sessionId, "assembling", { status: "assembling" });

    traceService.addBreadcrumb("handler", "Assembly queued — returning 202", "info", {
      sessionId,
    });

    // Capture everything needed for the background task before the handler returns.
    // We snapshot all closed-over variables so nothing is retained from the request context.
    const backgroundSession = session;
    const backgroundRequestBody = requestBody;
    const backgroundTags = tags;
    const backgroundMetadata = metadata;
    const backgroundSharedUsers = sharedUsers;
    const backgroundInitialComment = initialComment;
    const backgroundName = name;
    const backgroundDescription = description;
    const backgroundFolderId = folderId;

    // Resolve encryption key before returning 202 so the background task
    // does not depend on the request context (which may be invalidated).
    let ownerUserMasterKey: Uint8Array | undefined = undefined;
    if (backgroundSession.encryption!.encryptionMode === "user") {
      try {
        const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
        ownerUserMasterKey = keyDetails.key;
      } catch (keyError) {
        await useLogger(LoggerLevels.warn, {
          message: "Failed to get encryption key for permission inheritance in chunked upload",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "chunked_upload_encryption_key_error",
          details: { error: keyError instanceof Error ? keyError.message : String(keyError) },
        });
      }
    }

    Promise.resolve().then(async () => {
      try {
        // Get all chunk metadata
        const chunks = await sessionService.getSessionChunks(sessionId);

        // Run hash calculation and chunk assembly in parallel
        const contentHashPromise = (() => {
          const hasher = createHash("sha256");
          const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);
          for (const chunk of sortedChunks) {
            if (chunk.checksum) hasher.update(chunk.checksum);
          }
          const hash = hasher.digest("hex");
          return hash;
        })();

        const [contentHash, assemblyResult] = await Promise.all([
          contentHashPromise,
          ChunkAssemblerService.assembleChunks(backgroundSession, chunks),
        ]);

        const encryptedDataKey = TextTransformations.base64ToBuffer(backgroundSession.encryption!.encryptedDataKey);

        // For chunked uploads, use client-provided metadata instead of server-side extraction
        // to avoid memory issues with large files.
        //
        // FRONTEND INTEGRATION: For video/audio files, the frontend can extract metadata
        // using browser APIs (HTMLVideoElement, HTMLAudioElement) and include it in the
        // 'metadata' field when calling /upload/chunked/initiate or /upload/chunked/complete.
        //
        // Example metadata structure for videos:
        // {
        //   videoMetadata: {
        //     duration: 120,        // seconds
        //     width: 1920,          // pixels
        //     height: 1080,         // pixels
        //     videoCodec: "h264",
        //     audioCodec: "aac",
        //     frameRate: 30,
        //     audioBitrate: 128000,
        //     videobitrate: 5000000
        //   }
        // }
        const extractedMetadata = ((backgroundRequestBody.metadata?.videoMetadata ||
          backgroundSession.metadata?.customMetadata?.videoMetadata) ?? {}) as Record<string, unknown>;

        const documentUploadService = getDocumentUploadService();

        const uploadMetadata = {
          name: backgroundName,
          description: backgroundDescription,
          folderId: backgroundFolderId,
          mimeType: backgroundSession.mimeType,
          fileSize: backgroundSession.fileSize,
          tags: backgroundTags,
          metadata: backgroundMetadata,
        };

        // NOTE: Thumbnail generation via server-side extraction is disabled for chunked uploads
        // to prevent memory issues with large files. Use POST /upload/chunked/thumbnail/:sessionId
        // before calling complete to attach a client-generated thumbnail.
        const document = await documentUploadService.processPreEncryptedUpload(
          assemblyResult.fileStream,
          uploadMetadata,
          userId,
          encryptedDataKey,
          backgroundSession.encryption!.encryptionMode,
          environmentId,
          backgroundSession.chunkSize,
          extractedMetadata,
          contentHash,
          ownerUserMasterKey,
        );

        // Apply session thumbnail if one was uploaded before complete
        traceService.addBreadcrumb("handler", "Checking for session thumbnail", "info", {
          sessionId,
          hasThumbnailPath: !!backgroundSession.thumbnailPath,
          thumbnailPath: backgroundSession.thumbnailPath,
          documentId: document.id,
        });

        if (backgroundSession.thumbnailPath) {
          try {
            const tenantDb = await getTenantDB(environmentId);
            const storage = getStorage();

            traceService.addBreadcrumb("handler", "Downloading thumbnail from temp storage", "info", {
              thumbnailPath: backgroundSession.thumbnailPath,
              documentId: document.id,
            });

            // Fetch document with storage metadata to get storageMetadataId
            const [docRecord] = await tenantDb
              .select({ storageMetadataId: tenantTables.documents.storageMetadataId })
              .from(tenantTables.documents)
              .where(eq(tenantTables.documents.id, document.id))
              .limit(1);

            traceService.addBreadcrumb("handler", "Document storage metadata fetched", "info", {
              documentId: document.id,
              storageMetadataId: docRecord?.storageMetadataId,
            });

            if (docRecord?.storageMetadataId) {
              // Download the encrypted thumbnail from temp storage
              const downloadResult = await storage.downloadFile(backgroundSession.thumbnailPath);
              if (downloadResult?.stream) {
                const reader = downloadResult.stream.getReader();
                const parts: Uint8Array[] = [];
                let totalLen = 0;
                while (true) {
                  const { done, value } = await reader.read();
                  if (done) break;
                  parts.push(value);
                  totalLen += value.length;
                }
                reader.releaseLock();
                const encryptedThumbnailBytes = new Uint8Array(totalLen);
                let off = 0;
                for (const p of parts) {
                  encryptedThumbnailBytes.set(p, off);
                  off += p.length;
                }

                // Move thumbnail to final path (storageMetadataId-based)
                const finalThumbnailPath = completeStoragePathForThumbnail(environmentId, docRecord.storageMetadataId);

                traceService.addBreadcrumb("handler", "Uploading thumbnail to final storage path", "info", {
                  finalThumbnailPath,
                  documentId: document.id,
                  storageMetadataId: docRecord.storageMetadataId,
                  thumbnailSize: encryptedThumbnailBytes.length,
                });

                await storage.uploadFile(finalThumbnailPath, encryptedThumbnailBytes);

                traceService.addBreadcrumb("handler", "Thumbnail uploaded to final path, updating storage metadata", "info", {
                  finalThumbnailPath,
                  documentId: document.id,
                });

                // Update storage metadata with thumbnail path and dimensions only
                // The encryption key is stored in documentsDataKeys.thumbnailEncryptedMasterKey (not here)
                await tenantDb.update(tenantTables.storageMetadata)
                  .set({
                    thumbnailPath: finalThumbnailPath,
                    thumbnailSize: backgroundSession.thumbnailSize ?? null,
                    thumbnailWidth: backgroundSession.thumbnailWidth ?? null,
                    thumbnailHeight: backgroundSession.thumbnailHeight ?? null,
                  })
                  .where(eq(tenantTables.storageMetadata.id, docRecord.storageMetadataId));

                traceService.addBreadcrumb("handler", "Storage metadata updated with thumbnail info", "info", {
                  documentId: document.id,
                  storageMetadataId: docRecord.storageMetadataId,
                  thumbnailPath: finalThumbnailPath,
                });

                // Store the thumbnail encrypted key in all APP_CONTROLLED keys for this document
                // For APP_CONTROLLED encryption, the same encrypted thumbnail key works for all users
                // (owner and all shared users) since they share the same app encryption key.
                // For USER_CONTROLLED rows (enhanced encryption), sharing flow handles per-user wrapping.
                if (backgroundSession.thumbnailEncryptedKey) {
                  const { TextTransformations: TT } = await import("@utils/text/index.ts");
                  const thumbnailEncryptedMasterKeyBytes = TT.base64ToBuffer(backgroundSession.thumbnailEncryptedKey);

                  // Update all non-public-share, APP_CONTROLLED rows (owner + all shared users)
                  await tenantDb.update(tenantTables.documentsDataKeys)
                    .set({
                      thumbnailEncryptedMasterKey: thumbnailEncryptedMasterKeyBytes,
                    })
                    .where(
                      and(
                        eq(tenantTables.documentsDataKeys.documentId, document.id),
                        eq(tenantTables.documentsDataKeys.isActive, true),
                        eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
                        eq(tenantTables.documentsDataKeys.isPublicShare, false),
                      ),
                    );

                  // For the owner's USER_CONTROLLED row (if enhanced encryption enabled),
                  // update their row specifically since the key is wrapped with their master key
                  await tenantDb.update(tenantTables.documentsDataKeys)
                    .set({
                      thumbnailEncryptedMasterKey: thumbnailEncryptedMasterKeyBytes,
                    })
                    .where(
                      and(
                        eq(tenantTables.documentsDataKeys.documentId, document.id),
                        eq(tenantTables.documentsDataKeys.userId, userId),
                        eq(tenantTables.documentsDataKeys.isActive, true),
                        eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED),
                      ),
                    );

                  // For ASYMMETRIC shared user rows (permission inheritance), re-encrypt
                  // the thumbnail key with each recipient's public key using owner's master key
                  if (ownerUserMasterKey) {
                    try {
                      const asymmetricRows = await tenantDb
                        .select({
                          id: tenantTables.documentsDataKeys.id,
                          userId: tenantTables.documentsDataKeys.userId,
                        })
                        .from(tenantTables.documentsDataKeys)
                        .where(
                          and(
                            eq(tenantTables.documentsDataKeys.documentId, document.id),
                            eq(tenantTables.documentsDataKeys.isActive, true),
                            eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC),
                            eq(tenantTables.documentsDataKeys.isPublicShare, false),
                          ),
                        );

                      if (asymmetricRows.length > 0) {
                        const { getUserAsymmetricKeysService } = await import("@services/user/index.ts");
                        const { getEncryptionKeySharingService } = await import("@services/encryption/singletons.ts");
                        const asymmetricKeysService = getUserAsymmetricKeysService();
                        const keySharingService = getEncryptionKeySharingService();

                        for (const row of asymmetricRows) {
                          if (!row.userId) continue;
                          try {
                            const recipientPublicKey = await asymmetricKeysService.getPublicKey(row.userId);
                            if (!recipientPublicKey) continue;

                            const eciesEncryptedThumbnailKey = await keySharingService.shareDataMasterKeyAsymmetric(
                              thumbnailEncryptedMasterKeyBytes,
                              ownerUserMasterKey,
                              recipientPublicKey,
                            );

                            await tenantDb.update(tenantTables.documentsDataKeys)
                              .set({ thumbnailEncryptedMasterKey: eciesEncryptedThumbnailKey })
                              .where(eq(tenantTables.documentsDataKeys.id, row.id));
                          } catch (asymError) {
                            await useLogger(LoggerLevels.warn, {
                              message: "Failed to propagate thumbnail key to asymmetric shared user in chunked upload",
                              section: loggerAppSections.DOCUMENTS,
                              messageKey: "chunked_upload_thumbnail_asymmetric_share_failed",
                              details: {
                                documentId: document.id,
                                recipientUserId: row.userId,
                                error: asymError instanceof Error ? asymError.message : String(asymError),
                              },
                            });
                          }
                        }
                      }
                    } catch (asymPropError) {
                      await useLogger(LoggerLevels.warn, {
                        message: "Failed to propagate thumbnail key to asymmetric shared users in chunked upload",
                        section: loggerAppSections.DOCUMENTS,
                        messageKey: "chunked_upload_thumbnail_asymmetric_propagation_failed",
                        details: {
                          documentId: document.id,
                          error: asymPropError instanceof Error ? asymPropError.message : String(asymPropError),
                        },
                      });
                    }
                  }
                }

                // Cleanup the temp session thumbnail blob
                await storage.deleteFile(backgroundSession.thumbnailPath).catch(() => {});

                traceService.addBreadcrumb("handler", "Session thumbnail successfully applied to document", "info", {
                  documentId: document.id,
                  finalThumbnailPath,
                });
              } else {
                traceService.addBreadcrumb("handler", "WARNING: Document storageMetadataId is null - cannot apply thumbnail", "error", {
                  documentId: document.id,
                });
              }
            }
          } catch (thumbError) {
            await useLogger(LoggerLevels.warn, {
              message: "Failed to apply session thumbnail to document — document creation succeeded",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "chunked_upload_thumbnail_apply_error",
              details: {
                documentId: document.id,
                thumbnailPath: backgroundSession.thumbnailPath,
                error: thumbError instanceof Error ? thumbError.message : String(thumbError),
              },
            });
          }
        } else {
          traceService.addBreadcrumb("handler", "No session thumbnail found - skipping thumbnail application", "info", {
            sessionId,
            documentId: document.id,
          });
        }

        // Share document with specified users if provided
        if (backgroundSharedUsers.length > 0) {
          try {
            const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
            const sharingService = getDocumentSharingService();

            for (const sharedUser of backgroundSharedUsers) {
              const permissionLevel = sharedUser.permissionLevel as string;
              await sharingService.shareWithUsers(
                document.id,
                [sharedUser.userId],
                permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
                userId,
                keyDetails.key,
              );
            }
          } catch (error) {
            await useLogger(LoggerLevels.error, {
              message: "Failed to share document with users after chunked upload",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "chunked_upload_share_error",
              details: { documentId: document.id, error: error instanceof Error ? error.message : String(error) },
            });
          }
        }

        // Create initial comment if provided
        if (backgroundInitialComment) {
          try {
            const commentService = getDocumentCommentService();
            await commentService.createComment(document.id, { content: backgroundInitialComment }, userId);
          } catch (error) {
            await useLogger(LoggerLevels.error, {
              message: "Failed to create initial comment after chunked upload",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "chunked_upload_initial_comment_error",
              details: { documentId: document.id, error: error instanceof Error ? error.message : String(error) },
            });
          }
        }

        // Broadcast "completed" SSE event — documentId lets the client skip polling
        broadcastChunkedUploadEvent(sessionId, "completed", { documentId: document.id, status: "completed" });

        // Cleanup and finalize session in parallel — all in background
        const sessionFolderPath = assemblyResult.tempChunkPaths.length > 0
          ? extractSessionFolderPath(assemblyResult.tempChunkPaths[0])
          : "";
        const legacyChunkPaths = backgroundSession.contentTracking?.originalChunkPaths ?? [];

        await Promise.all([
          ChunkAssemblerService.cleanupChunksAndFolder(assemblyResult.tempChunkPaths, sessionFolderPath).then(() => {
            if (legacyChunkPaths.length > 0) {
              return ChunkAssemblerService.cleanupChunks(legacyChunkPaths);
            }
          }),
          // Store documentId in session so status polling can return it, then delete session
          sessionService.markSessionCompleted(sessionId, document.id).then(() => sessionService.deleteSession(sessionId)),
        ]);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);

        // Mark session as failed so the client's status poll reflects the error
        try {
          await sessionService.markSessionFailed(sessionId, errorMsg);
        } catch (_) { /* best-effort */ }

        // Broadcast "failed" SSE event
        broadcastChunkedUploadEvent(sessionId, "failed", { errorMessage: errorMsg, status: "failed" });

        await useLogger(LoggerLevels.error, {
          message: "Background assembly failed after chunked upload complete",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "complete_chunked_upload_background_error",
          details: { sessionId, error: errorMsg },
        });
      }
    });

    return c.json({ sessionId, status: "assembling" as const }, 202);
  } catch (error) {
    // Try to mark session as failed
    try {
      const cache = await getCache();
      const sessionService = getUploadSessionService(cache);
      const { sessionId } = c.req.valid("param");
      await sessionService.markSessionFailed(
        sessionId,
        error instanceof Error ? error.message : String(error),
      );
    } catch (_cleanupError) {
      // Ignore cleanup errors
    }

    await useLogger(LoggerLevels.error, {
      message: "Failed to complete chunked upload",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "complete_chunked_upload_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for POST /api/documents/upload/chunked/thumbnail/:sessionId
 * Accepts an encrypted thumbnail before the complete endpoint is called (Option A).
 * Stores the encrypted thumbnail in the session's temp-chunks folder and records
 * metadata in the session. The background assembly job applies it after document creation.
 */
export const uploadSessionThumbnailHandler: RouteHandler<typeof uploadSessionThumbnailRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId, environmentId } = getAuthContext(c);
    const { sessionId } = c.req.valid("param");

    traceService.addBreadcrumb("handler", "Session thumbnail upload requested", "info", { sessionId });

    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Validate session ownership
    await sessionService.validateSessionOwnership(sessionId, userId);

    // Read thumbnail bytes from request body
    const thumbnailData = await c.req.arrayBuffer();

    const MAX_THUMBNAIL_SIZE = 1024 * 1024; // 1MB
    if (thumbnailData.byteLength === 0) {
      throwHttpError("UPLOAD.THUMBNAIL_REQUIRED");
    }
    if (thumbnailData.byteLength > MAX_THUMBNAIL_SIZE) {
      throwHttpErrorWithCustomMessage(
        "COMMON.BAD_REQUEST",
        `Thumbnail too large: ${thumbnailData.byteLength} bytes (max ${MAX_THUMBNAIL_SIZE})`,
      );
    }

    const thumbnailBytes = new Uint8Array(thumbnailData);

    // Validate it's a recognisable image and capture dimensions
    let imageWidth!: number;
    let imageHeight!: number;
    try {
      const image = await Imagescript.decode(thumbnailBytes);
      imageWidth = image.width;
      imageHeight = image.height;
    } catch (_) {
      throwHttpError("UPLOAD.THUMBNAIL_INVALID_JPEG");
    }

    traceService.addBreadcrumb("handler", "Session thumbnail validated", "info", {
      size: thumbnailBytes.length,
      width: imageWidth,
      height: imageHeight,
    });

    // Encrypt the thumbnail with the user's encryption key
    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
    const encryptionResult = await DataEncryptionHelperService.encryptDataWithKey(
      encryptionKey.key,
      thumbnailBytes,
    );

    traceService.addBreadcrumb("handler", "Session thumbnail encrypted", "info", {
      originalSize: thumbnailBytes.length,
      encryptedSize: encryptionResult.data.length,
    });

    // Upload encrypted thumbnail to the session's temp-chunks folder
    const thumbnailPath = completeStoragePathForSessionThumbnail(environmentId, sessionId);
    const storage = getStorage();
    await storage.uploadFile(thumbnailPath, encryptionResult.data);

    // Persist all thumbnail metadata in the session for the background worker
    await sessionService.storeSessionThumbnailData(
      sessionId,
      thumbnailPath,
      imageWidth,
      imageHeight,
      thumbnailBytes.length,
      TextTransformations.fromBufferToBase64(encryptionResult.encryptedMasterKey),
    );

    traceService.addBreadcrumb("handler", "Session thumbnail stored successfully", "info", {
      sessionId,
      thumbnailPath,
      thumbnailSize: thumbnailBytes.length,
      thumbnailWidth: imageWidth,
      thumbnailHeight: imageHeight,
      encryptedKeyLength: encryptionResult.encryptedMasterKey.length,
    });

    return c.json({
      success: true,
      thumbnailSize: thumbnailBytes.length,
      thumbnailWidth: imageWidth,
      thumbnailHeight: imageHeight,
    }, 200);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to upload session thumbnail",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "session_thumbnail_upload_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for GET /api/documents/upload/chunked/stream/:sessionId
 * Opens an SSE connection for assembly progress events.
 *
 * Events emitted (JSON, each on a `data:` line):
 *   { type: "assembling", sessionId, timestamp, data: { status: "assembling" } }
 *   { type: "completed",  sessionId, timestamp, data: { documentId, status: "completed" } }
 *   { type: "failed",     sessionId, timestamp, data: { errorMessage, status: "failed" } }
 *
 * Pending events (fired before the client connected) are delivered immediately on connect.
 */
// stream/SSE handler — no responseSchema
export const streamChunkedUploadHandler: RouteHandler<typeof streamChunkedUploadRoute> = async (c) => {
  try {
    const { userId } = getAuthContext(c);
    const { sessionId } = c.req.valid("param");

    // Validate session ownership before establishing the stream
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);
    await sessionService.validateSessionOwnership(sessionId, userId);

    const stream = createChunkedUploadSSEStream(sessionId);

    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to establish SSE stream for chunked upload",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "chunked_upload_stream_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};

/**
 * Handler for DELETE /api/documents/upload/chunked/abort/:sessionId
 * Aborts an upload session and cleans up chunks
 */
export const abortChunkedUploadHandler: RouteHandler<typeof abortChunkedUploadRoute> = async (c) => {
  const traceService = getTraceContext();

  try {
    const { userId } = getAuthContext(c);
    const { sessionId } = c.req.valid("param");

    traceService.addBreadcrumb("handler", "Aborting chunked upload", "info", {
      sessionId,
    });

    // Get singleton cache instance and session service
    const cache = await getCache();
    const sessionService = getUploadSessionService(cache);

    // Validate session ownership
    await sessionService.validateSessionOwnership(sessionId, userId);

    // Get chunks for cleanup
    const chunks = await sessionService.getSessionChunks(sessionId);
    const chunkPaths = chunks.map((chunk) => chunk.storagePath);

    // Abort session
    await sessionService.abortSession(sessionId);

    // Get session to access content tracking
    const session = await sessionService.getSession(sessionId);

    // Cleanup uploaded encrypted chunks and session folder
    if (chunkPaths.length > 0) {
      const sessionFolderPath = extractSessionFolderPath(chunkPaths[0]);
      await ChunkAssemblerService.cleanupChunksAndFolder(chunkPaths, sessionFolderPath);
    }

    // Cleanup original chunks if they exist (legacy sessions)
    if (session?.contentTracking?.originalChunkPaths) {
      await ChunkAssemblerService.cleanupChunks(session.contentTracking.originalChunkPaths);
    }

    // Delete session
    await sessionService.deleteSession(sessionId);

    traceService.addBreadcrumb("handler", "Chunked upload aborted", "info", {
      chunksDeleted: chunkPaths.length,
    });

    return c.body(null, 204);
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to abort chunked upload",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "abort_chunked_upload_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};
