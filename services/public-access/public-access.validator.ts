/**
 * @file services/public-access/public-access.validator.ts
 * @description Generic validator for public access requests across all resource types
 */

import type { HonoContext } from "@deps";
import { logUnauthorizedAccessAttempt, validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import type { RequestContext, ResourceConfig, ValidatedAccessRequest } from "@interfaces/public-access.ts";
import { parseShareId } from "@services/public-sharing/secure-link-generator.service.ts";

/**
 * Generic validator for public access requests
 * Handles security validation, token extraction, and request context extraction
 */
export class PublicAccessValidator {
  /**
   * Validates and extracts common request data for public access
   * @param c - Hono context
   * @param resourceConfig - Configuration for the resource type
   * @returns Validated access request with all necessary data
   */
  static async validateAndExtractRequest(
    c: HonoContext,
    resourceConfig: ResourceConfig,
  ): Promise<ValidatedAccessRequest> {
    // Extract shareId from query parameter and shareKey from header
    // ZERO-KNOWLEDGE: shareKey is passed via Share-Key header (from URL fragment)
    const query = c.req.query();
    const { shareId, password } = query;

    // Extract shareKey from Share-Key header (frontend extracts from URL fragment #)
    const shareKey = c.req.header("Share-Key") || undefined;

    // Parse shareId to extract environmentId and actual token
    // Format: encodedEnvId.actualToken (new) or just actualToken (legacy)
    const parsed = shareId ? parseShareId(shareId) : null;
    if (!parsed?.environmentId) {
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    const environmentId = parsed.environmentId;
    const shareToken = parsed.token;

    // Prepare inputs for security validation
    const inputsToValidate: Record<string, string> = {};
    if (shareId) {
      inputsToValidate.shareId = shareId;
    }
    if (shareKey) {
      inputsToValidate.shareKey = shareKey;
    }
    if (password) {
      inputsToValidate.password = password;
    }

    // Validate security threats
    const threatsDetected = await validateAndLogSecurityThreats(
      c,
      inputsToValidate,
    );
    if (threatsDetected) {
      throwHttpError("DOCUMENT.PUBLIC_SHARE_BAD_REQUEST");
    }

    // Extract request context for logging and security
    const requestContext = IPLookupUtils.getRequestContext(c);

    return {
      shareToken,
      shareKey,
      password,
      requestContext: {
        ipAddress: requestContext.ip,
        userAgent: requestContext.userAgent,
        referer: requestContext.headers["referer"] || undefined,
      },
      resourceType: resourceConfig.type,
      environmentId,
    };
  }

  /**
   * Handles invalid access attempts with consistent timing and logging
   * @param c - Hono context
   * @param startTime - Request start time for timing protection
   * @param shareToken - Share token for logging
   * @param reason - Reason for access denial
   */
  static async handleInvalidAccess(
    c: HonoContext,
    startTime: number,
    shareToken: string,
    reason: string,
  ): Promise<never> {
    await logUnauthorizedAccessAttempt(
      c,
      "public_resource_access",
      shareToken,
      null,
      reason,
    );

    await ensureMinimumProcessingTime(
      startTime,
      TIMING_PROFILES.AUTH,
    );

    throwHttpError("DOCUMENT.NOT_FOUND");
  }

  /**
   * Sets appropriate cache headers based on password protection
   * @param c - Hono context
   * @param password - Optional password for the share
   */
  static setCacheHeaders(c: HonoContext, password?: string): void {
    const cacheControl = password ? "private, max-age=3600" : "public, max-age=3600";

    c.header("Cache-Control", cacheControl);
    c.header("X-Content-Type-Options", "nosniff");
  }

  /**
   * Logs successful access attempts
   * @param resourceId - ID of the resource being accessed
   * @param accessType - Type of access (view, download, stream)
   * @param requestContext - Request context information
   */
  static async logAccess(
    resourceId: string,
    accessType: string,
    requestContext?: RequestContext,
  ): Promise<void> {
    const { DocumentAccessLogService } = await import(
      "@services/documents-stats/index.ts"
    );
    const accessLogService = new DocumentAccessLogService();

    await accessLogService.logDocumentAccess(
      resourceId,
      null, // Anonymous access
      accessType,
      "public_share",
      requestContext,
    );
  }

  /**
   * Handles errors in public access with consistent timing and logging
   * @param c - Hono context
   * @param startTime - Request start time
   * @param error - Error that occurred
   */
  static async handleError(
    c: HonoContext,
    startTime: number,
    error: unknown,
  ): Promise<Response> {
    await ensureMinimumProcessingTime(
      startTime,
      TIMING_PROFILES.AUTH,
    );

    const { loggerAppSections, LoggerLevels, useLogger } = await import(
      "@services/logger/index.ts"
    );

    await useLogger(LoggerLevels.error, {
      message: "Failed to access public resource",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "public_access_handler_error",
      details: { error },
    });

    const { AppHttpException, throwHttpError } = await import(
      "@utils/http-exception.ts"
    );

    if (error instanceof AppHttpException) {
      throw error;
    }

    throwHttpError("DOCUMENT.NOT_FOUND");
    return c.json({ error: "This should never be reached" }, 500);
  }
}
