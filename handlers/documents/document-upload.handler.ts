/**
 * @file handlers/documents/document-upload.handler.ts
 * @description Handler for document file uploads with streaming multipart parsing
 */

import { throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { detectMimeTypeFromBytes, getMimeTypeFromExtension, isMimeTypeSupported } from "@utils/shared/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { uploadDocumentRoute } from "@routes/documents/documents.route.ts";
import { IFileUploadMetadata, SchemaDocumentResponse } from "@models/documents/index.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { getDocumentCommentService } from "@services/documents-comments/index.ts";
import { getDocumentUploadService } from "@services/documents/index.ts";
import { TIMING_PROFILES } from "@utils/shared/timing.ts";
import { validateAndLogSecurityThreats } from "@utils/documents/security-logging.ts";
import { type ISharedUser, SchemaSharedUser } from "@models/documents/chunked-upload.model.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { eq } from "@deps";
import { getDocumentSharingService } from "@services/documents-sharing/index.ts";
import { defineHandler } from "@handlers/shared/index.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { ScopedMultipartParser } from "@services/upload-processor/scoped-multipart-parser.service.ts";
import { traced } from "@services/tracing/index.ts";

const MAGIC_BYTES_BUFFER_SIZE = 4100;

function createCompositeStream(
  prefix: Uint8Array,
  reader: ReadableStreamDefaultReader<Uint8Array>,
): ReadableStream<Uint8Array> {
  let prefixSent = false;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!prefixSent) {
        prefixSent = true;
        if (prefix.length > 0) {
          controller.enqueue(prefix);
        }
        return;
      }
      const { done, value } = await reader.read();
      if (done) {
        controller.close();
        return;
      }
      controller.enqueue(value);
    },
    cancel() {
      reader.releaseLock();
    },
  });
}

