/**
 * @file services/document-folders/folder-duplicate.service.ts
 * @description Service for folder duplication operations
 *
 * This service handles folder duplication by creating a new folder with the same metadata.
 */

import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { FolderReadService } from "./folder-read.service.ts";
import { FolderWriteService } from "./folder-write.service.ts";
import type { IDocumentFolder } from "@models/documents/folder.model.ts";

/**
 * Folder Duplicate Service
 *
 * Provides folder duplication functionality:
 * - Duplicate folders with metadata
 * - Permission checking
 */
export class FolderDuplicateService {
  private readService: FolderReadService;
  private writeService: FolderWriteService;

  constructor(
    readService?: FolderReadService,
    writeService?: FolderWriteService,
  ) {
    this.readService = readService || new FolderReadService();
    this.writeService = writeService || new FolderWriteService();
  }

  /**
   * Duplicates a folder with all its contents
   *
   * @param folderId - ID of the folder to duplicate
   * @param newName - Name for the duplicated folder
   * @param parentId - Parent folder ID for the duplicate (null for root)
   * @param userId - ID of the user performing the operation
   * @param environmentId - ID of the environment
   * @returns Promise<IDocumentFolder> - The duplicated folder
   */
  async duplicate(
    folderId: string,
    newName: string,
    parentId: string | null,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentFolder> {
    const requestStartTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "FolderDuplicateService.duplicate",
      {
        service: "FolderDuplicateService",
        method: "duplicate",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = folderId;
        span.attributes["user_id"] = userId;
        span.attributes["parent_id"] = parentId || "root";

        const sourceFolder = await this.readService.findById(folderId, userId, environmentId);
        if (!sourceFolder) {
          await ensureMinimumProcessingTime(
            requestStartTime,
            TIMING_PROFILES.STANDARD,
          );
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (parentId) {
          const parentFolder = await this.readService.findById(
            parentId,
            userId,
            environmentId,
          );
          if (!parentFolder) {
            await ensureMinimumProcessingTime(
              requestStartTime,
              TIMING_PROFILES.STANDARD,
            );
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }

          if (!permissionLevelMeets(parentFolder.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
            await ensureMinimumProcessingTime(
              requestStartTime,
              TIMING_PROFILES.STANDARD,
            );
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
        }

        const newFolder = await this.writeService.create(
          {
            name: newName,
            description: sourceFolder.description,
            parentFolderId: parentId,
            color: sourceFolder.color,
            icon: sourceFolder.icon,
          },
          userId,
          environmentId,
        );

        await ensureMinimumProcessingTime(
          requestStartTime,
          TIMING_PROFILES.STANDARD,
        );

        span.attributes["new_folder_id"] = newFolder.id;
        span.attributes["success"] = true;

        return newFolder;
      },
    );
  }
}
