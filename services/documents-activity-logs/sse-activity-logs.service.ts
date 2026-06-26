/**
 * @file services/documents/sse-activity-logs.service.ts
 * @description SSE service for streaming real-time activity logs
 *
 * IMPORTANT: This service enforces document-level permissions before
 * delivering activity log events to connected clients. Users will only
 * receive events for documents they have at least READ access to.
 */

import type { IActivityLogItem } from "@models/documents/activity-logs.model.ts";
import type { SSEConnection } from "@services/shared/sse.types.ts";
import { BaseSSEService } from "@services/shared/base-sse.service.ts";
import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { getDocumentPermissionService } from "@services/documents-permission/singletons.ts";
import { getDocumentSSEActivityLogService } from "./singletons.ts";

/**
 * Filters for activity log connections
 */
interface ActivityLogFilters {
  documentId?: string;
  folderId?: string;
  accessType?: string;
  accessMethod?: string;
}

/**
 * SSE connection manager for activity logs
 * Extends BaseSSEService to provide activity-log specific filtering
 * and document-level permission enforcement
 */
export class DocumentSSEActivityLogService extends BaseSSEService<IActivityLogItem, ActivityLogFilters> {
  constructor() {
    super("activityLog", "activity-log");
  }

  /**
   * Implement domain-specific filter matching for activity logs
   */
  protected matchesFilters(log: IActivityLogItem, filters: ActivityLogFilters): boolean {
    if (filters.documentId && log.documentId !== filters.documentId) {
      return false;
    }
    if (filters.folderId && log.folderId !== filters.folderId) {
      return false;
    }
    if (filters.accessType && log.accessType !== filters.accessType) {
      return false;
    }
    if (filters.accessMethod && log.accessMethod !== filters.accessMethod) {
      return false;
    }
    return true;
  }

  /**
   * Check if the connected user has permission to receive this activity log
   * Overrides base class to enforce document-level permissions
   */
  protected override async checkPermission(
    data: IActivityLogItem,
    connection: SSEConnection<ActivityLogFilters>,
  ): Promise<boolean> {
    // If no documentId, allow delivery (non-document activity)
    if (!data.documentId) {
      return true;
    }

    const permissionService = getDocumentPermissionService();
    try {
      return await permissionService.checkAccess(
        data.documentId,
        connection.userId,
        DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      );
    } catch (error) {
      console.error(
        `Permission check failed in DocumentSSEActivityLogService: userId=${connection.userId}, documentId=${data.documentId}`,
        error,
      );
      return false;
    }
  }
}

/**
 * Emit a new activity log event
 * Call this after inserting a log into the database
 *
 * @param log - The activity log item to broadcast
 * @param userId - The user ID associated with this event
 * @param environmentId - The environment ID for this event
 */
export async function emitDocumentActivityLog(
  log: IActivityLogItem,
  userId: string,
  environmentId: string,
): Promise<void> {
  if (!log.documentId) {
    return;
  }

  const permissionService = getDocumentPermissionService();

  try {
    const hasAccess = await permissionService.checkAccess(
      log.documentId,
      userId,
      DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
    );

    if (!hasAccess) {
      return;
    }
  } catch (error) {
    console.error(
      `Permission check failed before emitting activity log: userId=${userId}, documentId=${log.documentId}`,
      error,
    );
    return;
  }

  const sseService = getDocumentSSEActivityLogService();
  sseService.broadcast(log, userId, environmentId);
}
