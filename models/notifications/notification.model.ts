/**
 * @file models/notifications/notification.model.ts
 * @description Zod schemas for notification preferences API
 */

import { z } from "@deps";

// ============================================================================
// Channel Configuration
// ============================================================================

/**
 * Channel configuration schema - represents enabled/disabled state per channel
 */
export const SchemaNotificationChannels = z.object({
  email: z.boolean().openapi({
    description: "Email notifications enabled",
    example: true,
  }),
  inApp: z.boolean().openapi({
    description: "In-app notifications enabled",
    example: true,
  }),
  push: z.boolean().openapi({
    description: "Push notifications enabled",
    example: false,
  }),
});

// ============================================================================
// Enums
// ============================================================================

/**
 * Notification category enum
 */
export const SchemaNotificationCategory = z.enum([
  "security",
  "storage",
  "system",
  "user-management",
  "documents",
  "sharing",
  "comments",
  "task-management",
]);

/**
 * Notification scope enum
 */
export const SchemaNotificationScope = z.enum(["user", "admin"]);

/**
 * Preference source enum
 */
export const SchemaPreferenceSource = z.enum(["user", "environment", "default"]);

// ============================================================================
// Notification Type (from catalog)
// ============================================================================

/**
 * Notification type schema - represents a type from the catalog
 */
export const SchemaNotificationType = z.object({
  id: z.string().openapi({
    description: "Notification type ID",
    example: "security.login.new-device",
  }),
  category: SchemaNotificationCategory.openapi({
    description: "Notification category",
    example: "security",
  }),
  scope: SchemaNotificationScope.openapi({
    description: "Configuration scope - 'user' means user-configurable, 'environment' means admin-only",
    example: "user",
  }),
  label: z.string().openapi({
    description: "Display label",
    example: "Login from new device",
  }),
  description: z.string().nullable().openapi({
    description: "Description of this notification type",
    example: "Alert when someone signs in from an unrecognized device",
  }),
  availableChannels: z.array(z.enum(["email", "inApp", "push"])).openapi({
    description: "Available channels for this notification type",
    example: ["email", "inApp", "push"],
  }),
  defaults: SchemaNotificationChannels.openapi({
    description: "Default channel settings",
  }),
});

// ============================================================================
// Resolved Preference (with merge logic applied)
// ============================================================================

/**
 * Resolved notification preference - the effective setting after merge
 */
export const SchemaResolvedNotificationPreference = z.object({
  notificationTypeId: z.string().openapi({
    description: "Notification type ID",
    example: "security.login.new-device",
  }),
  category: SchemaNotificationCategory.openapi({
    description: "Notification category",
    example: "security",
  }),
  scope: SchemaNotificationScope.openapi({
    description: "Configuration scope",
    example: "user",
  }),
  label: z.string().openapi({
    description: "Display label",
    example: "Login from new device",
  }),
  description: z.string().nullable().openapi({
    description: "Description",
    example: "Alert when someone signs in from an unrecognized device",
  }),
  availableChannels: z.array(z.enum(["email", "inApp", "push"])).openapi({
    description: "Available channels",
    example: ["email", "inApp", "push"],
  }),
  channels: SchemaNotificationChannels.openapi({
    description: "Effective channel settings (merged from defaults/overrides)",
  }),
  source: SchemaPreferenceSource.openapi({
    description: "Where this setting comes from: 'user' = user override, 'environment' = env default, 'default' = catalog default",
    example: "user",
  }),
  isConfigurable: z.boolean().openapi({
    description: "Whether current user can modify this preference",
    example: true,
  }),
});

// ============================================================================
// Category Grouping (for UI)
// ============================================================================

/**
 * Category with notification types
 */
export const SchemaNotificationCategoryGroup = z.object({
  id: SchemaNotificationCategory.openapi({
    description: "Category ID",
    example: "security",
  }),
  title: z.string().openapi({
    description: "Category display title",
    example: "Security & Login Alerts",
  }),
  description: z.string().openapi({
    description: "Category description",
    example: "Important security notifications for account protection",
  }),
  icon: z.string().openapi({
    description: "Icon class name",
    example: "i-ph-shield-check",
  }),
  scope: SchemaNotificationScope.openapi({
    description: "Configuration scope for this category",
    example: "user",
  }),
  types: z.array(SchemaResolvedNotificationPreference).openapi({
    description: "Notification types in this category",
  }),
});

