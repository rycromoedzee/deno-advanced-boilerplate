/**
 * @file services/documents-sharing/document-sharing-public.service.ts
 * @description Service for public document sharing operations
 *
 * This service handles public sharing of documents, including:
 * - Creating public share links
 * - Verifying public share access
 * - Managing public share permissions
 * - Disabling public shares
 */

import { and, eq } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections, useLogger } from "@logger/logger.ts";
import { LoggerLevels } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { PublicSharingService } from "@services/public-sharing/public-sharing.service.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { DocumentPermissionService } from "@services/documents-permission/document-permission.service.ts";
import { SharingService } from "@services/encryption/sharing.service.ts";
import type { ExtendedPublicShareResult, PublicShareConfig } from "@interfaces/public-sharing.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getTenantDB, requestContext, tenantTables } from "@db/index.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/index.ts";
import { getDocumentPermissionService } from "@services/documents-permission/index.ts";

const DOC_TABLE_CONFIG = {
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
} as const;

/**
 * Type for document returned by public share verification
 */
type PublicShareDocument = {
  id: string;
  name: string;
  description: string | null;
  contentType: string | null;
  folderId: string | null;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  fileSize: number;
  mimeType: string | null;
};

/**
 * Document Public Sharing Service
 *
 * Handles public document sharing operations:
 * - Create public share links
 * - Verify public share access
 * - Disable public shares
 * - Manage public share permissions
 */
export class DocumentSharingPublicService {
  private publicSharingService: PublicSharingService;
  private accessLogService: DocumentAccessLogService;
  private permissionService: DocumentPermissionService;
  private sharingService: SharingService;

  constructor() {
    this.publicSharingService = new PublicSharingService(DOC_TABLE_CONFIG);
    this.accessLogService = getDocumentAccessLogService();
    this.permissionService = getDocumentPermissionService();
    this.sharingService = new SharingService(DOC_TABLE_CONFIG);
  }

