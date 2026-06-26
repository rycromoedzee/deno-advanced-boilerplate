/**
 * @file services/documents/document-download.service.ts
 * @description Service for handling file downloads and streaming with decryption
 *
 * This service processes file downloads by:
 * 1. Verifying user permissions
 * 2. Retrieving document and storage metadata
 * 3. Decrypting files using FileEncryptionService
 * 4. Supporting range requests for media streaming
 * 5. Incrementing download counts and updating access timestamps
 * 6. Logging access for audit trail
 */

import { getTenantDB, tenantTables } from "@db/index.ts";
import { and, eq } from "@deps";
import { FileEncryptionService } from "@services/encryption/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { DocumentCrudHelpers } from "./document-crud.helpers.ts";
import { PublicSharingService } from "../public-sharing/public-sharing.service.ts";
import { DocumentAccessLogService } from "@services/documents-stats/unified-access-log.service.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/singletons.ts";
import { DataAccessService } from "@services/encryption/data-access.service.ts";
import { DataEncryptionHelperService } from "@services/encryption/data-encryption.helper.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";

/**
 * Download result interface
 */
export interface IDownloadResult {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  mimeType: string;
  fileSize: number;
  contentLength?: number;
  contentRange?: string;
  status: 200 | 206 | 404 | 403 | 500; // Specific HTTP status codes
}

/**
 * Preview result interface
 */
export interface IPreviewResult {
  stream: ReadableStream<Uint8Array>;
  fileName: string;
  mimeType: string;
  fileSize: number;
  status: 200 | 404;
}

/**
 * Range request interface
 */
export interface IRangeRequest {
  start?: number;
  end?: number;
}

export interface IPublicAccessMetadata {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
}

export interface IPublicDocumentDownloadRequest {
  documentId: string;
  shareId: string;
  shareKey: string;
  password?: string;
  dataKeyId: string;
  metadata?: IPublicAccessMetadata;
}

export interface IPublicDocumentStreamRequest extends IPublicDocumentDownloadRequest {
  range?: IRangeRequest;
}

interface IAuthenticatedDownloadRequest {
  documentId: string;
  userId: string;
  userEncryptionKey: Uint8Array;
}

interface IAuthenticatedStreamRequest extends IAuthenticatedDownloadRequest {
  range?: IRangeRequest;
}

/**
 * Download Service
 *
 * Handles file download and streaming operations with decryption, permission checking,
 * and access tracking. Supports range requests for efficient media streaming.
 */
export class DocumentDownloadService {
  private publicSharingService: PublicSharingService;
  private logAccess: DocumentAccessLogService;
  private dataAccessService = new DataAccessService({
    tableName: tenantTables.documentsDataKeys,
    resourceIdColumn: "documentId",
  });

  constructor(logAccess?: DocumentAccessLogService) {
    this.publicSharingService = new PublicSharingService(
      {
        tableName: tenantTables.documentsDataKeys,
        resourceIdColumn: "documentId",
      },
    );
    this.logAccess = logAccess || getDocumentAccessLogService();
  }

  /**
   * Downloads a document with decryption
   *
   * @param documentId - Document ID to download
   * @param userId - ID of the user downloading the document
   * @param userEncryptionKey - User's encryption key for decrypting the document master key
   * @param ipAddress - IP address of the downloader (for access logging)
   * @param userAgent - User agent of the downloader (for access logging)
   * @returns Promise<IDownloadResult> - Download result with decrypted stream
   */
  download(
    documentIdOrRequest: string | IPublicDocumentDownloadRequest,
    userId?: string,
    userEncryptionKey?: Uint8Array,
  ): Promise<IDownloadResult> {
    if (typeof documentIdOrRequest === "string") {
      if (!userId || !userEncryptionKey) {
        throw new Error("Invalid arguments for authenticated download");
      }

      return this.downloadAuthenticated({
        documentId: documentIdOrRequest,
        userId,
        userEncryptionKey,
      });
    }

    return this.downloadPublic(documentIdOrRequest);
  }

  stream(
    documentIdOrRequest: string | IPublicDocumentStreamRequest,
    userId?: string,
    userEncryptionKey?: Uint8Array,
    range?: IRangeRequest,
  ): Promise<IDownloadResult> {
    if (typeof documentIdOrRequest === "string") {
      if (!userId || !userEncryptionKey) {
        throw new Error("Invalid arguments for authenticated stream");
      }

      return this.streamAuthenticated({
        documentId: documentIdOrRequest,
        userId,
        userEncryptionKey,
        range,
      });
    }

    return this.streamPublic(documentIdOrRequest);
  }

