/**
 * @file handlers/documents-sharing/documents-sharing.handler.ts
 * @description Document sharing handlers (share, list permissions, access logs).
 *
 * Public-share handlers (create/disable public share, revoke/update permission,
 * public access) live in public-share.handler.ts and are aggregated by the
 * dir barrel.
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import type { HandlerContext } from "@handlers/shared/types.ts";
import { getDocumentPermissionService } from "@services/documents-permission/index.ts";
import { getDocumentSharingPublicService, getDocumentSharingService } from "@services/documents-sharing/index.ts";
import { getDocumentAccessLogService } from "@services/documents-stats/index.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL, permissionLevelMeets } from "@db/enums/index.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import {
  getDocumentAccessLogsRoute,
  listDocumentPermissionsRoute,
  shareDocumentRoute,
} from "@routes/documents-sharing/documents-sharing.route.ts";
import {
  SchemaDocumentAccessLogsResponse,
  SchemaDocumentPermissionsResponse,
  SchemaDocumentShareResponse,
} from "@models/documents/index.ts";
import type { IDocumentShareRequest } from "@models/documents/document-sharing.model.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { eq, inArray, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { getNotificationCreateService } from "@services/notifications/index.ts";
import { NOTIFICATION_EVENT_TYPES } from "@config/notification-event-types.ts";

/**
 * Share document with internal users
 */
export const shareDocumentHandler = defineHandler(
  {
    route: shareDocumentRoute,
    operationName: "document_share",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentShareResponse,
    errorKey: "DOCUMENT.SHARE_FAILED",
  },
  async ({ userId, environmentId, body, c }: HandlerContext) => {
    const { documentId, userIds, permission } = body as unknown as IDocumentShareRequest;
    const permissionLevel = permission as string;
    if (!(Object.values(DB_ENUM_PERMISSION_ACCESS_LEVEL) as string[]).includes(permissionLevel)) {
      throwHttpError("DOCUMENT.BAD_REQUEST");
    }

    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);
    const service = getDocumentSharingService();
    const result = await service.shareWithUsers(
      documentId,
      userIds,
      permissionLevel as DB_ENUM_PERMISSION_ACCESS_LEVEL,
      userId,
      keyDetails.key,
    );

    if (environmentId) {
      try {
        const tenantDb = await getTenantDB();
        const [ownerProfile] = await tenantDb
          .select({ displayName: sql<string>`${tenantTables.userProfiles.firstName} || ' ' || ${tenantTables.userProfiles.lastName}` })
          .from(tenantTables.userProfiles)
          .where(eq(tenantTables.userProfiles.userId, userId))
          .limit(1);
        const ownerName = ownerProfile?.displayName?.trim() || null;

        const eventType = NOTIFICATION_EVENT_TYPES.DOCUMENT_SHARED;

        const notificationService = getNotificationCreateService();
        for (const r of result.sharedWith) {
          if (!r.success) continue;

          notificationService.createAndEmit({
            userId: r.userId,
            environmentId,
            type: eventType,
            titleKey: "notifications.document_shared",
            bodyKey: "notifications.document_shared_content",
            actionRoute: "documents.view",
            resourceId: documentId,
            actorId: userId,
            actorName: ownerName,
          }).catch((err) => {
            useLogger(LoggerLevels.error, {
              messageKey: "notifications.emit_failed",
              message: "Failed to emit document sharing notification",
              section: loggerAppSections.NOTIFICATIONS,
              details: { userId: r.userId, documentId, error: err instanceof Error ? err.message : String(err) },
              raw: err,
            });
          });
        }
      } catch (err) {
        await useLogger(LoggerLevels.error, {
          messageKey: "notifications.setup_failed",
          message: "Failed to emit document sharing notifications",
          section: loggerAppSections.NOTIFICATIONS,
          details: { error: err instanceof Error ? err.message : String(err) },
          raw: err,
        });
      }
    } else {
      await useLogger(LoggerLevels.warn, {
        messageKey: "notifications.skipped_no_env",
        message: "Skipping notification emission: no environmentId",
        section: loggerAppSections.NOTIFICATIONS,
      });
    }

    return {
      data: SchemaDocumentShareResponse.parse({
        sharedWith: result.sharedWith
          .filter((r) => r.success)
          .map((r) => ({
            userId: r.userId,
            permission: permission,
          })),
      }),
      status: 200,
    };
  },
);
/**
 * List permissions
 */
