/**
 * @file handlers/media-stream/stream.handler.ts
 * @description Video streaming handler with database-backed storage
 * Supports HTTP range requests, encryption/decryption, and proper video streaming
 */

import type { RouteHandler } from "@deps";
import { mediaStreamHeadRoute, mediaStreamRoute } from "@routes/media-stream/stream.route.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { getSectionAccessService, MediaEncryptionContext, MediaFileMetadata, MediaStreamService } from "@services/media-stream/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { resolveAllowedOrigin } from "@utils/network/index.ts";

/**
 * Stream video handler with range request support
 */
export const mediaStreamHandler: RouteHandler<typeof mediaStreamRoute> = async (c) => {
  const traceService = getTraceContext();
  const origin = c.req.header("Origin");
  const allowedOrigin = resolveAllowedOrigin(origin);
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers": "Range",
    ...(allowedOrigin
      ? {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Vary": "Origin",
      }
      : {}),
  };

  try {
    const section = c.req.param("section");
    const fileId = c.req.param("fileId");

    if (!fileId) {
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }

    traceService.addBreadcrumb("handler", "Media stream request started", "info", {
      fileId,
      section,
    });

    // Build encryption context based on authentication and key requirements
    let encryptionContext: MediaEncryptionContext;
    let storageMetadataId: string;
    let fileMetadata: MediaFileMetadata | null = null;

    try {
      const { userId } = getAuthContext(c);

      traceService.addBreadcrumb("handler", "Validating section access", "info", {
        userId,
        section,
        fileId,
      });

      const sectionAccessService = getSectionAccessService();
      const accessInfo = await sectionAccessService.getAccessInfo(
        section,
        fileId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );

      storageMetadataId = accessInfo.storageMetadataId;

      traceService.addBreadcrumb("handler", "Section access validated", "info", {
        storageMetadataId,
        encryptionMode: accessInfo.encryptionMode,
      });

      const fileMetadataResult = await MediaStreamService.getFileMetadata(storageMetadataId);
      if (!fileMetadataResult) {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }
      fileMetadata = fileMetadataResult;

      // Build encryption context based on the encryption mode
      if (accessInfo.encryptionMode === "user") {
        const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
        traceService.addBreadcrumb("handler", "Retrieved encryption key", "info", {
          keySource: encryptionKey.type,
        });

        // Validate that user has enhanced encryption enabled for user-encrypted data
        if (encryptionKey.type !== "user") {
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND", {
            message: "Cannot access user-encrypted data: enhanced encryption is not enabled for this user",
          });
        }

        encryptionContext = {
          userId,
          userEncryptionKey: encryptionKey.key,
          keySource: encryptionKey.type,
          encryptedMasterKey: accessInfo.encryptedMasterKey,
        };
      } else {
        // Use app-level encryption for shared/public media
        // Still need to get the encryption key from DataAccessService
        const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(c);

        traceService.addBreadcrumb("handler", "Using app encryption key", "info", {
          keySource: encryptionKey.type,
        });

        encryptionContext = {
          userId,
          ...(encryptionKey.type === "user" ? { userEncryptionKey: encryptionKey.key } : { appEncryptionKey: encryptionKey.key }),
          keySource: encryptionKey.type,
          encryptedMasterKey: accessInfo.encryptedMasterKey,
        };
      }
    } catch (error) {
      console.error("Authentication or access validation failed:", error);
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Ensure we have file metadata and encrypted master key before proceeding
    if (!fileMetadata) {
      throwHttpError("MEDIA.FILE_NOT_FOUND");
    }

    if (!encryptionContext.encryptedMasterKey) {
      throw new Error("Encrypted master key not provided in encryption context");
    }

    // Handle range requests for proper video seeking
    // Check both header (direct access) and query param (CDN proxy workaround)
    const rangeHeader = c.req.header("Range") || c.req.query("range");

    if (rangeHeader) {
      traceService.addBreadcrumb("handler", "Processing range request", "info", {
        range: rangeHeader,
        fileSize: fileMetadata.originalFileSize,
      });

      try {
        const rangeResponse = await MediaStreamService.createEncryptedRangeStreamResponse({
          rangeHeader,
          fileMetadata,
          encryptionContext,
          encryptedMasterKey: encryptionContext.encryptedMasterKey!,
          hashingContext: HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          additionalHeaders: corsHeaders,
        });

        if (rangeResponse) {
          traceService.addBreadcrumb(
            "handler",
            "Range request completed with streaming decryption",
            "info",
            {
              contentLength: rangeResponse.headers["Content-Length"],
            },
          );

          return new Response(rangeResponse.body, {
            status: rangeResponse.status,
            headers: rangeResponse.headers,
          });
        }

        traceService.addBreadcrumb(
          "handler",
          "Range request invalid, falling back to full file",
          "warning",
          {
            range: rangeHeader,
          },
        );
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Range request error - falling back to full file",
          messageKey: "media_stream.range_request.error",
          section: loggerAppSections.DOCUMENTS_DOWNLOAD,
          details: {
            rangeHeader,
            fileId,
            fileSize: fileMetadata.originalFileSize,
            errorMessage: error instanceof Error ? error.message : "Unknown error",
          },
          raw: error,
        });

        traceService.addBreadcrumb(
          "handler",
          "Range request failed, falling back to full file",
          "warning",
          {
            error: error instanceof Error ? error.message : "Unknown error",
          },
        );
      }
    }

    // Serve full video file for non-range requests
    traceService.addBreadcrumb("handler", "Starting full file stream decryption", "info", {
      mimeType: fileMetadata.mimeType,
      fileSize: fileMetadata.originalFileSize,
    });

    let decryptedStream: ReadableStream<Uint8Array>;
    try {
      decryptedStream = await MediaStreamService.getDecryptedMediaStream(
        fileMetadata,
        encryptionContext.encryptedMasterKey,
        encryptionContext,
        HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
      );

      if (!decryptedStream) {
        console.error("Decrypted stream is null or undefined", {
          fileId,
          section,
          mimeType: fileMetadata.mimeType,
        });
        throwHttpError("MEDIA.STREAMING_FAILED", {
          message: "Failed to create decrypted stream",
        });
      }

      traceService.addBreadcrumb("handler", "Decrypted stream created successfully", "info", {
        fileSize: fileMetadata.originalFileSize,
        mimeType: fileMetadata.mimeType,
      });
    } catch (error) {
      console.error("Error creating decrypted stream:", error, {
        fileId,
        section,
        mimeType: fileMetadata.mimeType,
        storageMetadataId,
      });
      traceService.addBreadcrumb("handler", "Failed to create decrypted stream", "error", {
        error: error instanceof Error ? error.message : "Unknown error",
        mimeType: fileMetadata.mimeType,
      });
      throwHttpError("MEDIA.STREAMING_FAILED", error);
    }

    // Validate MIME type is set correctly
    const contentType = fileMetadata.mimeType || "application/octet-stream";

    // Normalize MOV MIME types - some systems use video/mov, others use video/quicktime
    const normalizedMimeType = contentType === "video/mov" ? "video/quicktime" : contentType;

    traceService.addBreadcrumb("handler", "Media stream completed", "info", {
      fileSize: fileMetadata.originalFileSize,
      mimeType: normalizedMimeType,
      originalMimeType: fileMetadata.mimeType,
    });

    return new Response(decryptedStream, {
      status: 200,
      headers: {
        "Content-Type": normalizedMimeType,
        "Content-Length": fileMetadata.originalFileSize.toString(),
        "Accept-Ranges": "bytes",
        // Use 'private' to prevent CDN/proxy caching of decrypted content
        "Cache-Control": "private, max-age=3600",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("❌ Media stream error:", {
      section: c.req.param("section"),
      fileId: c.req.param("fileId"),
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    traceService.addBreadcrumb("handler", "Media stream error caught", "error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    throwHttpError("MEDIA.STREAMING_FAILED", error);
  }
};

/**
 * Handle HTTP range requests for video seeking with optimized chunk-based decryption
 * Only downloads and decrypts the chunks needed for the requested range
 */

/**
 * HEAD request handler for video metadata
 */
export const mediaStreamHeadHandler: RouteHandler<typeof mediaStreamHeadRoute> = async (c) => {
  const traceService = getTraceContext();
  const origin = c.req.header("Origin");
  const allowedOrigin = resolveAllowedOrigin(origin);
  const corsHeaders: Record<string, string> = {
    "Access-Control-Allow-Headers": "Range",
    ...(allowedOrigin
      ? {
        "Access-Control-Allow-Origin": allowedOrigin,
        "Vary": "Origin",
      }
      : {}),
  };

  try {
    const section = c.req.param("section");
    const fileId = c.req.param("fileId");

    if (!fileId) {
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }

    traceService.addBreadcrumb("handler", "Media HEAD request started", "info", {
      fileId,
      section,
    });

    // Build encryption context and validate section access
    let storageMetadataId: string;
    let fileMetadata: MediaFileMetadata;

    try {
      const { userId } = getAuthContext(c);

      traceService.addBreadcrumb("handler", "Validating section access (HEAD)", "info", {
        userId,
        section,
        fileId,
      });

      // Validate section access and get storage metadata ID
      const sectionAccessService = getSectionAccessService();
      storageMetadataId = await sectionAccessService.validateSectionAccess(
        section,
        fileId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );

      traceService.addBreadcrumb("handler", "Section access validated (HEAD)", "info", {
        storageMetadataId,
      });

      // Get file metadata using the storage metadata ID
      const fileMetadataResult = await MediaStreamService.getFileMetadata(storageMetadataId);

      if (!fileMetadataResult) {
        throwHttpError("MEDIA.FILE_NOT_FOUND");
      }
      fileMetadata = fileMetadataResult;

      traceService.addBreadcrumb("handler", "Media HEAD access verified", "info", {
        userId,
      });
    } catch (error) {
      console.error("❌ Authentication or access validation failed for media HEAD request:", error, {
        section,
        fileId,
        errorMessage: error instanceof Error ? error.message : "Unknown error",
        errorStack: error instanceof Error ? error.stack : undefined,
      });
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Validate MIME type is set correctly
    const contentType = fileMetadata.mimeType || "application/octet-stream";

    // Normalize MOV MIME types - some systems use video/mov, others use video/quicktime
    const normalizedMimeType = contentType === "video/mov" ? "video/quicktime" : contentType;

    // Return HEAD response with metadata headers
    return new Response(null, {
      status: 200,
      headers: {
        "Content-Type": normalizedMimeType,
        "Content-Length": fileMetadata.originalFileSize.toString(),
        "Accept-Ranges": "bytes",
        // Use 'private' to prevent CDN/proxy caching of decrypted content
        "Cache-Control": "private, max-age=3600",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("❌ Video stream HEAD error:", error, {
      section: c.req.param("section"),
      fileId: c.req.param("fileId"),
      errorMessage: error instanceof Error ? error.message : "Unknown error",
      errorStack: error instanceof Error ? error.stack : undefined,
    });

    traceService.addBreadcrumb("handler", "Media HEAD error caught", "error", {
      error: error instanceof Error ? error.message : "Unknown error",
    });

    throwHttpError("MEDIA.STREAMING_FAILED", error);
  }
};