  /**
   * Gets the thumbnail preview for a document
   *
   * @param documentId - Document ID
   * @param userId - User ID requesting the preview
   * @param userEncryptionKey - User's encryption key for decrypting thumbnails
   * @returns Promise<IPreviewResult> - Preview result with thumbnail data
   */
  async preview(documentId: string, userId: string, userEncryptionKey: Uint8Array): Promise<IPreviewResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentDownloadService.preview",
      {
        service: "DocumentDownloadService",
        method: "preview",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        // Check permission level - requires read or higher
        const permissionCheck = await this.dataAccessService.checkPermission(
          documentId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );

        const permissionLevel = permissionCheck.currentLevel ?? null;

        if (!permissionCheck.hasPermission && permissionLevel === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionCheck.hasPermission) {
          await useLogger(LoggerLevels.warn, {
            message: "Insufficient permissions for document preview",
            section: loggerAppSections.DEBUG,
            messageKey: "preview_access_denied",
            details: { documentId, userId, permissionLevel },
          });

          throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
        }

        // Lazily migrate an ASYMMETRIC (shared) key to USER_CONTROLLED on first
        // authenticated access. This was previously a hidden side effect of
        // checkPermission; it is now an explicit, opt-in step (backlog #2).
        await this.dataAccessService.ensureUserControlledDataKey(documentId, userId, userEncryptionKey);

        // Fetch document and storage metadata
        const documentRecord = await this.fetchDocumentWithStorage(documentId);

        if (!documentRecord) {
          await useLogger(LoggerLevels.warn, {
            message: "Document not found for preview",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "preview_document_not_found",
            details: { documentId, userId },
          });

          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const { storage } = documentRecord;

        // Check if thumbnail exists
        if (!storage.thumbnailPath) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        // Fetch the user's thumbnail encrypted master key from documentsDataKeys
        // Thumbnail key lives in documentsDataKeys alongside the file key
        // This ensures it gets migrated with master key changes and shared with other users
        const userDataKey = await this.fetchActiveUserDataKey(documentId, userId);
        const thumbnailEncryptedMasterKey = userDataKey?.thumbnailEncryptedMasterKey as Uint8Array | null | undefined;

        if (!thumbnailEncryptedMasterKey) {
          // No encryption key found - thumbnail needs to be re-uploaded
          await useLogger(LoggerLevels.warn, {
            message: "Thumbnail encryption key not found in documentsDataKeys - thumbnail needs re-upload",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "preview_thumbnail_key_not_found",
            details: { documentId, thumbnailPath: storage.thumbnailPath },
          });

          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const encryptedKeyBytes: Uint8Array = thumbnailEncryptedMasterKey!;

        const { getStorage } = await import("@services/storage/index.ts");
        const storageService = getStorage();

        const downloadResult = await storageService.downloadFile(storage.thumbnailPath!);

        // Decrypt the thumbnail data
        const encryptedData: Uint8Array[] = [];
        const reader = downloadResult.stream.getReader();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            encryptedData.push(value);
          }
        } finally {
          reader.releaseLock();
        }

        // Combine chunks
        const totalLength = encryptedData.reduce((acc, chunk) => acc + chunk.length, 0);
        const combinedEncrypted = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of encryptedData) {
          combinedEncrypted.set(chunk, offset);
          offset += chunk.length;
        }

        // Decrypt thumbnail using user's encryption key
        const decrypted = await DataEncryptionHelperService.decryptDataWithKey(
          userEncryptionKey,
          encryptedKeyBytes,
          combinedEncrypted,
        );

        // Create stream from decrypted data
        const decryptedStream = new ReadableStream({
          start(controller) {
            if (decrypted instanceof Uint8Array) {
              controller.enqueue(decrypted);
            } else {
              controller.enqueue(new TextEncoder().encode(String(decrypted)));
            }
            controller.close();
          },
        });

        const decryptedSize = decrypted instanceof Uint8Array ? decrypted.length : new TextEncoder().encode(String(decrypted)).length;

