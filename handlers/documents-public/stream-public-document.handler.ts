/**
 * @file handlers/documents-public/stream-public-document.handler.ts
 * @description Handler for streaming publicly shared documents (inline viewing)
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * - shareId: Query parameter (used for database lookup)
 * - shareKey: Header "Share-Key" (from URL fragment, never sent to server in URL)
 *
 * This handler provides public streaming access to documents via share tokens without authentication.
 * Returns decrypted file stream with inline content disposition for viewing in the browser.
 * Suitable for videos, PDFs, images, and audio files.
 */

import type { RouteHandler } from "@deps";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { logUnauthorizedAccessAttempt, validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { streamPublicDocumentRoutePublic } from "@routes/documents-public/documents-public.route.ts";
import { MediaStreamService } from "@services/media-stream/index.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { getTraceContext, traced } from "@services/tracing/index.ts";
import { HTTP_HEADERS } from "@constants/http-headers.ts";
import { getTenantDB, requestContext, tenantTables } from "@db/index.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";
import { documentsDataKeys } from "@db/schema/tenant/index.ts";

/**
 * Handler for GET /api/v1/public/documents/stream?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 * Streams a publicly shared document for inline viewing (no authentication required)
 */
// stream/download handler — no responseSchema
export const streamPublicDocumentHandler: RouteHandler<
  typeof streamPublicDocumentRoutePublic
> = async (c) => {
  const startTime = performance.now();
  const traceService = getTraceContext();

  try {
    // 1. Extract shareId from query and shareKey from header
    const { shareId, password } = c.req.valid("query");
    const shareKey = c.req.header(HTTP_HEADERS.SHARE_KEY);

    // Validate shareKey is provided
    if (!shareKey) {
      traceService.addBreadcrumb("handler", "Missing Share-Key header", "warning");
      throwHttpError("PUBLIC_SHARE.SHARE_KEY_REQUIRED");
    }

    // Parse shareId to extract environmentId and actual token
    const { environmentId, token: shareToken } = parseShareId(shareId);

    // Check if we have an environmentId - required for tenant DB access
    if (!environmentId) {
      traceService.addBreadcrumb("handler", "Missing environmentId in share token", "warning");
      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // 2. Validate security threats
    const inputsToValidate: Record<string, string> = { shareId };
    if (password) {
      inputsToValidate.password = password;
    }

    const threatsDetected = await traced(
      "streamPublicDocumentHandler.validateSecurityThreats",
      "auth",
      async (span) => {
        span.attributes["share_id_length"] = shareId.length;
        span.attributes["has_password"] = !!password;

        return await validateAndLogSecurityThreats(c, inputsToValidate);
      },
    );

    if (threatsDetected) {
      traceService.addBreadcrumb("handler", "Security threats detected", "warning");
      await ensureMinimumProcessingTime(
        startTime,
        TIMING_PROFILES.AUTH,
      );
      throwHttpError("DOCUMENT.PUBLIC_SHARE_BAD_REQUEST");
    }

    // 3. Get request context
    const reqContext = IPLookupUtils.getRequestContext(c);
    const ipAddress = reqContext.ip;
    const userAgent = reqContext.userAgent;
    const referer = reqContext.headers["referer"] || undefined;

    // Run within request context with environmentId so getTenantDB() works
    return await requestContext.run(
      {
        environmentId,
        userId: "", // No user for public access
      },
      async () => {
        // 4. Verify public share access
        const verificationResult = await traced(
          "streamPublicDocumentHandler.verifyPublicShareAccess",
          "service",
          async (span) => {
            span.attributes["share_id_length"] = shareToken.length;
            span.attributes["has_password"] = !!password;

            const { getDocumentSharingPublicService } = await import(
              "@services/documents-sharing/index.ts"
            );
            const documentSharingPublicService = getDocumentSharingPublicService();

            return await documentSharingPublicService.verifyPublicShareAccess(
              shareToken, // Use actual token for DB lookup
              shareKey,
              password ?? undefined,
              { ipAddress, userAgent, referer },
            );
          },
        );

        // 5. Handle invalid access
        if (!verificationResult.isValid || !verificationResult.document) {
          traceService.addBreadcrumb("handler", "Access denied - invalid share", "warning", {
            isValid: verificationResult.isValid,
            hasDocument: !!verificationResult.document,
            reason: verificationResult.reason,
            shareIdPrefix: shareToken.substring(0, 8) + "...",
          });

          await logUnauthorizedAccessAttempt(
            c,
            "public_document_stream",
            shareToken,
            null,
            "Invalid or expired public share",
          );

          await useLogger(LoggerLevels.warn, {
            message: "Public document stream denied",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "stream_public_document_handler_denied",
            details: {
              shareId: shareToken.substring(0, 20) + "...",
              reason: verificationResult.reason,
              ipAddress,
            },
          });

          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.AUTH,
          );

          // Surface 401 to the frontend for password-related failures so it
          // can prompt for / re-prompt for a password. Everything else
          // (not found, expired, document deleted) collapses to 404.
          if (
            verificationResult.reason === "password_required" ||
            verificationResult.reason === "invalid_password"
          ) {
            throwHttpError(
              verificationResult.reason === "password_required" ? "PUBLIC_SHARE.PASSWORD_REQUIRED" : "PUBLIC_SHARE.INVALID_PASSWORD",
            );
          }
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // 6. Check for Range header
        const rangeHeader = c.req.header("Range");

        if (rangeHeader) {
          traceService.addBreadcrumb("handler", "Range request detected", "info", {
            rangeHeader: rangeHeader.substring(0, 50) + (rangeHeader.length > 50 ? "..." : ""),
          });

          // Handle range request with optimized chunk-based decryption
          return await handlePublicRangeRequest(
            c,
            verificationResult.documentId,
            shareToken, // Use actual token for DB lookup
            shareKey,
            password ?? undefined,
            verificationResult.dataKeyId!,
            rangeHeader,
            { ipAddress, userAgent, referer },
          );
        }

        // 7. No range request - stream full document
        const streamResult = await traced(
          "streamPublicDocumentHandler.streamDocument",
          "service",
          async (span) => {
            span.attributes["document_id"] = verificationResult.documentId;
            span.attributes["share_id_length"] = shareToken.length;
            span.attributes["has_password"] = !!password;

            const { getDocumentDownloadService } = await import(
              "@services/documents/index.ts"
            );
            const downloadService = getDocumentDownloadService();

            return await downloadService.stream({
              documentId: verificationResult.documentId,
              shareId: shareToken, // Use actual token for DB lookup
              shareKey,
              password: password ?? undefined,
              dataKeyId: verificationResult.dataKeyId!,
              metadata: { ipAddress, userAgent, referer },
            });
          },
        );

        // 8. Set response headers for inline viewing
        c.header("Content-Type", streamResult.mimeType);
        c.header(
          "Content-Disposition",
          `inline; filename="${streamResult.fileName}"`,
        );
        c.header("Content-Length", streamResult.fileSize.toString());
        c.header("X-Content-Type-Options", "nosniff");
        c.header("Accept-Ranges", "bytes");

        // Set cache control based on password protection
        const cacheControl = password ? "private, max-age=3600" : "public, max-age=3600";
        c.header("Cache-Control", cacheControl);

        return c.body(streamResult.stream, 200);
      },
    );
  } catch (error) {
    await ensureMinimumProcessingTime(
      startTime,
      TIMING_PROFILES.AUTH,
    );

    await useLogger(LoggerLevels.error, {
      message: "Failed to stream public document",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "stream_public_document_handler_error",
      details: { error },
    });

    if (error instanceof AppHttpException) {
      throw error;
    }

    throwHttpError("DOCUMENT.NOT_FOUND");
  }
};

/**
 * Handle range requests for public document streaming
 * Uses optimized chunk-based decryption to only download and decrypt needed chunks
 *
 * ZERO-KNOWLEDGE: Uses shareId and shareKey instead of shareToken
 */
async function handlePublicRangeRequest(
  c: Parameters<RouteHandler<typeof streamPublicDocumentRoutePublic>>[0],
  documentId: string,
  shareToken: string,
  shareKey: string,
  password: string | undefined,
  dataKeyId: string,
  rangeHeader: string,
  metadata?: {
    ipAddress?: string;
    userAgent?: string;
    referer?: string;
  },
): Promise<Response> {
  const traceService = getTraceContext();

  try {
    const result = await traced(
      "handlePublicRangeRequest.getDocumentMetadata",
      "db.query",
      async (span) => {
        span.attributes["document_id"] = documentId;

        const { and, eq } = await import("drizzle-orm");
        const db = await getTenantDB();

        const [result] = await db
          .select({
            document: tenantTables.documents,
            storage: tenantTables.storageMetadata,
          })
          .from(tenantTables.documents)
          .innerJoin(
            tenantTables.storageMetadata,
            eq(tenantTables.documents.storageMetadataId, tenantTables.storageMetadata.id),
          )
          .where(
            and(
              eq(tenantTables.documents.id, documentId),
              eq(tenantTables.documents.isArchived, false),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!result;
        return result;
      },
    );

    if (!result) {
      traceService.addBreadcrumb("handler", "Document not found for range request", "warning");
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // 3. Get data key
    const dataKey = await traced(
      "handlePublicRangeRequest.getDataKey",
      "db.query",
      async (span) => {
        span.attributes["data_key_id"] = dataKeyId;
        span.attributes["document_id"] = documentId;

        const { and, eq } = await import("drizzle-orm");
        const db = await getTenantDB();

        const [dataKey] = await db
          .select()
          .from(tenantTables.documentsDataKeys)
          .where(
            and(
              eq(tenantTables.documentsDataKeys.id, dataKeyId),
              eq(tenantTables.documentsDataKeys.isActive, true),
              eq(tenantTables.documentsDataKeys.isPublicShare, true),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!dataKey;
        return dataKey;
      },
    );

    if (!dataKey) {
      traceService.addBreadcrumb("handler", "Data key not found for range request", "error");
      throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
    }

    // 4. Get decrypted master key using zero-knowledge approach
    const dataMasterKey = await traced(
      "handlePublicRangeRequest.getDataMasterKey",
      "encryption",
      async (span) => {
        span.attributes["share_id_length"] = shareToken.length;
        span.attributes["has_password"] = !!password;

        const { PublicSharingService } = await import("@services/public-sharing/index.ts");
        const publicSharingService = new PublicSharingService({
          tableName: documentsDataKeys,
          resourceIdColumn: "documentId",
        });

        return await publicSharingService.getDataMasterKeyForPublicShare(
          shareToken,
          shareKey,
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          password,
        );
      },
    );

    const cacheControl = password ? "private, max-age=3600" : "public, max-age=3600";

    const rangeResponse = await traced(
      "handlePublicRangeRequest.createRangeStream",
      "service",
      async (span) => {
        span.attributes["range_header"] = rangeHeader.substring(0, 50) + (rangeHeader.length > 50 ? "..." : "");
        span.attributes["file_size"] = result.storage.originalFileSize;
        span.attributes["mime_type"] = result.storage.mimeType;

        return await MediaStreamService.createRawMasterKeyRangeStreamResponse({
          rangeHeader,
          fileMetadata: {
            folderPath: result.storage.folderPath,
            mimeType: result.storage.mimeType,
            originalFileSize: result.storage.originalFileSize,
            originalName: result.storage.originalName,
            encryptionChunkSize: result.storage.encryptionChunkSize,
          },
          dataMasterKey,
          additionalHeaders: {
            "Content-Disposition": `inline; filename="${result.storage.originalName}"`,
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": cacheControl,
          },
        });
      },
    );

    if (!rangeResponse) {
      const { getDocumentDownloadService } = await import("@services/documents/index.ts");
      const downloadService = getDocumentDownloadService();
      const streamResult = await downloadService.stream({
        documentId,
        shareId: shareToken,
        shareKey,
        password,
        dataKeyId,
        metadata,
      });

      c.header("Content-Type", streamResult.mimeType);
      c.header("Content-Disposition", `inline; filename="${streamResult.fileName}"`);
      c.header("Content-Length", streamResult.fileSize.toString());
      c.header("Accept-Ranges", "bytes");
      c.header("Cache-Control", cacheControl);
      c.header("X-Content-Type-Options", "nosniff");

      return c.body(streamResult.stream, 200);
    }

    // 6. Log access
    await traced(
      "handlePublicRangeRequest.logAccess",
      "service",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["access_type"] = "stream";
        span.attributes["access_method"] = "public_share";

        const { DocumentAccessLogService } = await import("@services/documents-stats/index.ts");
        const accessLogService = new DocumentAccessLogService();
        await accessLogService.logDocumentAccess(
          documentId,
          null,
          "stream",
          "public_share",
          {
            ipAddress: metadata?.ipAddress,
            userAgent: metadata?.userAgent,
            referer: metadata?.referer,
          },
        );
      },
    );

    return new Response(rangeResponse.body, {
      status: rangeResponse.status,
      headers: rangeResponse.headers,
    });
  } catch (error) {
    traceService.addBreadcrumb("handler", "Range request failed", "error", {
      error: error instanceof Error ? error.message : String(error),
    });

    await useLogger(LoggerLevels.error, {
      message: "Failed to handle public document range request",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "stream_public_document_range_error",
      details: { error },
    });

    if (error instanceof AppHttpException) {
      throw error;
    }

    throwHttpError("DOCUMENT.NOT_FOUND");
  }
}
