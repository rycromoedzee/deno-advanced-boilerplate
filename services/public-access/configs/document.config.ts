/**
 * @file services/public-access/configs/document.config.ts
 * @description Document-specific configuration for public access system
 */

import { getDocumentSharingPublicService } from "@services/documents-sharing/index.ts";
import { tenantTables } from "@db/index.ts";
import { HASHING_CONTEXTS } from "@utils/text/index.ts";
import { PublicResource, RequestContext, ResourceConfig, ResourceType } from "@interfaces/public-access.ts";
import { SchemaDocumentPublicShareResponse } from "@models/documents/index.ts";
import { ResourceManager } from "../resource-manager.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";

/**
 * Document-specific configuration for public access
 * Defines how documents should be handled in the public access system
 */
// Create a wrapper service that implements ResourceAccessService interface
const createDocumentAccessService = () => {
  const documentSharingPublicService = getDocumentSharingPublicService();
  return {
    verifyPublicShareAccess: async (
      shareId: string,
      shareKey: string,
      password?: string,
      metadata?: RequestContext,
    ) => {
      const result = await documentSharingPublicService.verifyPublicShareAccess(
        shareId,
        shareKey,
        password,
        metadata,
      );
      // Convert PublicShareDocument to PublicResource
      const resource: PublicResource | null = result.document
        ? {
          id: result.document.id,
          name: result.document.name,
          type: ResourceType.DOCUMENT,
          metadata: {
            description: result.document.description,
            contentType: result.document.contentType,
            folderId: result.document.folderId,
            ownerId: result.document.ownerId,
            createdAt: result.document.createdAt,
            updatedAt: result.document.updatedAt,
            fileSize: result.document.fileSize,
            mimeType: result.document.mimeType,
          },
        }
        : null;

      return {
        isValid: result.isValid,
        resourceId: result.documentId,
        resource,
        dataKeyId: result.dataKeyId,
      };
    },
  };
};

export const DocumentConfig: ResourceConfig = {
  type: ResourceType.DOCUMENT,
  baseUrlPath: "/public/documents",
  serviceFactory: createDocumentAccessService,
  encryptionContext: HASHING_CONTEXTS.ENCRYPTION_TYPE_FILE,
  responseSchema: SchemaDocumentPublicShareResponse,
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL.WRITE,
  tableName: tenantTables.documentsDataKeys,
  resourceIdColumn: "documentId",
};

/**
 * Registers document configuration with the resource config factory
 * Call this during application initialization
 */
export const registerDocumentConfig = (): void => {
  ResourceManager.registerConfig(ResourceType.DOCUMENT, DocumentConfig);
};