        return {
          stream: decryptedStream,
          fileName: `${documentRecord.document.name}-thumbnail.jpg`,
          mimeType: "image/jpeg",
          fileSize: decryptedSize,
          status: 200,
        };
      },
    );
  }

  private async downloadAuthenticated(
    { documentId, userId, userEncryptionKey }: IAuthenticatedDownloadRequest,
  ): Promise<IDownloadResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentDownloadService.downloadAuthenticated",
      {
        service: "DocumentDownloadService",
        method: "downloadAuthenticated",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const permissionCheck = await this.dataAccessService.checkPermission(
          documentId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.DOWNLOAD,
        );

        const permissionLevel = permissionCheck.currentLevel ?? null;

        if (!permissionCheck.hasPermission && permissionLevel === null) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionCheck.hasPermission) {
          this.logAccess.logDocumentAccess(
            documentId,
            userId,
            "download",
            "direct",
          );

          throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
        }

        // Lazily migrate an ASYMMETRIC (shared) key to USER_CONTROLLED on first
        // authenticated access — now an explicit step (was a checkPermission
        // side effect; backlog #2).
        await this.dataAccessService.ensureUserControlledDataKey(documentId, userId, userEncryptionKey);

        const documentRecord = await this.fetchDocumentWithStorage(documentId);

        if (!documentRecord) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const dataKey = await this.fetchActiveUserDataKey(documentId, userId);

        if (!dataKey) {
          this.logAccess.logDocumentAccess(
            documentId,
            userId,
            "download",
            "direct",
          );

          throwHttpError("DOCUMENT.DOWNLOAD_FAILED");
        }

        const decryptedStream = await FileEncryptionService.decryptWithKey(
          userEncryptionKey,
          dataKey.encryptedMasterKey,
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          documentRecord.storage.folderPath,
          documentRecord.storage.encryptionChunkSize,
        );

        // Defer the two success-path bookkeeping writes off the response path.
        // Bare inline fire-and-forget still blocks the flush (local libSQL sync
        // execute under SQLITE_BUSY contention); defer:true moves them past it,
        // snapshotting and re-establishing the tenant context inside the macrotask.
        fireAndForgetOperation(
          "DocumentDownloadService.incrementDownloadCount",
          () => DocumentCrudHelpers.incrementDownloadCount(documentId),
          { defer: true, section: loggerAppSections.DOCUMENTS },
        );

        fireAndForgetOperation(
          "DocumentDownloadService.logDocumentAccess",
          () => this.logAccess.logDocumentAccess(documentId, userId, "download", "direct"),
          { defer: true, section: loggerAppSections.DOCUMENTS },
        );

        return {
          stream: decryptedStream,
          fileName: documentRecord.storage.originalName,
          mimeType: documentRecord.storage.mimeType,
          fileSize: documentRecord.storage.originalFileSize,
          status: 200,
        };
      },
    );
  }

  private async streamAuthenticated(
    { documentId, userId, userEncryptionKey, range }: IAuthenticatedStreamRequest,
  ): Promise<IDownloadResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentDownloadService.streamAuthenticated",
      {
        service: "DocumentDownloadService",
        method: "streamAuthenticated",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const permissionCheck = await this.dataAccessService.checkPermission(
          documentId,
          userId,
          DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
        );

        const permissionLevel = permissionCheck.currentLevel ?? null;

        if (!permissionCheck.hasPermission && permissionLevel === null) {
          await this.logAccess.logDocumentAccess(
            documentId,
            userId,
            "stream",
            "direct",
          );

          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        if (!permissionCheck.hasPermission) {
          await useLogger(LoggerLevels.warn, {
            message: "Insufficient permissions for document streaming",
            section: loggerAppSections.DEBUG,
            messageKey: "stream_access_denied",
            details: { documentId, userId, permissionLevel },
          });

          throwHttpError("AUTH.INSUFFICIENT_PERMISSIONS");
        }

        // Lazily migrate an ASYMMETRIC (shared) key to USER_CONTROLLED on first
        // authenticated access — now an explicit step (was a checkPermission
        // side effect; backlog #2).
        await this.dataAccessService.ensureUserControlledDataKey(documentId, userId, userEncryptionKey);

        const documentRecord = await this.fetchDocumentWithStorage(documentId);

        if (!documentRecord) {
          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const dataKey = await this.fetchActiveUserDataKey(documentId, userId);

        if (!dataKey) {
          await this.logAccess.logDocumentAccess(
            documentId,
            userId,
            "stream",
            "direct",
          );

          throwHttpError("DOCUMENT.DECRYPTION_FAILED");
        }

        if (range && (range.start !== undefined || range.end !== undefined)) {
          await useLogger(LoggerLevels.info, {
            message: "Range request detected - decrypting full file",
            section: loggerAppSections.DEBUG,
            messageKey: "stream_range_request",
            details: { documentId, userId, range },
          });
        }

        const decryptedStream = await FileEncryptionService.decryptWithKey(
          userEncryptionKey,
          dataKey.encryptedMasterKey,
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          documentRecord.storage.folderPath,
          documentRecord.storage.encryptionChunkSize,
        );

        await DocumentCrudHelpers.updateLastAccessed(documentId);

        await this.logAccess.logDocumentAccess(
          documentId,
          userId,
          "stream",
          "direct",
        );

        return {
          stream: decryptedStream,
          fileName: documentRecord.storage.originalName,
          mimeType: documentRecord.storage.mimeType,
          fileSize: documentRecord.storage.originalFileSize,
          status: 200,
        };
      },
    );
  }

  private async downloadPublic(
    { documentId, shareId, shareKey, password, dataKeyId, metadata }: IPublicDocumentDownloadRequest,
  ): Promise<IDownloadResult> {
    const truncatedShareId = shareId.substring(0, 8) + "...";

    return await tracedWithServiceErrorHandling(
      "DocumentDownloadService.downloadPublic",
      {
        service: "DocumentDownloadService",
        method: "downloadPublic",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, shareId: truncatedShareId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const documentRecord = await this.fetchDocumentWithStorage(documentId);

        if (!documentRecord) {
          await useLogger(LoggerLevels.warn, {
            message: "Document not found for public download",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "download_public_document_not_found",
            details: { documentId, shareId: truncatedShareId },
          });

          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        const dataKey = await this.fetchPublicDataKey(dataKeyId);

        if (!dataKey) {
          await useLogger(LoggerLevels.error, {
            message: "Data key not found for public download",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "download_public_datakey_not_found",
            details: { documentId, dataKeyId },
          });

          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        const dataMasterKey = await this.publicSharingService.getDataMasterKeyForPublicShare(
          shareId,
          shareKey,
          HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
          password,
        );

        const decryptedStream = await FileEncryptionService.decryptWithRawDataMasterKey(
          dataMasterKey,
          documentRecord.storage.folderPath,
          documentRecord.storage.encryptionChunkSize,
        );

        DocumentCrudHelpers.incrementDownloadCount(documentId);
        this.publicSharingService.incrementPublicShareAccessCount(shareId);

        await this.logAccess.logDocumentAccess(
          documentId,
          null,
          "download",
          "public_share",
          {
            ...metadata,
            dataKeyId,
          },
        );

        return {
          stream: decryptedStream,
          fileName: documentRecord.storage.originalName,
          mimeType: documentRecord.storage.mimeType,
          fileSize: documentRecord.storage.originalFileSize,
          status: 200,
        };
      },
    );
  }

  private async streamPublic(
    { documentId, shareId, shareKey, password, dataKeyId, range, metadata }: IPublicDocumentStreamRequest,
  ): Promise<IDownloadResult> {
    const truncatedShareId = shareId.substring(0, 8) + "...";

    return await tracedWithServiceErrorHandling(
      "DocumentDownloadService.streamPublic",
      {
        service: "DocumentDownloadService",
        method: "streamPublic",
        section: loggerAppSections.DOCUMENTS,
        details: { documentId, shareId: truncatedShareId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["share_id_length"] = shareId.length;
        span.attributes["has_password"] = !!password;
        span.attributes["has_range"] = !!(range && (range.start !== undefined || range.end !== undefined));

        const documentRecord = await traced(
          "DocumentDownloadService.streamPublic.fetchDocument",
          "db.query",
          async (querySpan) => {
            querySpan.attributes["document_id"] = documentId;

            return await this.fetchDocumentWithStorage(documentId);
          },
        );

        if (!documentRecord) {
          span.attributes["error"] = "document_not_found";

          await useLogger(LoggerLevels.warn, {
            message: "Document not found for public streaming",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "stream_public_document_not_found",
            details: { documentId, shareId: truncatedShareId },
          });

          throwHttpError("DOCUMENT.NOT_FOUND");
        }

        span.attributes["file_size"] = documentRecord.storage.originalFileSize;
        span.attributes["mime_type"] = documentRecord.storage.mimeType;
        span.attributes["encryption_chunk_size"] = documentRecord.storage.encryptionChunkSize;

        const dataKey = await traced(
          "DocumentDownloadService.streamPublic.fetchDataKey",
          "db.query",
          async (querySpan) => {
            querySpan.attributes["data_key_id"] = dataKeyId;

            return await this.fetchPublicDataKey(dataKeyId);
          },
        );

        if (!dataKey) {
          span.attributes["error"] = "data_key_not_found";

          await useLogger(LoggerLevels.error, {
            message: "Data key not found for public streaming",
            section: loggerAppSections.DOCUMENTS_DOWNLOAD,
            messageKey: "stream_public_datakey_not_found",
            details: { documentId, dataKeyId },
          });

          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        if (range && (range.start !== undefined || range.end !== undefined)) {
          span.attributes["range_start"] = range.start;
          span.attributes["range_end"] = range.end;

          await useLogger(LoggerLevels.info, {
            message: "Range request detected for public stream - decrypting full file",
            section: loggerAppSections.DEBUG,
            messageKey: "stream_public_range_request",
            details: { documentId, shareId: truncatedShareId, range },
          });
        }

        const dataMasterKey = await traced(
          "DocumentDownloadService.streamPublic.getDataMasterKey",
          "encryption",
          async (encryptionSpan) => {
            encryptionSpan.attributes["share_id_length"] = shareId.length;
            encryptionSpan.attributes["has_password"] = !!password;

            return await this.publicSharingService.getDataMasterKeyForPublicShare(
              shareId,
              shareKey,
              HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
              password,
            );
          },
        );

        const decryptedStream = await traced(
          "DocumentDownloadService.streamPublic.decryptStream",
          "encryption",
          async (encryptionSpan) => {
            encryptionSpan.attributes["file_path"] = documentRecord.storage.folderPath;
            encryptionSpan.attributes["chunk_size"] = documentRecord.storage.encryptionChunkSize;

            return await FileEncryptionService.decryptWithRawDataMasterKey(
              dataMasterKey,
              documentRecord.storage.folderPath,
              documentRecord.storage.encryptionChunkSize,
            );
          },
        );

        DocumentCrudHelpers.updateLastAccessed(documentId);
        this.publicSharingService.incrementPublicShareAccessCount(shareId);

        this.logAccess.logDocumentAccess(
          documentId,
          null,
          "stream",
          "public_share",
          {
            ...metadata,
            dataKeyId,
          },
        );

        span.attributes["success"] = true;

        return {
          stream: decryptedStream,
          fileName: documentRecord.storage.originalName,
          mimeType: documentRecord.storage.mimeType,
          fileSize: documentRecord.storage.originalFileSize,
          status: 200,
        };
      },
    );
  }

  private async fetchDocumentWithStorage(documentId: string) {
    return await traced(
      "DocumentDownloadService.fetchDocumentWithStorage",
      "db.query",
      async (span) => {
        span.attributes["document_id"] = documentId;

        const [result] = await (await getTenantDB())
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
            ),
          )
          .limit(1);

        span.attributes["found"] = !!result;
        return result ?? null;
      },
    );
  }

  private async fetchActiveUserDataKey(documentId: string, userId: string) {
    return await traced(
      "DocumentDownloadService.fetchActiveUserDataKey",
      "db.query",
      async (span) => {
        span.attributes["document_id"] = documentId;
        span.attributes["user_id"] = userId;

        const [dataKey] = await (await getTenantDB())
          .select({
            id: tenantTables.documentsDataKeys.id,
            documentId: tenantTables.documentsDataKeys.documentId,
            userId: tenantTables.documentsDataKeys.userId,
            encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
            thumbnailEncryptedMasterKey: tenantTables.documentsDataKeys.thumbnailEncryptedMasterKey,
            encryptionMode: tenantTables.documentsDataKeys.encryptionMode,
            permissionLevel: tenantTables.documentsDataKeys.permissionLevel,
            isActive: tenantTables.documentsDataKeys.isActive,
          })
          .from(tenantTables.documentsDataKeys)
          .where(
            and(
              eq(tenantTables.documentsDataKeys.documentId, documentId),
              eq(tenantTables.documentsDataKeys.userId, userId),
              eq(tenantTables.documentsDataKeys.isActive, true),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!dataKey;
        span.attributes["has_thumbnail_key"] = !!dataKey?.thumbnailEncryptedMasterKey;
        return dataKey ?? null;
      },
    );
  }

  private async fetchPublicDataKey(dataKeyId: string) {
    return await traced(
      "DocumentDownloadService.fetchPublicDataKey",
      "db.query",
      async (span) => {
        span.attributes["data_key_id"] = dataKeyId;

        const [dataKey] = await (await getTenantDB())
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
        return dataKey ?? null;
      },
    );
  }
}
