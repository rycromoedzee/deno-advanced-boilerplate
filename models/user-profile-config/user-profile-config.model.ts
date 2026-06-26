/**
 * @file models/user-profile-config/user-profile-config.model.ts
 * @description Zod schemas for current user profile configuration response
 */

import { z } from "@deps";
import { SchemaCurrentUserResponse } from "@models/environment-config-user/index.ts";
import { SchemaNotificationCatalogGroupedResponse } from "@models/notifications/index.ts";

/**
 * Passkey list item schema
 */
export const SchemaPasskeyListItem = z.object({
  id: z.string().openapi({
    description: "Passkey ID",
    example: "passkey_abc123",
  }),
  displayName: z.string().nullable().openapi({
    description: "User-provided passkey label",
    example: "MacBook Pro",
  }),
  createdAt: z.number().openapi({
    description: "Passkey creation timestamp",
    example: 1704067200000,
  }),
  backedUp: z.boolean().openapi({
    description: "Whether the passkey is backed up/syncable",
    example: true,
  }),
  transports: z.array(z.string()).nullable().openapi({
    description: "Authenticator transports for this credential",
    example: ["internal", "usb"],
  }),
  hasPrf: z.boolean().openapi({
    description: "Whether this passkey has PRF configured for encryption",
    example: true,
  }),
});

/**
 * Current user profile config response schema
 */
export const SchemaCurrentUserProfileConfigResponse = z.object({
  user: SchemaCurrentUserResponse.openapi({
    description: "Current user profile with permissions",
  }),
  passkeys: z.array(SchemaPasskeyListItem).openapi({
    description: "Registered passkeys for the current user",
  }),
  passkeysRequirePrfSetup: z.boolean().openapi({
    description: "Whether any passkey is missing PRF setup required for encryption",
    example: false,
  }),
  notificationPreferences: SchemaNotificationCatalogGroupedResponse.openapi({
    description: "Effective notification preferences grouped by category",
  }),
});

// ============================================================================//
// Export Types
// ============================================================================//

export type IPasskeyListItem = z.infer<typeof SchemaPasskeyListItem>;
export type ICurrentUserProfileConfigResponse = z.infer<typeof SchemaCurrentUserProfileConfigResponse>;