// ============================================================================
// Request Schemas
// ============================================================================

/**
 * Single preference update request
 */
export const SchemaUpsertPreferenceRequest = z.object({
  notificationTypeId: z.string().openapi({
    description: "Notification type ID to update",
    example: "security.login.new-device",
  }),
  channels: SchemaNotificationChannels.openapi({
    description: "Channel settings to set",
  }),
});

/**
 * Batch preference update request
 */
export const SchemaBatchUpsertPreferenceRequest = z.object({
  preferences: z.array(SchemaUpsertPreferenceRequest).min(1).openapi({
    description: "Preferences to update",
  }),
});

/**
 * Notification type ID parameter
 */
export const SchemaNotificationTypeIdParam = z.object({
  notificationTypeId: z.string().openapi({
    description: "Notification type ID",
    example: "security.login.new-device",
  }),
});

// ============================================================================
// Response Schemas
// ============================================================================

/**
 * Success response
 */
export const SchemaSuccessResponse = z.object({
  success: z.boolean().openapi({
    description: "Operation successful",
    example: true,
  }),
});

/**
 * User preferences list response
 */
export const SchemaUserPreferencesResponse = z.object({
  preferences: z.array(SchemaResolvedNotificationPreference).openapi({
    description: "All notification preferences for the user",
  }),
});

/**
 * User preferences grouped by category response
 */
export const SchemaUserPreferencesGroupedResponse = z.object({
  categories: z.array(SchemaNotificationCategoryGroup).openapi({
    description: "Preferences grouped by category",
  }),
});

/**
 * Notification catalog response
 */
export const SchemaNotificationCatalogResponse = z.object({
  types: z.array(SchemaNotificationType).openapi({
    description: "All notification types in the catalog",
  }),
});

/**
 * Notification catalog grouped by category response
 */
export const SchemaNotificationCatalogGroupedResponse = z.object({
  categories: z.array(z.object({
    id: SchemaNotificationCategory,
    title: z.string(),
    description: z.string(),
    icon: z.string(),
    scope: SchemaNotificationScope,
    types: z.array(SchemaNotificationType),
  })).openapi({
    description: "Catalog grouped by category",
  }),
});

/**
 * Environment defaults response (admin only)
 */
export const SchemaEnvironmentDefaultsResponse = z.object({
  defaults: z.array(z.object({
    notificationTypeId: z.string(),
    channels: SchemaNotificationChannels,
  })).openapi({
    description: "Environment-level notification defaults",
  }),
});

// ============================================================================
// Export Types
// ============================================================================

export type INotificationChannels = z.infer<typeof SchemaNotificationChannels>;
export type INotificationCategory = z.infer<typeof SchemaNotificationCategory>;
export type INotificationScope = z.infer<typeof SchemaNotificationScope>;
export type IPreferenceSource = z.infer<typeof SchemaPreferenceSource>;
export type INotificationType = z.infer<typeof SchemaNotificationType>;
export type IResolvedNotificationPreference = z.infer<typeof SchemaResolvedNotificationPreference>;
export type INotificationCategoryGroup = z.infer<typeof SchemaNotificationCategoryGroup>;
export type IUpsertPreferenceRequest = z.infer<typeof SchemaUpsertPreferenceRequest>;
export type IBatchUpsertPreferenceRequest = z.infer<typeof SchemaBatchUpsertPreferenceRequest>;
export type IUserPreferencesResponse = z.infer<typeof SchemaUserPreferencesResponse>;
export type IUserPreferencesGroupedResponse = z.infer<typeof SchemaUserPreferencesGroupedResponse>;
export type INotificationCatalogResponse = z.infer<typeof SchemaNotificationCatalogResponse>;
export type INotificationCatalogGroupedResponse = z.infer<typeof SchemaNotificationCatalogGroupedResponse>;
