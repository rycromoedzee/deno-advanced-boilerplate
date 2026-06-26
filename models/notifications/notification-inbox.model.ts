/**
 * @file models/notifications/notification-inbox.model.ts
 * @description Zod schemas for notification inbox API
 */

import { z } from "@deps";
import { withKey } from "@utils/validation/zod-message-key.ts";

// ============================================================================
// Notification Status
// ============================================================================

export const SchemaNotificationStatus = z.enum(["unread", "read", "dismissed"]);

// ============================================================================
// Request Schemas
// ============================================================================

export const SchemaNotificationListQuery = z.object({
  cursor: z.string().optional().openapi({
    description: "Pagination cursor (createdAt of last item)",
    example: "1710000000",
  }),
  limit: z.coerce.number().int().min(1, withKey("validation.limit_min", "Limit must be at least1")).max(
    100,
    withKey("validation.limit_max", "Limit cannot exceed 100"),
  ).optional().default(20).openapi({
    description: "Page size",
    example: 20,
  }),
  status: SchemaNotificationStatus.optional().openapi({
    description: "Filter by notification status",
    example: "unread",
  }),
});

export const SchemaNotificationIdParam = z.object({
  id: z.string().min(1, withKey("validation.required", "Notification ID is required")).openapi({
    description: "Notification ID",
    example: "abc123",
  }),
});

// ============================================================================
// Response Schemas
// ============================================================================

export const SchemaNotificationItem = z.object({
  id: z.string().openapi({
    description: "Notification ID",
    example: "cm3k8x2p1q9r0vwx_yz123abc",
  }),
  type: z.string().openapi({
    description: "Notification event type",
    example: "DOCUMENT_SHARED",
  }),
  titleKey: z.string().openapi({
    description: "Localization key for the notification title",
    example: "notifications.document-shared.title",
  }),
  bodyKey: z.string().openapi({
    description: "Localization key for the notification body",
    example: "notifications.document-shared.body",
  }),
  actionRoute: z.string().openapi({
    description: "Client route to navigate to when the notification is acted on",
    example: "/documents/cm2f9a1b2c3d4e5f6g7h8i9j",
  }),
  resourceId: z.string().nullable().openapi({
    description: "ID of the resource the notification refers to, if any",
    example: "cm2f9a1b2c3d4e5f6g7h8i9j",
  }),
  actorId: z.string().nullable().openapi({
    description: "ID of the user who triggered the notification, if any",
    example: "user_01hq1x4g3c8x9r2e0v0w1y2z3a",
  }),
  actorName: z.string().nullable().openapi({
    description: "Display name of the actor, if any",
    example: "Jane Smith",
  }),
  isRead: z.boolean().openapi({
    description: "Whether the notification has been read",
    example: false,
  }),
  dismissedAt: z.number().nullable().openapi({
    description: "Unix timestamp (ms) when the notification was dismissed, or null",
    example: 1718800000000,
  }),
  createdAt: z.number().openapi({
    description: "Unix timestamp (ms) when the notification was created",
    example: 1718800000000,
  }),
  updatedAt: z.number().openapi({
    description: "Unix timestamp (ms) when the notification was last updated",
    example: 1718800100000,
  }),
});

export const SchemaNotificationListResponse = z.object({
  notifications: z.array(SchemaNotificationItem),
  nextCursor: z.string().nullable().openapi({
    description: "Cursor for the next page, null if no more results",
    example: "1710000000",
  }),
});

export const SchemaUnreadCountResponse = z.object({
  count: z.number().int().openapi({
    description: "Number of unread notifications",
    example: 5,
  }),
});

export const SchemaNotificationMarkResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether the operation succeeded",
    example: true,
  }),
});

// ============================================================================
// Export Types
// ============================================================================

export type INotificationListQuery = z.infer<typeof SchemaNotificationListQuery>;
export type INotificationItem = z.infer<typeof SchemaNotificationItem>;
export type INotificationListResponse = z.infer<typeof SchemaNotificationListResponse>;
export type IUnreadCountResponse = z.infer<typeof SchemaUnreadCountResponse>;
