/**
 * @file handlers/documents/thumbnail-upload.handler.ts
 * @description Handler for uploading document thumbnails from frontend
 *
 * This allows frontends to generate thumbnails client-side and upload them separately.
 * Thumbnails are encrypted using the document's encryption context for security.
 *
 * Thumbnail encryption design:
 * - A random thumbnailDataKey is generated per thumbnail
 * - The actual thumbnail bytes are encrypted with thumbnailDataKey
 * - thumbnailDataKey is wrapped with each user's master key and stored in
 *   documentsDataKeys.thumbnailEncryptedMasterKey (same row as the file key)
 * - This means every user with document access can decrypt the thumbnail
 * - When the master key changes (enable/disable encryption, rotation, recovery),
 *   thumbnail keys are migrated automatically along with file keys
 */

import { and, eq, Imagescript, ne, RouteHandler } from "@deps";
import { getAuthContext } from "@utils/auth/context.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { AppHttpException, throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { getStorage } from "@services/storage/index.ts";
import { completeStoragePathForThumbnail } from "@constants/storage-paths.ts";
import { uploadDocumentThumbnailRoute } from "@routes/documents/thumbnail-upload.route.ts";

// storageMetadata used for path/size/dimensions only

import { getDocumentPermissionService } from "@services/documents-permission/index.ts";
import { DB_ENUM_ENCRYPTION_MODE, DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import { DataEncryptionHelperService } from "@services/encryption/data-encryption.helper.ts";
import { getUserAsymmetricKeysService } from "@services/user/index.ts";
import { getEncryptionKeySharingService } from "@services/encryption/singletons.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Handler for POST /api/documents/:id/thumbnail
 * Uploads a thumbnail image for a document
 */
export const uploadDocumentThumbnailHandler: RouteHandler<typeof uploadDocumentThumbnailRoute> = async (c) => {
  const traceService = getTraceContext();
  const db = await getTenantDB();

  try {
    const { userId, environmentId } = getAuthContext(c);
    const { id: documentId } = c.req.valid("param");

    traceService.addBreadcrumb("handler", "Thumbnail upload requested", "info", {
      documentId,
    });

    // Get thumbnail data from request body
    const thumbnailData = await c.req.arrayBuffer();

    // Validate thumbnail size (max 1MB)
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

    // Validate it's a valid image
    let imageWidth: number;
    let imageHeight: number;

    try {
      const image = await Imagescript.decode(thumbnailBytes);
      imageWidth = image.width;
      imageHeight = image.height;
    } catch (_error) {
      throwHttpError("UPLOAD.THUMBNAIL_INVALID_JPEG");
    }

    traceService.addBreadcrumb("handler", "Thumbnail validated", "info", {
      size: thumbnailBytes.length,
      width: imageWidth,
      height: imageHeight,
    });

    // Check if document exists and user has permission
    const permissionService = getDocumentPermissionService();
    const permissionLevel = await permissionService.getAccessLevel(documentId, userId);

    if (permissionLevel === null) {
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // User must own the document (ADMIN permission) to upload thumbnail
    if (!permissionLevelMeets(permissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN)) {
      await useLogger(LoggerLevels.warn, {
        message: "Insufficient permissions to upload thumbnail",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "thumbnail_upload_permission_denied",
        details: {
          documentId,
          userId,
          permissionLevel,
        },
      });

      throwHttpError("COMMON.FORBIDDEN");
    }

    // Get document with storage metadata
    const [documentRecord] = await db
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

    if (!documentRecord) {
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    // Generate thumbnail storage path
    const thumbnailPath = completeStoragePathForThumbnail(
      environmentId,
      documentRecord.storage.id,
    );

    traceService.addBreadcrumb("handler", "Uploading thumbnail to storage", "info", {
      thumbnailPath,
    });

    // Get user's encryption key (user master key or app key)
    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(c);

    // Encrypt thumbnail with a fresh random data key
    // encryptionResult.data = encrypted thumbnail bytes
    // encryptionResult.encryptedMasterKey = thumbnailDataKey encrypted with user's master key
    const encryptionResult = await DataEncryptionHelperService.encryptDataWithKey(
      encryptionKey.key,
      thumbnailBytes,
    );

    traceService.addBreadcrumb("handler", "Thumbnail encrypted", "info", {
      originalSize: thumbnailBytes.length,
      encryptedSize: encryptionResult.data.length,
    });

    // Upload encrypted thumbnail to storage
    const storage = getStorage();
    await storage.uploadFile(thumbnailPath, encryptionResult.data);

    // Store the thumbnail encrypted master key in ALL active, non-public, APP_CONTROLLED rows
    // for this document. For APP_CONTROLLED encryption, the same app key wraps the thumbnail
    // data key for all users — so the same encryptedMasterKey value works for everyone.
    // For USER_CONTROLLED rows, we update only the owner's row (the uploader). Shared users
    // with USER_CONTROLLED rows get their own wrapped key via the sharing flow.
    const ownerUpdateResult = await db.update(tenantTables.documentsDataKeys)
      .set({
        thumbnailEncryptedMasterKey: encryptionResult.encryptedMasterKey,
      })
      .where(
        and(
          eq(tenantTables.documentsDataKeys.documentId, documentId),
          eq(tenantTables.documentsDataKeys.userId, userId),
          eq(tenantTables.documentsDataKeys.isActive, true),
        ),
      )
      .returning({ id: tenantTables.documentsDataKeys.id });

    if (ownerUpdateResult.length === 0) {
      await useLogger(LoggerLevels.warn, {
        message: "No documentsDataKeys row found for document owner during thumbnail upload",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "thumbnail_upload_no_owner_key_row",
        details: { documentId, userId },
      });
    }

    // Also propagate to all APP_CONTROLLED shared users' rows (non-public shares)
    // They use the same app key, so the same encrypted thumbnail key works for them
    await db.update(tenantTables.documentsDataKeys)
      .set({
        thumbnailEncryptedMasterKey: encryptionResult.encryptedMasterKey,
      })
      .where(
        and(
          eq(tenantTables.documentsDataKeys.documentId, documentId),
          ne(tenantTables.documentsDataKeys.userId, userId),
          eq(tenantTables.documentsDataKeys.isActive, true),
          eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
          eq(tenantTables.documentsDataKeys.isPublicShare, false),
        ),
      );

    // For ASYMMETRIC shared user rows (USER_CONTROLLED sharing), the thumbnail key
    // must be ECIES re-encrypted with each recipient's public key using the uploader's master key.
    // This covers shared users who received access via inheritance or direct sharing.
    try {
      const asymmetricRows = await db
        .select({
          id: tenantTables.documentsDataKeys.id,
          userId: tenantTables.documentsDataKeys.userId,
        })
        .from(tenantTables.documentsDataKeys)
        .where(
          and(
            eq(tenantTables.documentsDataKeys.documentId, documentId),
            ne(tenantTables.documentsDataKeys.userId, userId),
            eq(tenantTables.documentsDataKeys.isActive, true),
            eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC),
            eq(tenantTables.documentsDataKeys.isPublicShare, false),
          ),
        );

      if (asymmetricRows.length > 0) {
        const asymmetricKeysService = getUserAsymmetricKeysService();
        const keySharingService = getEncryptionKeySharingService();

        for (const row of asymmetricRows) {
          try {
            const recipientPublicKey = await asymmetricKeysService.getPublicKey(row.userId ?? "");
            if (!recipientPublicKey) continue;

            const eciesEncryptedThumbnailKey = await keySharingService.shareDataMasterKeyAsymmetric(
              encryptionResult.encryptedMasterKey,
              encryptionKey.key,
              recipientPublicKey,
            );

            await db.update(tenantTables.documentsDataKeys)
              .set({ thumbnailEncryptedMasterKey: eciesEncryptedThumbnailKey })
              .where(eq(tenantTables.documentsDataKeys.id, row.id));
          } catch (asymError) {
            await useLogger(LoggerLevels.warn, {
              message: "Failed to propagate thumbnail key to asymmetric shared user",
              section: loggerAppSections.DOCUMENTS,
              messageKey: "thumbnail_upload_asymmetric_share_failed",
              details: {
                documentId,
                recipientUserId: row.userId,
                error: asymError instanceof Error ? asymError.message : String(asymError),
              },
            });
          }
        }
      }
    } catch (propagationError) {
      // Non-fatal: thumbnail still uploaded; shared users can't view it for now
      await useLogger(LoggerLevels.warn, {
        message: "Failed to propagate thumbnail key to asymmetric shared users",
        section: loggerAppSections.DOCUMENTS,
        messageKey: "thumbnail_upload_asymmetric_propagation_failed",
        details: { documentId, error: propagationError instanceof Error ? propagationError.message : String(propagationError) },
      });
    }

    // Update storage metadata with thumbnail path and dimensions only
    // The encryption key is stored in documentsDataKeys.thumbnailEncryptedMasterKey (not here)
    await db.update(tenantTables.storageMetadata)
      .set({
        thumbnailPath,
        thumbnailSize: thumbnailBytes.length, // Store original size, not encrypted size
        thumbnailWidth: imageWidth,
        thumbnailHeight: imageHeight,
      })
      .where(eq(tenantTables.storageMetadata.id, documentRecord.storage.id));

    traceService.addBreadcrumb("handler", "Thumbnail uploaded successfully", "info", {
      documentId,
      thumbnailSize: thumbnailBytes.length,
    });

    return c.json({
      success: true,
      thumbnailUrl: `/api/documents/${documentId}/preview`,
      thumbnailSize: thumbnailBytes.length,
      thumbnailWidth: imageWidth,
      thumbnailHeight: imageHeight,
    }, 200);
  } catch (error) {
    if (error instanceof AppHttpException) {
      throw error;
    }

    await useLogger(LoggerLevels.error, {
      message: "Thumbnail upload failed",
      section: loggerAppSections.DOCUMENTS,
      messageKey: "thumbnail_upload_error",
      raw: error,
    });

    throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
  }
};
