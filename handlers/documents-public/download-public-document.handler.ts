/**
 * @file handlers/documents-public/download-public-document.handler.ts
 * @description Handler for downloading publicly shared documents
 *
 * This handler provides public download access to documents via share tokens without authentication.
 * Returns decrypted file stream with proper headers for download.
 *
 * ZERO-KNOWLEDGE ARCHITECTURE:
 * - shareId: Query parameter (used for database lookup)
 * - shareKey: Header "Share-Key" (from URL fragment, never logged)
 */

import type { RouteHandler } from "@deps";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { logUnauthorizedAccessAttempt, validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { downloadPublicDocumentRoutePublic } from "@routes/documents-public/documents-public.route.ts";
import { getDocumentSharingPublicService } from "@services/documents-sharing/index.ts";
import { HTTP_HEADERS } from "@constants/http-headers.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";
import { requestContext } from "@db/index.ts";

/**
 * Handler for GET /api/public/documents/download?shareId=xxx
 * Header: Share-Key: <shareKey from URL fragment>
 * Downloads a publicly shared document (no authentication required)
 */
// stream/download handler — no responseSchema
export const downloadPublicDocumentHandler: RouteHandler<
  typeof downloadPublicDocumentRoutePublic
> = async (c) => {
  const startTime = performance.now();

  try {
    // 1. Extract shareId from query and shareKey from header
    // The shareKey comes from the URL fragment (#) which browsers don't send to the server
    // The frontend extracts it and sends it via the Share-Key header
    const { shareId, password } = c.req.valid("query");
    const shareKey = c.req.header(HTTP_HEADERS.SHARE_KEY);

    // Validate shareKey is present
    if (!shareKey) {
      throwHttpError("PUBLIC_SHARE.SHARE_KEY_REQUIRED");
    }

    // Parse shareId to extract environmentId and actual token
    const { environmentId, token: shareToken } = parseShareId(shareId);

    // Check if we have an environmentId - required for tenant DB access
    if (!environmentId) {
      await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // 2. Validate security threats
    const inputsToValidate: Record<string, string> = { shareId };
    if (password) {
      inputsToValidate.password = password;
    }
    // NOTE: We intentionally do NOT include shareKey in security threat validation
    // to prevent it from being logged

    const threatsDetected = await validateAndLogSecurityThreats(
      c,
      inputsToValidate,
    );
    if (threatsDetected) {
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
        const documentSharingPublicService = getDocumentSharingPublicService();
        const verificationResult = await documentSharingPublicService.verifyPublicShareAccess(
          shareToken, // Use the actual token (without env prefix) for DB lookup
          shareKey,
          password ?? undefined,
          { ipAddress, userAgent, referer },
        );

        // 5. Handle invalid access
        if (!verificationResult.isValid || !verificationResult.document) {
          logUnauthorizedAccessAttempt(
            c,
            "public_document_download",
            shareToken,
            null,
            "Invalid or expired public share",
          );

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

        // 6. Download document
        const { getDocumentDownloadService } = await import(
          "@services/documents/index.ts"
        );
        const downloadService = getDocumentDownloadService();

        const downloadResult = await downloadService.download({
          documentId: verificationResult.documentId,
          shareId: shareToken, // Use actual token for DB lookup
          shareKey,
          password: password ?? undefined,
          dataKeyId: verificationResult.dataKeyId!,
          metadata: { ipAddress, userAgent, referer },
        });

        // 7. Set response headers and stream file
        c.header("Content-Type", downloadResult.mimeType);
        c.header(
          "Content-Disposition",
          `attachment; filename="${downloadResult.fileName}"`,
        );
        c.header("Content-Length", downloadResult.fileSize.toString());
        c.header("X-Content-Type-Options", "nosniff");

        // Set cache control based on password protection
        const cacheControl = password ? "private, max-age=3600" : "public, max-age=3600";
        c.header("Cache-Control", cacheControl);

        return c.body(downloadResult.stream, 200);
      },
    );
  } catch (error) {
    await ensureMinimumProcessingTime(
      startTime,
      TIMING_PROFILES.AUTH,
    );

    await useLogger(LoggerLevels.error, {
      message: "Failed to download public document",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "download_public_document_handler_error",
      details: { error },
    });

    if (error instanceof AppHttpException) {
      throw error;
    }

    throwHttpError("DOCUMENT.NOT_FOUND");
  }
};
