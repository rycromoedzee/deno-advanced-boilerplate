/**
 * @file handlers/media-stream/info.handler.ts
 * @description Video info handler for retrieving video metadata
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { MediaStreamService } from "@services/media-stream/media-stream.service.ts";
import { mediaInfoRoute } from "@routes/media-stream/info.route.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getSectionAccessService } from "@services/media-stream/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { loggerAppSections } from "@logger/index.ts";
import { SchemaMediaInfoResponse } from "@models/media-stream/index.ts";

/**
 * Get video file info handler
 * GET /api/video-stream/{fileId}/info
 */
export const mediaInfoHandler = defineHandler(
  {
    route: mediaInfoRoute,
    operationName: "media_info",
    entityType: "media",
    loggerSection: loggerAppSections.DOCUMENTS_STREAM,
    responseSchema: SchemaMediaInfoResponse,
  },
  async ({ params, userId }) => {
    const { section, fileId } = params;

    if (!fileId) {
      throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
    }

    // Validate section access (production) or use fileId directly (dev)
    let storageMetadataId: string;

    try {
      const sectionAccessService = getSectionAccessService();
      storageMetadataId = await sectionAccessService.validateSectionAccess(
        section,
        fileId,
        userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );
    } catch {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const fileMetadata = await MediaStreamService.getFileMetadata(storageMetadataId);

    if (!fileMetadata) {
      throwHttpError("MEDIA.FILE_NOT_FOUND");
    }

    return {
      data: {
        fileId: fileMetadata.id,
        originalName: fileMetadata.originalName,
        mimeType: fileMetadata.mimeType,
        originalFileSize: fileMetadata.originalFileSize,
        encryptedFileSize: fileMetadata.encryptedFileSize,
        streamingUrl: `/api/media-stream/${section}/${fileId}`,
        createdAt: fileMetadata.createdAt,
        updatedAt: fileMetadata.updatedAt,
      },
      status: 200 as const,
    };
  },
);
