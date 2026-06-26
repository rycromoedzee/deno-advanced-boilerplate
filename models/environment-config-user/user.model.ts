/**
 * @file models/environment-config-user/user.model.ts
 * @description User model/types
 */
import { z } from "@deps";
import { SCHEMA_USER_ID } from "@models/users/index.ts";
import { PAGINATION_DEFAULTS, SORT_ORDER } from "@constants/pagination.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const USERNAME_REGEX = /^[a-zA-Z0-9_-]+$/;

/**
 * User response schema
 */
export const SchemaEnvironmentConfigUserResponse = z.object({
  id: z.string().openapi({
    description: "User ID",
    example: "user_abc123",
  }),
  firstName: z.string().openapi({
    description: "First name",
    example: "John",
  }),
  lastName: z.string().openapi({
    description: "Last name",
    example: "Doe",
  }),
  email: z.string().email().nullable().openapi({
    description: "Identity email address",
    example: "john.doe@example.com",
  }),
  username: z.string().nullable().openapi({
    description: "Identity username",
    example: "johndoe",
  }),
  language: z.string().openapi({
    description: "User language preference",
    example: "en",
  }),
  isActive: z.boolean().openapi({
    description: "Whether the user is active",
    example: true,
  }),
  isSignedUp: z.boolean().openapi({
    description: "Whether the user has completed signup",
    example: true,
  }),
  isAdmin: z.boolean().openapi({
    description: "Whether the user is an admin",
    example: false,
  }),
  isTwoFactorEnabled: z.boolean().openapi({
    description: "Whether two-factor authentication is enabled",
    example: false,
  }),
  createdAt: z.number().openapi({
    description: "Creation timestamp",
    example: 1704067200000,
  }),
  updatedAt: z.number().openapi({
    description: "Last update timestamp",
    example: 1704067200000,
  }),
  lastLoginAt: z.number().nullable().openapi({
    description: "Last login timestamp",
    example: 1704067200000,
  }),
  permissionGroupId: z.string().nullable().openapi({
    description: "Assigned permission group ID (a user can belong to one group or have direct permissions, not both)",
    example: "group_abc123",
  }),
  permissions: z.array(z.string()).openapi({
    description: "Effective permissions (union of direct and group permissions)",
    example: ["user.read", "documents.view"],
  }),
  hasPasskey: z.boolean().openapi({
    description: "Whether the user has passkeys registered.",
    example: false,
  }),
});

/**
 * User list item response schema
 */
export const SchemaEnvironmentConfigUserListItemResponse = SchemaEnvironmentConfigUserResponse.pick({
  id: true,
  firstName: true,
  lastName: true,
  email: true,
  username: true,
  language: true,
  isActive: true,
  isSignedUp: true,
  isAdmin: true,
  isTwoFactorEnabled: true,
  createdAt: true,
  updatedAt: true,
  lastLoginAt: true,
  permissionGroupId: true,
  permissions: true,
  hasPasskey: true,
});

/**
 * User list response schema with pagination
 */
export const SchemaEnvironmentConfigUserListResponse = z.object({
  data: z.array(SchemaEnvironmentConfigUserListItemResponse).openapi({
    description: "List of users",
  }),
  pagination: z.object({
    page: z.number().openapi({
      description: "Current page number",
      example: 1,
    }),
    limit: z.number().openapi({
      description: "Items per page",
      example: 20,
    }),
    total: z.number().openapi({
      description: "Total number of users",
      example: 100,
    }),
    totalPages: z.number().openapi({
      description: "Total number of pages",
      example: 5,
    }),
  }).openapi({
    description: "Pagination information",
  }),
});

/**
 * Create user request schema
 */
