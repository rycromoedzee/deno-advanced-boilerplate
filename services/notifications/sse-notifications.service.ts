/**
 * @file services/notifications/sse-notifications.service.ts
 * @description SSE service for real-time notification delivery
 */

import type { SSEConnection } from "@services/shared/sse.types.ts";
import { BaseSSEService } from "@services/shared/base-sse.service.ts";
import type { INotificationSSEPayload } from "@interfaces/notification.ts";

class SSENotificationsService extends BaseSSEService<INotificationSSEPayload, Record<string, never>> {
  constructor() {
    super("notifications", "notif");
  }

  protected matchesFilters(): boolean {
    return true;
  }

  // deno-lint-ignore require-await
  protected override async checkPermission(
    data: INotificationSSEPayload,
    connection: SSEConnection<Record<string, never>>,
  ): Promise<boolean> {
    return data.recipientUserId === connection.userId;
  }
}

let sseNotificationsServiceInstance: SSENotificationsService | null = null;

export function getSSENotificationsService(): SSENotificationsService {
  if (!sseNotificationsServiceInstance) {
    sseNotificationsServiceInstance = new SSENotificationsService();
  }
  return sseNotificationsServiceInstance;
}