  /**
   * Creates a public share link for a document
   *
   * @param documentId - Document ID to share publicly
   * @param options - Public share options (password, expiresAt, etc.)
   * @param userId - ID of the user creating the public share
   * @param encryptionKey - Encryption key for the document
   * @returns Promise with public share result
   */
  async createPublicShare(
    documentId: string,
    options: {
      password?: string;
      expiresAt?: number;
      permissionLevel?: DB_ENUM_PERMISSION_ACCESS_LEVEL;
      recipientEmail?: string;
      recipientName?: string;
      recipientLanguage?: string;
      notifyOnAccess?: boolean;
    },
    userId: string,
    encryptionKey: Uint8Array,
  ): Promise<ExtendedPublicShareResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingPublicService.createPublicShare",
      {
        service: "DocumentSharingPublicService",
        method: "createPublicShare",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const userPermission = await this.permissionService.getAccessLevel(
          documentId,
          userId,
        );

        if (userPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        const config: PublicShareConfig = {
          password: options.password,
          expiresAt: options.expiresAt,
          permissionLevel: options.permissionLevel || DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
          recipientEmail: options.recipientEmail,
          recipientName: options.recipientName,
          recipientLanguage: options.recipientLanguage || "en",
          notifyOnAccess: options.notifyOnAccess || false,
        };

        // Get environmentId from request context for tenant DB routing
        const environmentId = requestContext.getStore()?.environmentId;

        const result = await this.publicSharingService.createPublicShare(
          documentId,
          userId,
          config,
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          encryptionKey,
          environmentId,
        );

        this.accessLogService.logDocumentAccess(
          documentId,
          userId,
          "create_public_share",
          "direct",
        );

        return result;
      },
    );
  }

  /**
   * Disables public sharing for a document
   *
   * @param documentId - Document ID
   * @param userId - ID of the user disabling the share
   * @param shareToken - Optional specific share token to disable
   * @returns Promise<void>
   */
  async disablePublicShare(documentId: string, userId: string, shareToken?: string): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingPublicService.disablePublicShare",
      {
        service: "DocumentSharingPublicService",
        method: "disablePublicShare",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const userPermission = await this.permissionService.getAccessLevel(
          documentId,
          userId,
        );

        if (userPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
          throwHttpError("DOCUMENT.ACCESS_DENIED");
        }

        await this.sharingService.disablePublicShares(documentId, shareToken);

        this.accessLogService.logDocumentAccess(
          documentId,
          userId,
          "disable_public_share",
          "direct",
          shareToken ? { shareToken: shareToken } : undefined,
        );
      },
    );
  }

  /**
   * Verifies public share access using shareId and shareKey (zero-knowledge)
   *
   * @param shareId - Public share ID (lookup key)
   * @param shareKey - Share key from URL fragment (encryption key)
   * @param password - Optional password for password-protected shares
   * @param metadata - Request metadata (IP address, user agent, referer)
   * @returns Promise<{ documentId: string; isValid: boolean; document: PublicShareDocument | null; dataKeyId: string | null }>
   */
  async verifyPublicShareAccess(
    shareId: string,
    shareKey: string,
    password?: string,
    metadata?: {
      ipAddress?: string;
      userAgent?: string;
      referer?: string;
    },
  ): Promise<
    {
      documentId: string;
      isValid: boolean;
      document: PublicShareDocument | null;
      dataKeyId: string | null;
      // Reason the share is not accessible. `null` when `isValid` is true.
      // Handlers map this to a status code: `password_required` /
      // `invalid_password` → 401, everything else → 404. Surface 401 to the
      // frontend so it can prompt for / re-prompt for a password; share
      // tokens are unguessable, so leaking "this share exists and needs a
      // password" does not materially aid enumeration.
      reason: null | "not_found" | "expired" | "password_required" | "invalid_password" | "document_not_found";
    }
  > {
    let errorMessage: string | undefined;
    let documentId = "";
    let dataKeyId: string | null = null;
    let reason: null | "not_found" | "expired" | "password_required" | "invalid_password" | "document_not_found" = null;

    return await tracedWithServiceErrorHandling(
      "DocumentSharingPublicService.verifyPublicShareAccess",
      {
        service: "DocumentSharingPublicService",
        method: "verifyPublicShareAccess",
        section: loggerAppSections.DOCUMENTS,
        details: { shareId: shareId.substring(0, 8) + "..." },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["share_id_length"] = shareId.length;
        span.attributes["has_password"] = !!password;
        span.attributes["has_metadata"] = !!metadata;
        // NOTE: We intentionally do NOT log shareKey

        // Query documentsDataKeys by publicShareToken (shareId) via SharingService
        const dataKeyResult = await this.sharingService.getPublicShareByToken(shareId);

        if (!dataKeyResult) {
          errorMessage = "Public share not found or invalid";
          reason = "not_found";

          span.attributes["error"] = "share_not_found";

          await useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "document_public_share_invalid_token",
            details: { shareId: shareId.substring(0, 8) + "..." },
          });

          return { documentId: "", isValid: false, document: null, dataKeyId: null, reason };
        }

        const dataKey = { ...dataKeyResult, documentId: dataKeyResult.resourceId };
        documentId = dataKey.documentId;
        dataKeyId = dataKey.id;

        span.attributes["document_id"] = documentId;
        span.attributes["data_key_id"] = dataKeyId;
        span.attributes["is_password_protected"] = dataKey.isPasswordProtected;

        // Check expiration if set
        if (dataKey.publicShareExpiresAt) {
          const now = getTimeNowForStorage();
          if (now > dataKey.publicShareExpiresAt) {
            errorMessage = "Public share has expired";
            reason = "expired";

            span.attributes["error"] = "share_expired";
            span.attributes["expires_at"] = dataKey.publicShareExpiresAt;

            useLogger(LoggerLevels.debug, {
              message: errorMessage,
              section: loggerAppSections.DEBUG,
              messageKey: "document_public_share_expired",
              details: {
                documentId,
                dataKeyId,
                expiresAt: dataKey.publicShareExpiresAt,
                now,
              },
            });

            // Log failed access attempt
            this.accessLogService.logDocumentAccess(
              documentId,
              null, // Anonymous access
              "view",
              "public_share",
              { ...metadata, errorMessage },
            );

            return { documentId, isValid: false, document: null, dataKeyId, reason };
          }
        }

        if (password && dataKey.isPasswordProtected) {
          const isPasswordValid = await traced(
            "DocumentSharingPublicService.verifyPublicShareAccess.verifyPassword",
            "auth",
            async (authSpan) => {
              authSpan.attributes["share_id_prefix"] = shareId.substring(0, 8) + "...";
              authSpan.attributes["has_password"] = !!password;

              return await this.publicSharingService.verifyPublicSharePassword(
                shareId,
                shareKey,
                password,
                HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
                {
                  ipAddress: metadata?.ipAddress,
                  userAgent: metadata?.userAgent,
                },
              );
            },
          );

          if (!isPasswordValid) {
            errorMessage = "Invalid password for public share";
            reason = "invalid_password";

            span.attributes["error"] = "invalid_password";

            useLogger(LoggerLevels.debug, {
              message: errorMessage,
              section: loggerAppSections.DEBUG,
              messageKey: "document_public_share_invalid_password",
              details: { documentId, dataKeyId },
            });

            // Log failed access attempt
            this.accessLogService.logDocumentAccess(
              documentId,
              null,
              "view",
              "public_share",
              { ...metadata, errorMessage },
            );

            return { documentId, isValid: false, document: null, dataKeyId, reason };
          }
        } else if (!password && dataKey.isPasswordProtected) {
          // Password required but not provided
          errorMessage = "Password required for this public share";
          reason = "password_required";

          span.attributes["error"] = "password_required";

          useLogger(LoggerLevels.debug, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "document_public_share_password_required",
            details: { documentId, dataKeyId },
          });

          this.accessLogService.logDocumentAccess(
            documentId,
            null,
            "view",
            "public_share",
            { ...metadata, errorMessage },
          );

          return { documentId, isValid: false, document: null, dataKeyId, reason };
        }

        // Get document metadata
        // NOTE: For public shares, environmentId filtering is not applicable because:
        // 1. The share token itself is the authorization mechanism (validated above)
        // 2. Public shares are accessible regardless of tenant/environment
        // 3. The documentId comes from the validated share token, preventing unauthorized access
        // Cross-tenant isolation is enforced at the share token level, not document level.

        const documentResult = await traced(
          "DocumentSharingPublicService.verifyPublicShareAccess.queryDocument",
          "db.query",
          async (querySpan) => {
            querySpan.attributes["document_id"] = documentId;

            return await (await getTenantDB())
              .select({
                id: tenantTables.documents.id,
                name: tenantTables.documents.name,
                description: tenantTables.documents.description,
                contentType: tenantTables.documents.contentType,
                folderId: tenantTables.documents.folderId,
                ownerId: tenantTables.documents.ownerId,
                createdAt: tenantTables.documents.createdAt,
                updatedAt: tenantTables.documents.updatedAt,
                fileSize: tenantTables.storageMetadata.originalFileSize,
                mimeType: tenantTables.storageMetadata.mimeType,
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
          },
        );

        if (documentResult.length === 0) {
          errorMessage = "Document not found or archived";
          reason = "document_not_found";

          span.attributes["error"] = "document_not_found";

          await useLogger(LoggerLevels.warn, {
            message: errorMessage,
            section: loggerAppSections.DEBUG,
            messageKey: "document_public_share_document_not_found",
            details: { documentId, dataKeyId },
          });

          this.accessLogService.logDocumentAccess(
            documentId,
            null,
            "view",
            "public_share",
            { ...metadata, errorMessage },
          );

          return { documentId, isValid: false, document: null, dataKeyId, reason };
        }

        const document = documentResult[0];

        span.attributes["document_name"] = document.name;
        span.attributes["document_size"] = document.fileSize;
        span.attributes["mime_type"] = document.mimeType;

        // Log successful access
        this.accessLogService.logDocumentAccess(
          documentId,
          null, // Anonymous access
          "view",
          "public_share",
          metadata,
        );

        // Fire-and-forget: increment access count via SharingService
        this.sharingService.incrementAccessCount(dataKeyId!, dataKey.accessCount);

        span.attributes["success"] = true;
        return { documentId, isValid: true, document, dataKeyId, reason: null };
      },
    );
  }

  /**
   * Lists all public shares for a document
   *
   * @param documentId - Document ID
   * @param requesterId - ID of the user requesting the list
   * @returns Promise with public shares list
   */
  async listPublicShares(
    documentId: string,
    requesterId: string,
    encryptionKey: Uint8Array,
  ): Promise<{
    publicShares: {
      shareToken: string;
      permissionLevel: number;
      isPasswordProtected: boolean;
      expiresAt: number | null;
      recipientEmail: string | null;
      createdAt: number;
      publicUrl: string;
    }[];
  }> {
    return await tracedWithServiceErrorHandling(
      "DocumentSharingPublicService.listPublicShares",
      {
        service: "DocumentSharingPublicService",
        method: "listPublicShares",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, requesterId },
      },
      "DOCUMENT.INTERNAL_SERVER_ERROR",
      async (_span) => {
        // Check requester's permission
        const requesterPermission = await this.permissionService.getAccessLevel(
          documentId,
          requesterId,
        );

        // Implement 404 vs 403 strategy: if no permission, document doesn't exist for this user
        if (requesterPermission === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const fetchedShares = await this.sharingService.listPublicShares(documentId);

        const { envConfig } = await import("@config/env.ts");
        const protocol = envConfig.public.frontURL.startsWith("http") ? "" : "https://";
        const baseUrl = `${protocol}${envConfig.public.frontURL}/public/documents`;

        const publicShares = await Promise.all(
          fetchedShares.map(async (share) => {
            let shareKey = "";
            if (share.sharerEncryptedShareKey) {
              try {
                shareKey = await this.publicSharingService.decryptShareKeyForSharer(
                  share.sharerEncryptedShareKey,
                  encryptionKey,
                  HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
                );
              } catch (error) {
                useLogger(LoggerLevels.warn, {
                  message: "Failed to decrypt share key for public share",
                  section: loggerAppSections.DOCUMENTS,
                  messageKey: "document.list_public_shares.decrypt_error",
                  details: { documentId, shareToken: share.shareToken },
                  raw: error,
                });
              }
            }

            return {
              shareToken: share.shareToken,
              permissionLevel: share.permissionLevel,
              isPasswordProtected: share.isPasswordProtected,
              expiresAt: share.expiresAt,
              recipientEmail: share.recipientEmail,
              createdAt: share.createdAt,
              publicUrl: shareKey ? `${baseUrl}?shareId=${share.shareToken}#${shareKey}` : "",
            };
          }),
        );

        return {
          publicShares,
        };
      },
    );
  }
}
