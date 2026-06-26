/**
 * @file services/public-access/strategies/document-access.strategy.ts
 * @description Strategy for handling document public access
 */

import { getDocumentSharingPublicService } from "@services/documents-sharing/index.ts";
import { PublicAccessValidator } from "../public-access.validator.ts";
import { AccessContext, ResourceAccessStrategy, ResourceType } from "@interfaces/public-access.ts";
import { SchemaPublicDocumentResponsePublic } from "@routes/documents-public/documents-public.route.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";

/**
 * Strategy for handling document public access
 * Implements ResourceAccessStrategy for document-specific behavior
 */
export class DocumentAccessStrategy implements ResourceAccessStrategy {
  getResourceType(): ResourceType {
    return ResourceType.DOCUMENT;
  }

  /**
   * Handles public access to documents
   * @param context - Access context containing request and configuration
   * @returns Response with document metadata
   */
  async handleAccess(context: AccessContext): Promise<Response> {
    const { request, config: _config } = context;

    // Verify public share access using document public sharing service
    // ZERO-KNOWLEDGE: shareKey is required for decryption
    const documentSharingPublicService = getDocumentSharingPublicService();
    const verificationResult = await documentSharingPublicService.verifyPublicShareAccess(
      request.shareToken,
      request.shareKey || "", // shareKey from Share-Key header
      request.password,
      request.requestContext,
    );

    // Handle invalid access
    if (!verificationResult.isValid || !verificationResult.document) {
      // Surface 401 to the frontend for password-related failures so it can
      // prompt for / re-prompt for a password. Everything else (not found,
      // expired, document deleted) collapses to 404.
      if (
        verificationResult.reason === "password_required" ||
        verificationResult.reason === "invalid_password"
      ) {
        throwHttpError(
          verificationResult.reason === "password_required" ? "PUBLIC_SHARE.PASSWORD_REQUIRED" : "PUBLIC_SHARE.INVALID_PASSWORD",
        );
      }
      return await PublicAccessValidator.handleInvalidAccess(
        context.context,
        context.startTime,
        request.shareToken,
        "Invalid or expired public share token",
      );
    }

    // Set cache headers based on password protection
    PublicAccessValidator.setCacheHeaders(context.context, request.password);

    // Log successful access
    await PublicAccessValidator.logAccess(
      verificationResult.documentId,
      "view",
      request.requestContext,
    );

    // Return document metadata
    const response = SchemaPublicDocumentResponsePublic.parse({
      document: {
        name: verificationResult.document.name,
        description: verificationResult.document.description,
        contentType: verificationResult.document.contentType,
        mimeType: verificationResult.document.mimeType,
        fileSize: verificationResult.document.fileSize,
      },
      shareId: request.shareToken, // Schema expects shareId, shareToken is the value
    });

    return context.context.json(response, 200);
  }

  /**
   * Validates user permissions for document sharing
   * @param userId - ID of user to check
   * @param resourceId - ID of document to check
   * @returns True if user has permission to share
   */
  async validatePermissions(userId: string, resourceId: string): Promise<boolean> {
    const { getDocumentPermissionService } = await import("@services/documents-permission/index.ts");
    const permissionService = getDocumentPermissionService();
    const permission = await permissionService.getAccessLevel(resourceId, userId);
    return permission !== null && permissionLevelMeets(permission, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE); // WRITE permission level
  }
}
