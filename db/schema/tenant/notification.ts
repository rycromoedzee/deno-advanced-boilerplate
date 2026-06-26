/**
 * @file db/schema/tenant/notification.ts
 * @description Notification table schema for the tenant database
 */
import { boolean, createdAtTimestamp, dbTable, index, integer, primaryKey, text, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";

export const notificationTypes = dbTable("notification_types", {
  id: text("id").primaryKey().notNull(),
  category: text("category").notNull(),
  scope: text("scope").notNull(),
  label: text("label").notNull(),
  description: text("description"),
  defaultEmail: boolean("default_email").notNull().default(true),
  defaultInApp: boolean("default_in_app").notNull().default(true),
  defaultPush: boolean("default_push").notNull().default(false),
  availableChannels: text("available_channels").notNull().default("email,inApp,push"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("idx_notification_types_category").on(table.category),
  index("idx_notification_types_scope").on(table.scope),
]);

export const environmentNotificationDefaults = dbTable(
  "environment_notification_defaults",
  {
    notificationTypeId: text("notification_type_id").notNull().references(() => notificationTypes.id, { onDelete: "cascade" }),
    emailEnabled: boolean("email_enabled").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull(),
    pushEnabled: boolean("push_enabled").notNull(),
    createdAt: createdAtTimestamp(),
    updatedAt: updatedAtTimestamp(),
  },
  (table) => [
    primaryKey({ columns: [table.notificationTypeId] }),
  ],
);

export const userNotificationPreferences = dbTable(
  "user_notification_preferences",
  {
    userId: text("user_id").notNull(),
    notificationTypeId: text("notification_type_id").notNull().references(() => notificationTypes.id, { onDelete: "cascade" }),
    emailEnabled: boolean("email_enabled").notNull(),
    inAppEnabled: boolean("in_app_enabled").notNull(),
    pushEnabled: boolean("push_enabled").notNull(),
    createdAt: createdAtTimestamp(),
    updatedAt: updatedAtTimestamp(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.notificationTypeId] }),
    index("idx_user_notification_prefs_user").on(table.userId),
  ],
);

export const notifications = dbTable("notifications", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  titleKey: text("title_key").notNull(),
  bodyKey: text("body_key").notNull(),
  actionRoute: text("action_route").notNull(),
  resourceId: text("resource_id"),
  actorId: text("actor_id"),
  actorName: text("actor_name"),
  isRead: boolean("is_read").notNull().default(false),
  dismissedAt: integer("dismissed_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_notifications_user_created").on(table.userId, table.createdAt),
  index("idx_notifications_user_is_read").on(table.userId, table.isRead),
]);

// Relations
export const notificationTypesRelations = relations(
  notificationTypes,
  ({ many }) => ({
    environmentDefaults: many(environmentNotificationDefaults),
    userPreferences: many(userNotificationPreferences),
  }),
);

export const environmentNotificationDefaultsRelations = relations(
  environmentNotificationDefaults,
  ({ one }) => ({
    notificationType: one(notificationTypes, {
      fields: [environmentNotificationDefaults.notificationTypeId],
      references: [notificationTypes.id],
    }),
  }),
);

export const userNotificationPreferencesRelations = relations(
  userNotificationPreferences,
  ({ one }) => ({
    notificationType: one(notificationTypes, {
      fields: [userNotificationPreferences.notificationTypeId],
      references: [notificationTypes.id],
    }),
  }),
);
