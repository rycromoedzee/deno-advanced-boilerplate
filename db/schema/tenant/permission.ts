/**
 * @file db/schema/tenant/permission.ts
 * @description Permission table schema for the tenant database
 */
import { boolean, createdAtTimestamp, dbTable, index, integer, primaryKey, text, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";

export const permissions = dbTable("permissions", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull().unique(),
  description: text("description"),
  level: integer("level"),
  groupKey: text("group_key"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const permissionGroups = dbTable("permission_groups", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  description: text("description"),
  isSystem: boolean("is_system").notNull().default(false),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const permissionGroupPermissions = dbTable(
  "permission_group_permissions",
  {
    groupId: text("group_id").notNull().references(() => permissionGroups.id, { onDelete: "cascade" }),
    permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.groupId, table.permissionId] }),
    index("permission_group_permissions_group_id_idx").on(table.groupId),
    index("permission_group_permissions_permission_id_idx").on(table.permissionId),
  ],
);

export const userPermissions = dbTable("user_permissions", {
  userId: text("user_id").notNull(),
  permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.permissionId] }),
]);

export const userPermissionGroups = dbTable("user_permission_groups", {
  userId: text("user_id").notNull().unique(),
  groupId: text("group_id").notNull().references(() => permissionGroups.id, { onDelete: "restrict" }),
}, (table) => [
  primaryKey({ columns: [table.userId, table.groupId] }),
]);

export const apiKeyPermissions = dbTable("api_key_permissions", {
  apiKeyId: text("api_key_id").notNull(),
  permissionId: text("permission_id").notNull().references(() => permissions.id, { onDelete: "cascade" }),
}, (table) => [
  primaryKey({ columns: [table.apiKeyId, table.permissionId] }),
]);

export const apiKeyPermissionGroups = dbTable("api_key_permission_groups", {
  apiKeyId: text("api_key_id").notNull(),
  groupId: text("group_id").notNull().references(() => permissionGroups.id, { onDelete: "restrict" }),
}, (table) => [
  primaryKey({ columns: [table.apiKeyId, table.groupId] }),
]);

// Relations
export const permissionsRelations = relations(permissions, ({ many }) => ({
  groupPermissions: many(permissionGroupPermissions),
  userPermissions: many(userPermissions),
  apiKeyPermissions: many(apiKeyPermissions),
}));

export const permissionGroupsRelations = relations(
  permissionGroups,
  ({ many }) => ({
    groupPermissions: many(permissionGroupPermissions),
    userGroups: many(userPermissionGroups),
    apiKeyGroups: many(apiKeyPermissionGroups),
  }),
);

export const permissionGroupPermissionsRelations = relations(
  permissionGroupPermissions,
  ({ one }) => ({
    group: one(permissionGroups, {
      fields: [permissionGroupPermissions.groupId],
      references: [permissionGroups.id],
    }),
    permission: one(permissions, {
      fields: [permissionGroupPermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const userPermissionsRelations = relations(
  userPermissions,
  ({ one }) => ({
    permission: one(permissions, {
      fields: [userPermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const userPermissionGroupsRelations = relations(
  userPermissionGroups,
  ({ one }) => ({
    group: one(permissionGroups, {
      fields: [userPermissionGroups.groupId],
      references: [permissionGroups.id],
    }),
  }),
);

export const apiKeyPermissionsRelations = relations(
  apiKeyPermissions,
  ({ one }) => ({
    permission: one(permissions, {
      fields: [apiKeyPermissions.permissionId],
      references: [permissions.id],
    }),
  }),
);

export const apiKeyPermissionGroupsRelations = relations(
  apiKeyPermissionGroups,
  ({ one }) => ({
    group: one(permissionGroups, {
      fields: [apiKeyPermissionGroups.groupId],
      references: [permissionGroups.id],
    }),
  }),
);