export const SchemaEnvironmentConfigUserCreateRequest = z.object({
  firstName: z.string()
    .min(1, withKey("user.first-name-required", "First name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.first-name-max-length", `First name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({
      description: "First name",
      example: "John",
    }),
  lastName: z.string()
    .min(1, withKey("user.last-name-required", "Last name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.last-name-max-length", `Last name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({
      description: "Last name",
      example: "Doe",
    }),
  email: z.string()
    .email(withKey("user.email-invalid", "Invalid email format"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.email-max-length", `Email must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .nullable()
    .optional()
    .openapi({
      description: "Identity email address",
      example: "john.doe@example.com",
    }),
  username: z.string()
    .min(3, withKey("user.username-min-length", "Username must be at least 3 characters"))
    .max(50, withKey("user.username-max-length", "Username must be at most 50 characters"))
    .regex(USERNAME_REGEX, withKey("user.username-format", "Username may only contain letters, numbers, underscores, and hyphens"))
    .nullable()
    .optional()
    .openapi({
      description: "Identity username",
      example: "johndoe",
    }),
  password: z.string()
    .min(8, withKey("user.password-min-length", "Password must be at least 8 characters"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.password-max-length", `Password must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .nullable()
    .optional()
    .openapi({
      description: "Identity password (required when creating a new identity without existing identity)",
      example: "Password_01!",
    }),
  language: z.string()
    .optional()
    .default("en")
    .openapi({
      description: "User language preference",
      example: "en",
    }),
  isActive: z.boolean()
    .optional()
    .default(true)
    .openapi({
      description: "Whether the user is active",
      example: true,
    }),
  isSignedUp: z.boolean()
    .optional()
    .default(true)
    .openapi({
      description: "Whether the user has completed signup",
      example: true,
    }),
  isAdmin: z.boolean()
    .optional()
    .default(false)
    .openapi({
      description: "Whether the user is an admin",
      example: false,
    }),
  permissionGroupId: z.string()
    .optional()
    .openapi({
      description: "Permission group ID to assign",
      example: "group_abc123",
    }),
  permissions: z.array(z.string())
    .optional()
    .openapi({
      description: "Direct permission names to assign",
      example: ["user.read", "documents.view"],
    }),
}).refine(
  (data) => {
    const hasEmail = data.email !== null && data.email !== undefined;
    const hasUsername = data.username !== null && data.username !== undefined;
    return hasEmail || hasUsername;
  },
  {
    message: withKey("user.email-or-username-required", "At least one of email or username is required"),
    path: ["email"],
  },
);

/**
 * Update user request schema
 */
export const SchemaEnvironmentConfigUserUpdateRequest = z.object({
  firstName: z.string()
    .min(1, withKey("user.first-name-required", "First name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.first-name-max-length", `First name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({
      description: "First name",
      example: "John",
    }),
  lastName: z.string()
    .min(1, withKey("user.last-name-required", "Last name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.last-name-max-length", `Last name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({
      description: "Last name",
      example: "Doe",
    }),
  email: z.string()
    .email(withKey("user.email-invalid", "Invalid email format"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.email-max-length", `Email must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .nullable()
    .optional()
    .openapi({
      description: "Identity email address",
      example: "john.doe@example.com",
    }),
  username: z.string()
    .min(3, withKey("user.username-min-length", "Username must be at least 3 characters"))
    .max(50, withKey("user.username-max-length", "Username must be at most 50 characters"))
    .regex(USERNAME_REGEX, withKey("user.username-format", "Username may only contain letters, numbers, underscores, and hyphens"))
    .nullable()
    .optional()
    .openapi({
      description: "Identity username",
      example: "johndoe",
    }),
  password: z.string()
    .min(8, withKey("user.password-min-length", "Password must be at least 8 characters"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("user.password-max-length", `Password must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .nullable()
    .optional()
    .openapi({
      description: "Identity password",
      example: "Password_01!",
    }),
  language: z.string()
    .optional()
    .openapi({
      description: "User language preference",
      example: "en",
    }),
  isActive: z.boolean()
    .optional()
    .openapi({
      description: "Whether the user is active",
      example: true,
    }),
  isSignedUp: z.boolean()
    .optional()
    .openapi({
      description: "Whether the user has completed signup",
      example: true,
    }),
  isAdmin: z.boolean()
    .optional()
    .openapi({
      description: "Whether the user is an admin",
      example: false,
    }),
  permissionGroupId: z.string()
    .optional()
    .openapi({
      description: "Permission group ID to assign (replace strategy)",
      example: "group_abc123",
    }),
  permissions: z.array(z.string())
    .optional()
    .openapi({
      description: "Direct permission names to assign (replace strategy)",
      example: ["user.read", "documents.view"],
    }),
  permissionStrategy: z.enum(["replace", "merge"])
    .optional()
    .default("replace")
    .openapi({
      description: "Strategy for updating permissions",
      example: "replace",
    }),
}).refine(
  (data) => {
    // Only validate if at least one of email or username is being updated
    if (data.email === undefined && data.username === undefined) {
      return true;
    }
    const hasEmail = data.email !== null && data.email !== undefined;
    const hasUsername = data.username !== null && data.username !== undefined;
    return hasEmail || hasUsername;
  },
  {
    message: withKey(
      "user.email-or-username-required-update",
      "At least one of email or username is required when updating identity fields",
    ),
    path: ["email"],
  },
);

/**
 * List users query schema
 */
export const SchemaEnvironmentConfigUserListQuery = z.object({
  page: z.coerce.number()
    .optional()
    .default(PAGINATION_DEFAULTS.DEFAULT_PAGE)
    .openapi({
      description: "Page number",
      example: 1,
    }),
  limit: z.coerce.number()
    .optional()
    .default(PAGINATION_DEFAULTS.DEFAULT_LIMIT)
    .openapi({
      description: "Items per page",
      example: 20,
    }),
  sortBy: z.string()
    .optional()
    .default("createdAt")
    .openapi({
      description: "Sort field",
      example: "createdAt",
    }),
  sortOrder: z.enum([SORT_ORDER.ASC, SORT_ORDER.DESC])
    .optional()
    .default(PAGINATION_DEFAULTS.DEFAULT_SORT_ORDER)
    .openapi({
      description: "Sort order",
      example: "desc",
    }),
  search: z.string()
    .optional()
    .openapi({
      description: "Search query (matches first name, last name, email, username)",
      example: "john",
    }),
  email: z.string()
    .optional()
    .openapi({
      description: "Filter by email",
      example: "john.doe@example.com",
    }),
  username: z.string()
    .optional()
    .openapi({
      description: "Filter by username",
      example: "johndoe",
    }),
  isActive: z.coerce.boolean()
    .optional()
    .openapi({
      description: "Filter by active status",
      example: true,
    }),
  isSignedUp: z.coerce.boolean()
    .optional()
    .openapi({
      description: "Filter by signup status",
      example: true,
    }),
  isAdmin: z.coerce.boolean()
    .optional()
    .openapi({
      description: "Filter by admin status",
      example: false,
    }),
  permissionGroupId: z.string()
    .optional()
    .openapi({
      description: "Filter by permission group ID",
      example: "group_abc123",
    }),
  permissionName: z.string()
    .optional()
    .openapi({
      description: "Filter by permission name",
      example: "user.read",
    }),
});

/**
 * User ID parameter schema
 */
export const SchemaEnvironmentConfigUserIdParam = z.object({
  userId: SCHEMA_USER_ID.openapi({
    description: "User ID",
    example: "user_abc123",
  }),
});

/**
 * Create user response schema
 */
export const SchemaEnvironmentConfigUserCreateResponse = SchemaEnvironmentConfigUserResponse.extend({
  registerUrl: z.string().nullable(),
});

/**
 * Update user response schema
 */
export const SchemaEnvironmentConfigUserUpdateResponse = SchemaEnvironmentConfigUserResponse;

/**
 * Delete user response schema
 */
export const SchemaEnvironmentConfigUserDeleteResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether the deletion was successful",
    example: true,
  }),
  message: z.string().optional().openapi({
    description: "Response message",
    example: "User deleted successfully",
  }),
});

/**
 * Permission detail with source information
 */
export const SchemaPermissionDetail = z.object({
  name: z.string().openapi({
    description: "Permission name",
    example: "documents.view",
  }),
  source: z.enum(["direct", "group"]).openapi({
    description: "How the permission was assigned",
    example: "group",
  }),
});

/**
 * Current user response with detailed permission information
 */
export const SchemaCurrentUserResponse = z.object({
  id: z.string().openapi({
    description: "User ID",
    example: "user_abc123",
  }),
  firstName: z.string().openapi({
    description: "First name",
    example: "John",
  }),
  lastName: z.string().openapi({
    description: "Last name",
    example: "Doe",
  }),
  email: z.string().email().nullable().openapi({
    description: "Email address from identity",
    example: "john.doe@example.com",
  }),
  username: z.string().nullable().openapi({
    description: "Username from identity",
    example: "johndoe",
  }),
  language: z.string().openapi({
    description: "User language preference",
    example: "en",
  }),
  isActive: z.boolean().openapi({
    description: "Whether the user account is active",
    example: true,
  }),
  isSignedUp: z.boolean().openapi({
    description: "Whether the user has completed signup",
    example: true,
  }),
  isAdmin: z.boolean().openapi({
    description: "Whether the user has admin privileges",
    example: false,
  }),
  isSuperAdmin: z.boolean().openapi({
    description: "Whether the user has super admin privileges",
    example: false,
  }),
  isTwoFactorEnabled: z.boolean().openapi({
    description: "Whether two-factor authentication is enabled",
    example: false,
  }),
  createdAt: z.number().openapi({
    description: "Account creation timestamp",
    example: 1704067200000,
  }),
  updatedAt: z.number().openapi({
    description: "Last update timestamp",
    example: 1704153600000,
  }),
  lastLoginAt: z.number().nullable().openapi({
    description: "Last login timestamp",
    example: 1704240000000,
  }),
  permissionGroupId: z.string().nullable().openapi({
    description: "Assigned permission group ID (null if using direct permissions)",
    example: "group_abc123",
  }),
  permissionGroup: z.object({
    id: z.string().openapi({
      description: "Group ID",
      example: "group_abc123",
    }),
    name: z.string().openapi({
      description: "Group name",
      example: "Standard Users",
    }),
  }).nullable().openapi({
    description: "Permission group details (null if using direct permissions)",
  }),
  permissionSourceType: z.enum(["group", "direct"]).openapi({
    description: "Source type of permissions",
    example: "group",
  }),
  permissions: z.array(SchemaPermissionDetail).openapi({
    description: "List of all effective permissions with source details",
    example: [
      { name: "documents.view", source: "group" },
      { name: "user.read", source: "direct" },
    ],
  }),
  hasPasskey: z.boolean().openapi({
    description: "Whether the user has passkeys registered.",
    example: false,
  }),
  encryption: z.object({
    isEnhancedEncryptionEnabled: z.boolean().openapi({
      description: "Whether enhanced encryption is enabled for the user",
      example: false,
    }),
    hasPassword: z.boolean().openapi({
      description: "Whether user has a password set (can use password for encryption)",
      example: true,
    }),
    hasPasskeys: z.boolean().openapi({
      description: "Whether user has any passkeys registered",
      example: true,
    }),
    hasPRF: z.boolean().openapi({
      description: "Whether user has PRF configured for any passkey",
      example: false,
    }),
    passkeysNeedingPRF: z.array(z.object({
      id: z.string().openapi({
        description: "Passkey credential ID",
        example: "e3DEIFNZfD44-9SlpCB5Qg",
      }),
      displayName: z.string().nullable().openapi({
        description: "Display name of the passkey",
        example: "ProtonPass",
      }),
      createdAt: z.number().openapi({
        description: "When the passkey was created",
        example: 1704067200,
      }),
    })).openapi({
      description: "List of passkeys that need PRF setup for encryption",
      example: [{ id: "e3DEIFNZfD44-9SlpCB5Qg", displayName: "ProtonPass", createdAt: 1704067200 }],
    }),
    recommendedAction: z.enum(["setup_prf", "enable_encryption", "none"]).openapi({
      description:
        "Recommended action for the frontend: 'setup_prf' = user has passkeys but no PRF, 'enable_encryption' = ready to enable encryption, 'none' = no action needed",
      example: "setup_prf",
    }),
  }).openapi({
    description: "Encryption status and recommendations for the user",
  }),
  features: z.array(z.string()).openapi({
    description:
      "List of enabled optional features for the user's environment. Core features (tasks, apiKeys, notifications) are always available and not listed.",
    example: ["documents", "encryption", "publicSharing", "notes", "knowledgeBase"],
  }),
});

/**
 * Export types
 */
export type IEnvironmentConfigUserResponse = z.infer<typeof SchemaEnvironmentConfigUserResponse>;
export type IEnvironmentConfigUserListItemResponse = z.infer<typeof SchemaEnvironmentConfigUserListItemResponse>;
export type IEnvironmentConfigUserListResponse = z.infer<typeof SchemaEnvironmentConfigUserListResponse>;
export type IEnvironmentConfigUserCreateRequest = z.infer<typeof SchemaEnvironmentConfigUserCreateRequest>;
export type IEnvironmentConfigUserUpdateRequest = z.infer<typeof SchemaEnvironmentConfigUserUpdateRequest>;
export type IEnvironmentConfigUserListQuery = z.infer<typeof SchemaEnvironmentConfigUserListQuery>;
export type IEnvironmentConfigUserCreateResponse = z.infer<typeof SchemaEnvironmentConfigUserCreateResponse>;
export type IEnvironmentConfigUserUpdateResponse = z.infer<typeof SchemaEnvironmentConfigUserUpdateResponse>;
export type IEnvironmentConfigUserDeleteResponse = z.infer<typeof SchemaEnvironmentConfigUserDeleteResponse>;
export type IPermissionDetail = z.infer<typeof SchemaPermissionDetail>;
export type ICurrentUserResponse = z.infer<typeof SchemaCurrentUserResponse>;
