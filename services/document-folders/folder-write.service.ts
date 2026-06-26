/**
 * @file services/document-folders/folder-write.service.ts
 * @description Service for folder write operations (create and update)
 *
 * This service handles folder creation and updates with:
 * - Permission checking
 * - Permission inheritance handling
 */

import { eq } from "@deps";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import { generateIdForDocumentFolder } from "@utils/database/id-generation/index.ts";
import { getDocumentPermissionInheritanceService } from "@services/documents-permission/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/timing.ts";
import type { ICreateFolderInput, IDocumentFolder, IUpdateFolderInput } from "@models/documents/folder.model.ts";
import { FolderReadService } from "./folder-read.service.ts";
import { getTenantDB, tenantTables } from "@db/index.ts";

/**
 * Folder Write Service
 */
export class FolderWriteService {
  private readService: FolderReadService;

  constructor(
    readService?: FolderReadService,
  ) {
    this.readService = readService || new FolderReadService();
  }

  /**
   * Creates a new folder with optional parent folder
   */
  async create(
    data: ICreateFolderInput,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentFolder> {
    return await tracedWithServiceErrorHandling(
      "FolderWriteService.create",
      {
        service: "FolderWriteService",
        method: "create",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { userId, environmentId, folderName: data.name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["folder_name"] = data.name;
        span.attributes["has_parent"] = !!data.parentFolderId;

        const db = await getTenantDB(environmentId);

        if (data.parentFolderId) {
          const parentFolder = await this.readService.findById(
            data.parentFolderId,
            userId,
            environmentId,
          );

          if (!parentFolder) {
            throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
          }

          if (!permissionLevelMeets(parentFolder.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
            throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
          }
        }

        const folder = await databaseCreateWithRetry(
          async (generatedFolderId) => {
            const [folderRecord] = await db
              .insert(tenantTables.documentFolders)
              .values({
                id: generatedFolderId,
                name: data.name,
                description: data.description || null,
                parentFolderId: data.parentFolderId || null,
                ownerId: userId,
                autoShareNewContent: true,
                hasInternalSharing: true,
                color: data.color || "#3b82f6",
                icon: data.icon || null,
                isArchived: false,
                archivedAt: null,
              })
              .returning();

            if (!folderRecord) {
              throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
            }

            return folderRecord;
          },
          generateIdForDocumentFolder,
        );

        const folderData = folder as IDocumentFolder;

        span.attributes["folder_id"] = folder.id;

        if (data.parentFolderId) {
          try {
            const inheritanceService = getDocumentPermissionInheritanceService();

            await inheritanceService.handleNewSubfolderInheritance(
              folder.id,
              data.parentFolderId,
              userId,
            );
          } catch (error) {
            await useLogger(LoggerLevels.error, {
              message: "Failed to apply permission inheritance to new subfolder",
              section: loggerAppSections.DOCUMENTS_FOLDERS,
              messageKey: "folder_permission_inheritance_error",
              details: {
                folderId: folder.id,
                parentFolderId: data.parentFolderId,
                error: error instanceof Error ? error.message : String(error),
              },
            });
          }
        }

        span.attributes["success"] = true;
        return folderData;
      },
    );
  }

  /**
   * Updates a folder's metadata
   */
  async update(
    id: string,
    data: IUpdateFolderInput,
    userId: string,
    environmentId: string,
  ): Promise<IDocumentFolder> {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "FolderWriteService.update",
      {
        service: "FolderWriteService",
        method: "update",
        section: loggerAppSections.DOCUMENTS_FOLDERS,
        details: { folderId: id, userId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["folder_id"] = id;
        span.attributes["user_id"] = userId;

        const db = await getTenantDB(environmentId);
        const existing = await this.readService.findById(id, userId, environmentId);

        if (!existing) {
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );
          throwHttpError("DOCUMENT_FOLDER.NOT_FOUND");
        }

        if (!permissionLevelMeets(existing.userPermissionLevel, DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE)) {
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );
          throwHttpError("DOCUMENT_FOLDER.ACCESS_DENIED");
        }

        const updateData: Record<string, unknown> = {};

        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) {
          updateData.description = data.description;
        }
        if (data.color !== undefined) updateData.color = data.color;
        if (data.icon !== undefined) updateData.icon = data.icon;

        const [updated] = await db
          .update(tenantTables.documentFolders)
          .set(updateData)
          .where(eq(tenantTables.documentFolders.id, id))
          .returning();

        const folderData = updated as IDocumentFolder;

        span.attributes["success"] = true;
        return folderData;
      },
    );
  }
}