export const listDocumentPermissionsHandler = defineHandler(
  {
    route: listDocumentPermissionsRoute,
    operationName: "document_list_permissions",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentPermissionsResponse,
    errorKey: "DOCUMENT.LIST_PERMISSIONS_FAILED",
  },
  async ({ userId, params, c }: HandlerContext) => {
    const documentId = params.documentId;

    const tenantDb = await getTenantDB();

    const [docResult] = await tenantDb
      .select({
        ownerId: tenantTables.documents.ownerId,
      })
      .from(tenantTables.documents)
      .where(eq(tenantTables.documents.id, documentId))
      .limit(1);

    if (!docResult) {
      throwHttpError("DOCUMENT.NOT_FOUND");
    }

    const [ownerDetails] = await tenantDb
      .select({
        firstName: tenantTables.userProfiles.firstName,
        lastName: tenantTables.userProfiles.lastName,
        email: tenantTables.userProfiles.email,
      })
      .from(tenantTables.userProfiles)
      .where(eq(tenantTables.userProfiles.userId, docResult.ownerId))
      .limit(1);

    const internalService = getDocumentSharingService();
    const publicService = getDocumentSharingPublicService();

    const keyDetails = await DataAccessService.getEncryptionKeyForDataMasterKey(c);

    const [internalUsers, publicShares] = await Promise.all([
      internalService.listSharedUsers(documentId, userId),
      publicService.listPublicShares(documentId, userId, keyDetails.key),
    ]);

    const permissions = {
      internalUsers: internalUsers.internalUsers,
      publicShares: publicShares.publicShares,
    };

    const sharedUserIds = permissions.internalUsers.map((u) => u.userId);
    const userDetails = sharedUserIds.length > 0
      ? await tenantDb
        .select({
          id: tenantTables.userProfiles.userId,
          firstName: tenantTables.userProfiles.firstName,
          lastName: tenantTables.userProfiles.lastName,
          email: tenantTables.userProfiles.email,
        })
        .from(tenantTables.userProfiles)
        .where(inArray(tenantTables.userProfiles.userId, sharedUserIds))
      : [];

    const userDetailsMap = new Map(userDetails.map((u) => [u.id, u]));

    return {
      data: SchemaDocumentPermissionsResponse.parse({
        owner: {
          userId: docResult.ownerId,
          email: ownerDetails?.email || null,
          name: `${ownerDetails?.firstName || ""} ${ownerDetails?.lastName || ""}`.trim(),
        },
        sharedUsers: permissions.internalUsers
          .filter((u) => u.userId !== docResult.ownerId)
          .map((u) => {
            const details = userDetailsMap.get(u.userId);
            return {
              userId: u.userId,
              email: details?.email || null,
              name: `${details?.firstName || ""} ${details?.lastName || ""}`.trim(),
              permission: u.permissionLevel >= 2 ? "write" as const : "read" as const,
              sharedAt: u.grantedAt,
            };
          }),
        publicShares: permissions.publicShares.map((share) => ({
          token: share.shareToken,
          url: share.publicUrl,
          hasPassword: share.isPasswordProtected,
          expiresAt: share.expiresAt,
          recipientEmail: share.recipientEmail,
          createdAt: share.createdAt,
        })),
      }),
      status: 200,
    };
  },
);

export const getDocumentAccessLogsHandler = defineHandler(
  {
    route: getDocumentAccessLogsRoute,
    operationName: "document_get_access_logs",
    entityType: "document",
    loggerSection: loggerAppSections.DOCUMENTS,
    responseSchema: SchemaDocumentAccessLogsResponse,
    errorKey: "DOCUMENT.GET_ACCESS_LOGS_FAILED",
  },
  async ({ userId, params, query }: HandlerContext) => {
    const documentId = params.documentId;

    // Verify user has at least READ permission
    const permissionService = getDocumentPermissionService();
    const userPermission = await permissionService.getAccessLevel(
      documentId,
      userId,
    );

    if (
      userPermission === null ||
      !permissionLevelMeets(userPermission, DB_ENUM_PERMISSION_ACCESS_LEVEL.READ)
    ) {
      throwHttpError("DOCUMENT.ACCESS_DENIED");
    }

    // Build filter options from query params
    const filterOptions: {
      limit: number;
      page: number;
      userId?: string;
      accessType?: string;
      accessMethod?: string;
      success?: boolean;
      startDate?: number;
      endDate?: number;
    } = {
      limit: query.limit ? parseInt(String(query.limit)) : 50,
      page: query.page ? parseInt(String(query.page)) : 1,
    };

    if (query.userId) filterOptions.userId = String(query.userId);
    if (query.accessType) filterOptions.accessType = String(query.accessType);
    if (query.accessMethod) filterOptions.accessMethod = String(query.accessMethod);
    if (query.success !== undefined) filterOptions.success = query.success === "true";
    if (query.startDate) filterOptions.startDate = parseInt(String(query.startDate));
    if (query.endDate) filterOptions.endDate = parseInt(String(query.endDate));

    const accessLogService = getDocumentAccessLogService();
    const logs = await accessLogService.queryDocumentLogs(
      { documentId, ...filterOptions },
      { page: filterOptions.page, limit: filterOptions.limit },
    );

    return {
      data: SchemaDocumentAccessLogsResponse.parse({
        items: logs.items.map((log) => ({
          id: log.id,
          documentId: log.documentId || documentId,
          userId: log.userId,
          accessType: log.accessType,
          accessMethod: log.accessMethod,
          createdAt: log.createdAt,
        })),
        pagination: logs.pagination,
      }),
      status: 200,
    };
  },
);
