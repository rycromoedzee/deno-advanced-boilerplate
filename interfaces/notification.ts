/**
 * @file interfaces/notification.ts
 * @description Shared types for the notification inbox system
 */

import type { NotificationEventType } from "@config/notification-event-types.ts";

/** Payload sent over SSE to connected clients */
export interface INotificationSSEPayload {
  id: string;
  type: NotificationEventType;
  titleKey: string;
  bodyKey: string;
  actionRoute: string;
  resourceId: string | null;
  actorId: string | null;
  actorName: string | null;
  recipientUserId: string;
  createdAt: number;
}

/** Input for creating a notification (used by sharing services) */
export interface INotificationCreateInput {
  userId: string;
  environmentId: string;
  type: NotificationEventType;
  titleKey: string;
  bodyKey: string;
  actionRoute: string;
  resourceId: string | null;
  actorId: string | null;
  actorName: string | null;
}
