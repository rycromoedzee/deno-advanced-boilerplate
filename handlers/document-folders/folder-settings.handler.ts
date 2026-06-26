/**
 * @file handlers/document-folders/folder-settings.handler.ts
 * @description Folder Settings request handler
 */
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { getFolderSettingsService } from "@services/document-folders/index.ts";
import { getFolderSettingsRoute } from "@routes/document-folders/folder-settings.route.ts";
import { SchemaFolderSettingsResponse } from "@models/documents/folder-settings.model.ts";

/**
 * Get folder settings handler
 * Returns comprehensive folder statistics and structure information
 */
export const getFolderSettingsHandler = defineHandler(
  {
    route: getFolderSettingsRoute,
    operationName: "folder_settings_get",
    entityType: "folder",
    loggerSection: loggerAppSections.DOCUMENTS_FOLDERS,
    responseSchema: SchemaFolderSettingsResponse,
  },
  async (context) => {
    const service = getFolderSettingsService();
    const settings = await service.getSettings(context.userId, context.environmentId);

    return {
      data: settings,
      status: 200,
    };
  },
);