export const uploadDocumentHandler = defineHandler(
  {
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    route: uploadDocumentRoute,
    operationName: "document_upload",
    timingProfile: TIMING_PROFILES.STANDARD,
    responseSchema: SchemaDocumentResponse,
    errorKey: "DOCUMENT.UPLOAD_FAILED",
  },
  async ({ userId, environmentId, traceService, c }) => {
    const keyDetails = await traced("DataAccessService.getEncryptionKeyForDataMasterKey", "service", async (span) => {
      const result = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
      span.attributes["encryption.key_type"] = result.type;
      return result;
    });

    traceService.addBreadcrumb("handler", `Using ${keyDetails.type} encryption key`, "info", {
      encryptionMode: keyDetails.type,
    });

    const parseResult = await traced("ScopedMultipartParser.parse", "http.server", async (span) => {
      const result = await ScopedMultipartParser.parse(c.req.raw);
      span.attributes["parser.file_found"] = result.file !== null;
      span.attributes["parser.approximate_file_size"] = result.approximateFileSize;
      span.attributes["parser.field_count"] = result.fields.size;
      if (result.file) {
        span.attributes["parser.file_name"] = result.file.filename;
        span.attributes["parser.content_type"] = result.file.contentType;
      }
      return result;
    });

    if (!parseResult.file) {
      throwHttpError("UPLOAD.NO_FILE_PROVIDED");
    }

    const { file, fields, approximateFileSize } = parseResult;

    traceService.addBreadcrumb("handler", "Document upload started", "info", {
      fileName: file.filename,
      approximateFileSize,
      mimeType: file.contentType,
    });

    // deno-lint-ignore no-control-regex
    const name = fields.get("name") || file.filename.replace(/[/\\\x00]/g, "_").substring(0, 255);
    const description = fields.get("description") || null;
    const folderId = fields.get("folderId") || null;
    const tagsStr = fields.get("tags");
    const metadataStr = fields.get("metadata");
    const sharedUsersStr = fields.get("sharedUsers");
    const initialComment = fields.get("initialComment") || null;

    let tags: string[] = [];
    let metadata: Record<string, unknown> = {};
    let sharedUsers: ISharedUser[] = [];

    if (tagsStr) {
      try {
        tags = JSON.parse(tagsStr);
        if (!Array.isArray(tags)) {
          throwHttpError("UPLOAD.TAGS_NOT_ARRAY");
        }
      } catch (_error) {
        throwHttpError("UPLOAD.TAGS_INVALID_JSON");
      }
    }

    if (metadataStr) {
      try {
        metadata = JSON.parse(metadataStr);
        if (typeof metadata !== "object" || metadata === null || Array.isArray(metadata)) {
          throwHttpError("UPLOAD.METADATA_NOT_OBJECT");
        }
      } catch (_error) {
        throwHttpError("UPLOAD.METADATA_INVALID_JSON");
      }
    }

    if (sharedUsersStr) {
      try {
        const parsedSharedUsers = JSON.parse(sharedUsersStr);
        if (!Array.isArray(parsedSharedUsers)) {
          throwHttpError("UPLOAD.SHARED_USERS_NOT_ARRAY");
        }

        sharedUsers = parsedSharedUsers.map((user: unknown) => {
          const validated = SchemaSharedUser.safeParse(user);
          if (!validated.success) {
            throwHttpErrorWithCustomMessage(
              "COMMON.BAD_REQUEST",
              `Invalid shared user format: ${validated.error.message}`,
            );
          }
          return validated.data;
        });
      } catch (error) {
        if (error instanceof AppHttpException) {
          throw error;
        }
        throwHttpError("UPLOAD.SHARED_USERS_INVALID_JSON");
      }
    }

    const magicPrefix: Uint8Array[] = [];
    let magicBytesRead = 0;

    const magicReader = file.stream.getReader();
    try {
      while (magicBytesRead < MAGIC_BYTES_BUFFER_SIZE) {
        const { done, value } = await magicReader.read();
        if (done) break;
        magicPrefix.push(value);
        magicBytesRead += value.byteLength;
      }
    } catch (error) {
      magicReader.releaseLock();
      throw error;
    }

    const magicBytesBuffer = new Uint8Array(magicBytesRead);
    let offset = 0;
    for (const chunk of magicPrefix) {
      magicBytesBuffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const magicBytes = magicBytesBuffer.subarray(0, Math.min(MAGIC_BYTES_BUFFER_SIZE, magicBytesRead));

    let correctedMimeType = file.contentType;
    const magicMimeType = detectMimeTypeFromBytes(magicBytes);

    if (magicMimeType) {
      if (!isMimeTypeSupported(magicMimeType)) {
        magicReader.releaseLock();
        await file.stream.cancel();
        throwHttpErrorWithCustomMessage(
          "COMMON.BAD_REQUEST",
          `Unsupported file type: ${magicMimeType}`,
        );
      }

      correctedMimeType = magicMimeType;
      traceService.addBreadcrumb("handler", "MIME type detected from magic bytes", "info", {
        originalMimeType: file.contentType || "empty",
        detectedMimeType: magicMimeType,
      });
    } else if (file.contentType === "application/octet-stream" || !file.contentType) {
      const fileExtension = file.filename.split(".").pop();
      if (fileExtension) {
        const detectedMimeType = getMimeTypeFromExtension(fileExtension);
        if (detectedMimeType !== "application/octet-stream") {
          if (!isMimeTypeSupported(detectedMimeType)) {
            magicReader.releaseLock();
            await file.stream.cancel();
            throwHttpErrorWithCustomMessage(
              "COMMON.BAD_REQUEST",
              `Unsupported file type: ${detectedMimeType}`,
            );
          }

          correctedMimeType = detectedMimeType;
          traceService.addBreadcrumb("handler", "MIME type corrected from extension", "info", {
            originalMimeType: file.contentType || "empty",
            detectedMimeType,
            fileExtension,
          });
        }
      }
    }

    if (!isMimeTypeSupported(correctedMimeType)) {
      magicReader.releaseLock();
      await file.stream.cancel();
      throwHttpErrorWithCustomMessage(
        "COMMON.BAD_REQUEST",
        `Unsupported file type: ${correctedMimeType || "unknown"}`,
      );
    }

    const inputsToValidate: Record<string, string> = {};
    if (name) inputsToValidate.name = name;
    if (description) inputsToValidate.description = description;
    if (folderId) inputsToValidate.folderId = folderId;
    if (tagsStr) inputsToValidate.tags = tagsStr;
    if (metadataStr) inputsToValidate.metadata = metadataStr;
    if (sharedUsersStr) inputsToValidate.sharedUsers = sharedUsersStr;
    if (initialComment) inputsToValidate.initialComment = initialComment;

    const threatsDetected = await traced("validateAndLogSecurityThreats", "service", async (span) => {
      span.attributes["validation.input_fields"] = Object.keys(inputsToValidate);
      const result = await validateAndLogSecurityThreats(c, inputsToValidate);
      span.attributes["validation.threats_detected"] = result;
      return result;
    });
    if (threatsDetected) {
      throwHttpError("COMMON.BAD_REQUEST");
    }

    if (sharedUsers.length > 0) {
      await traced("validateSharedUsers", "auth", async (span) => {
        span.attributes["shared_users.count"] = sharedUsers.length;
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
              `User ${sharedUser.userId} not found`,
            );
          }

          const permissionLevel = sharedUser.permissionLevel as string;
          if (!(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as string[]).includes(permissionLevel)) {
            throwHttpErrorWithCustomMessage(
              "COMMON.BAD_REQUEST",
              `Invalid permission level: ${sharedUser.permissionLevel}`,
            );
          }

          if (permissionLevel === DB_ENUM_PERMISSION_ACCESS_LEVEL.ADMIN) {
            throwHttpError("UPLOAD.ADMIN_PERMISSION_FORBIDDEN");
          }
        }

        span.attributes["shared_users.validated"] = true;
      });

      traceService.addBreadcrumb("handler", "Shared users validated", "info", {
        sharedUsersCount: sharedUsers.length,
      });
    }

    const uploadMetadata: IFileUploadMetadata = {
      name,
      description,
      folderId,
      mimeType: correctedMimeType,
      fileSize: approximateFileSize,
      tags,
      metadata,
    };

    const uploadService = getDocumentUploadService();
    const result = await uploadService.processUpload(
      createCompositeStream(magicBytesBuffer, magicReader),
      uploadMetadata,
      userId,
      {
        encryptionKey: keyDetails.key,
        encryptionMode: keyDetails.type,
      },
      environmentId,
    );

    traceService.addBreadcrumb("handler", "Document upload completed", "info", {
      documentId: result.id,
    });

    if (sharedUsers.length > 0) {
      try {
        const sharingService = getDocumentSharingService();

        for (const sharedUser of sharedUsers) {
          const permissionLevel = sharedUser.permissionLevel as string;

          await sharingService.shareWithUsers(
            result.id,
            [sharedUser.userId],
            permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
            userId,
            keyDetails.key,
          );

          traceService.addBreadcrumb("handler", "Document shared with user", "info", {
            documentId: result.id,
            userId: sharedUser.userId,
            permissionLevel: sharedUser.permissionLevel,
            isNotify: sharedUser.isNotify,
          });
        }
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Failed to share document with users after upload",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "upload_share_error",
          details: {
            documentId: result.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    if (initialComment) {
      try {
        await getDocumentCommentService().createComment(
          result.id,
          { content: initialComment },
          userId,
        );

        traceService.addBreadcrumb("handler", "Initial comment created", "info", {
          documentId: result.id,
        });
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Failed to create initial comment after upload",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "upload_initial_comment_error",
          details: {
            documentId: result.id,
            error: error instanceof Error ? error.message : String(error),
          },
        });
      }
    }

    return {
      data: result,
      status: 201,
    };
  },
);
