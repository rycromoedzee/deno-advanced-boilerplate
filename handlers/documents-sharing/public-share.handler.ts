/**
 * @file handlers/documents-sharing/public-share.handler.ts
 * @description Document public sharing handlers using the new generic public access system
 */

import { DataAccessService } from "@services/encryption/index.ts";
import { getDocumentSharingPublicService, getDocumentSharingService } from "@services/documents-sharing/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { PublicShareCreator } from "@services/public-access/index.ts";
import { ResourceType } from "@interfaces/public-access.ts";
import { SchemaDocumentPermissionUpdateResponse, SchemaDocumentPublicShareResponse } from "@models/documents/index.ts";
import {
  createPublicDocumentShareRoute,
  disablePublicDocumentShareRoute,
  revokeDocumentAccessRoute,
  updateDocumentPermissionRoute,
} from "@routes/documents-sharing/documents-sharing.route.ts";
import type { IDocumentPermissionUpdate } from "@models/documents/document-sharing.model.ts";
import type { IPublicDocumentShareOptions } from "@models/documents/document-sharing.model.ts";
import type { HandlerContext } from "@handlers/shared/types.ts";
import { createGenericPublicAccessHandler } from "@services/public-access/generic-public-access.handler.ts";
import { ResourceManager } from "@services/public-access/resource-manager.ts";
import { DocumentAccessStrategy } from "@services/public-access/strategies/document-access.strategy.ts";
import { registerDocumentConfig } from "@services/public-access/configs/document.config.ts";
import { defineHandler } from "@handlers/shared/index.ts";
import { loggerAppSections } from "@logger/types.ts";
import { throwHttpError } from "@utils/http-exception.ts";

/**
 * Handler for creating public document shares
 * Delegates permission checks to DocumentSharingPublicService
 */
export const createPublicDocumentShareHandler = defineHandler(
  {
    route: createPublicDocumentShareRoute,
    operationName: "document_create_public_share",
    entityType: "document",
    loggerSection: loggerAppSections.PUBLIC_SHARE,
    responseSchema: SchemaDocumentPublicShareResponse,
    errorKey: "DOCUMENT.CREATE_PUBLIC_SHARE_FAILED",
  },
  async (context: HandlerContext) => {
    const { documentId } = context.params;
    const { password, expiresAt, recipientEmail } = context.body as unknown as IPublicDocumentShareOptions;

    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(context.c);

    const service = getDocumentSharingPublicService();
    const result = await service.createPublicShare(
      documentId,
      { password, expiresAt: expiresAt ?? undefined, recipientEmail },
      context.userId,
      encryptionKey.key,
    );

    const config = ResourceManager.getConfig(ResourceType.DOCUMENT);
    const publicUrl = PublicShareCreator.buildPublicShareUrl(result.publicUri, config.baseUrlPath);

    return {
      data: SchemaDocumentPublicShareResponse.parse({
        token: result.shareToken,
        shareUrl: publicUrl,
        hasPassword: result.isPasswordProtected,
        expiresAt: result.expiresAt || null,
        createdAt: getTimeNow(),
      }),
      status: 200,
    };
  },
);

/**
 * Handler for updating document permissions
 * Uses consistent error handling and validation
 */
export const updateDocumentPermissionHandler = defineHandler(
  {
    route: updateDocumentPermissionRoute,
    operationName: "document_update_permission",
    entityType: "document",
    loggerSection: loggerAppSections.PUBLIC_SHARE,
    responseSchema: SchemaDocumentPermissionUpdateResponse,
    errorKey: "DOCUMENT.UPDATE_PERMISSION_FAILED",
  },
  async (context: HandlerContext) => {
    const body = context.body as unknown as IDocumentPermissionUpdate;
    const { permission, userId: targetUserId, documentId } = body;

    const permissionLevel = permission.toUpperCase() as string;
    if (!(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as string[]).includes(permissionLevel)) {
      throwHttpError("DOCUMENT.BAD_REQUEST");
    }

    const service = getDocumentSharingService();
    const result = await service.updatePermission(
      documentId,
      context.userId,
      targetUserId,
      permissionLevel as unknown as number,
    );

    return {
      data: SchemaDocumentPermissionUpdateResponse.parse({
        userId: targetUserId,
        permission,
        updatedAt: result.updatedAt,
      }),
      status: 200,
    };
  },
);

/**
 * Handler for revoking document access
 * Simplified error handling and response construction
 */
export const revokeDocumentAccessHandler = defineHandler(
  {
    route: revokeDocumentAccessRoute,
    operationName: "document_revoke_access",
    entityType: "document",
    loggerSection: loggerAppSections.PUBLIC_SHARE,
    errorKey: "DOCUMENT.REVOKE_ACCESS_FAILED",
  },
  async (context: HandlerContext) => {
    const params = context.params;
    const { documentId, userId: targetUserId } = params;

    const service = getDocumentSharingService();
    await service.revokeUserAccess(
      documentId,
      context.userId,
      targetUserId,
    );

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Handler for disabling public document shares
 * Uses consistent validation and error handling
 */
export const disablePublicDocumentShareHandler = defineHandler(
  {
    route: disablePublicDocumentShareRoute,
    operationName: "document_disable_public_share",
    entityType: "document",
    loggerSection: loggerAppSections.PUBLIC_SHARE,
    errorKey: "DOCUMENT.DISABLE_PUBLIC_SHARE_FAILED",
  },
  async (context) => {
    const params = context.params;
    const query = context.query;
    const service = getDocumentSharingPublicService();

    await service.disablePublicShare(
      params.documentId,
      context.userId,
      query.token,
    );

    return {
      data: null,
      status: 204,
    };
  },
);

/**
 * Public document access handler using the new generic system
 * Replaces the original accessPublicDocumentHandler
 */
export const accessPublicDocumentHandler = createGenericPublicAccessHandler(ResourceType.DOCUMENT);

/**
 * Registers the document strategy and configuration
 * Call this during application initialization
 */
export const registerDocumentPublicAccess = (): void => {
  // Register the document configuration
  registerDocumentConfig();

  // Register the document strategy
  ResourceManager.registerStrategy(
    ResourceType.DOCUMENT,
    () => new DocumentAccessStrategy(),
  );
};
