/**
 * @file models/super-admin/environment.model.ts
 * @description Environment model/types
 */
import { z } from "@deps";
import { withKey } from "@utils/validation/zod-message-key.ts";
import { STRING_LENGTH_CONSTRAINTS } from "@constants/validation/string-lengths.ts";

// ============ Environment ============

export const SchemaEnvironmentResponse = z.object({
  id: z.string().openapi({ description: "Environment ID", example: "env_001" }),
  name: z.string().openapi({ description: "Environment name", example: "Production" }),
  description: z.string().nullable().openapi({ description: "Optional description", example: "Main production environment" }),
  status: z.enum(["active", "inactive", "provisioning", "suspended", "deactivated"]).openapi({
    description: "Environment status",
    example: "active",
  }),
  createdAt: z.number().openapi({ description: "Creation timestamp", example: 1711670400 }),
  updatedAt: z.number().openapi({ description: "Last update timestamp", example: 1711843200 }),
});

export const SchemaEnvironmentListResponse = z.object({
  data: z.array(SchemaEnvironmentResponse),
});

export const SchemaEnvironmentCreateRequest = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("environment.name-required", "Name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("environment.name-max-length", `Name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({ description: "Environment name", example: "Production" }),
  description: z.string()
    .trim()
    .max(500, withKey("environment.description-max-length", "Description must be at most 500 characters"))
    .optional()
    .openapi({ description: "Optional description", example: "Main production environment" }),
});

export const SchemaEnvironmentIdParam = z.object({
  environmentId: z.string().openapi({ description: "Environment ID", example: "env_001" }),
});

export const SchemaEnvironmentUpdateRequest = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("environment.name-required", "Name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("environment.name-max-length", `Name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({ description: "Environment name", example: "Production" }),
  description: z.string()
    .trim()
    .max(500, withKey("environment.description-max-length", "Description must be at most 500 characters"))
    .optional()
    .openapi({ description: "Optional description", example: "Main production environment" }),
  customSubdomain: z.string()
    .trim()
    .max(255, withKey("environment.custom-subdomain-max-length", "Custom subdomain must be at most 255 characters"))
    .optional()
    .openapi({ description: "Custom subdomain", example: "tenant" }),
  customDomain: z.string()
    .trim()
    .max(255, withKey("environment.custom-domain-max-length", "Custom domain must be at most 255 characters"))
    .optional()
    .openapi({ description: "Custom domain", example: "tenant.example.com" }),
  timezone: z.string()
    .trim()
    .max(100, withKey("environment.timezone-max-length", "Timezone must be at most 100 characters"))
    .optional()
    .openapi({ description: "Default timezone", example: "Europe/Paris" }),
  defaultLanguage: z.string()
    .trim()
    .max(10, withKey("environment.default-language-max-length", "Language code must be at most 10 characters"))
    .optional()
    .openapi({ description: "Default language code", example: "fr" }),
  internalNotes: z.string()
    .trim()
    .max(
      STRING_LENGTH_CONSTRAINTS.DESCRIPTION_LONG_MAX,
      withKey(
        "environment.internal-notes-max-length",
        `Internal notes must be at most ${STRING_LENGTH_CONSTRAINTS.DESCRIPTION_LONG_MAX} characters`,
      ),
    )
    .nullable()
    .optional()
    .openapi({ description: "Internal notes (super-admin only)", example: "Enterprise client since Jan 2026" }),
});

export const SchemaDestroyConfirmationRequest = z.object({
  confirmation: z.string()
    .min(1, withKey("environment.confirmation-required", "Confirmation is required"))
    .openapi({ description: "Must match environment name exactly", example: "Production" }),
});

// ============ Database ============

export const SchemaDatabaseResponse = z.object({
  id: z.string().openapi({ description: "Database config ID", example: "db_001" }),
  environmentId: z.string().openapi({ description: "Environment ID", example: "env_001" }),
  url: z.string().openapi({ description: "Database URL", example: "libsql://prod.turso.io" }),
  token: z.string().openapi({ description: "Masked access token", example: "***" }),
  status: z.enum(["connected", "disconnected", "error"]).openapi({ description: "Connection status", example: "connected" }),
  createdAt: z.number().openapi({ description: "Creation timestamp", example: 1711670400 }),
});

// URL-based database creation (remote libsql or external file)
export const SchemaDatabaseCreateRequest = z.object({
  url: z.string()
    .trim()
    .min(1, withKey("database.url-required", "URL is required"))
    .max(2048, withKey("database.url-max-length", "URL must be at most 2048 characters"))
    .openapi({ description: "Database URL (libsql:// or file: path)", example: "libsql://prod.turso.io" }),
  token: z.string()
    .min(0, withKey("database.token-min-length", "Token is required for remote databases"))
    .max(4096, withKey("database.token-max-length", "Token must be at most 4096 characters"))
    .openapi({ description: "Access token (empty string for file:-based databases)", example: "tok-prod-secret" }),
});

// Local-based database creation (auto-created in the designated directory)
// The database file name is auto-calculated using the DB shortcode and environment ID
export const SchemaLocalDatabaseCreateRequest = z.object({
  local: z.literal(true)
    .openapi({ description: "Flag to indicate local database creation", example: true }),
});

// Combined schema that accepts either URL-based or local-based database creation
export const SchemaDatabaseCreateRequestCombined = z.object({
  url: z.string()
    .trim()
    .max(2048, withKey("database.url-max-length", "URL must be at most 2048 characters"))
    .optional()
    .openapi({ description: "Database URL (libsql:// or file: path). Optional if local=true", example: "libsql://prod.turso.io" }),
  token: z.string()
    .min(0, withKey("database.token-min-length", "Token is required for remote databases"))
    .max(4096, withKey("database.token-max-length", "Token must be at most 4096 characters"))
    .optional()
    .openapi({ description: "Access token (not required for local databases)", example: "tok-prod-secret" }),
  local: z.boolean()
    .optional()
    .openapi({
      description: "If true, creates a local database file with auto-generated name using DB shortcode and environment ID",
      example: false,
    }),
}).refine(
  (data) => {
    if (data.local === true) {
      // Local mode: url and token are not allowed
      return !data.url && !data.token;
    } else {
      // URL mode: url is required
      return !!data.url;
    }
  },
  {
    message: "Either provide 'url' (and optionally 'token') for remote database, or 'local': true for local database (auto-created)",
    path: ["url"],
  },
);

// ============ Admin User ============

export const SchemaAdminUserResponse = z.object({
  id: z.string().openapi({ description: "Admin user ID", example: "admin_001" }),
  environmentId: z.string().openapi({ description: "Environment ID", example: "env_001" }),
  username: z.string().openapi({ description: "Admin username", example: "admin" }),
  email: z.string().openapi({ description: "Admin email", example: "admin@example.com" }),
  firstName: z.string().openapi({ description: "First name", example: "System" }),
  lastName: z.string().openapi({ description: "Last name", example: "Admin" }),
  lang: z.string().openapi({ description: "Language", example: "en" }),
  createdAt: z.number().openapi({ description: "Creation timestamp", example: 1711670400 }),
});

export const SchemaAdminUserCreateRequest = z.object({
  username: z.string()
    .trim()
    .min(1, withKey("admin-user.username-required", "Username is required"))
    .max(50, withKey("admin-user.username-max-length", "Username must be at most 50 characters"))
    .openapi({ description: "Admin username", example: "admin" }),
  email: z.string()
    .email(withKey("admin-user.email-invalid", "Invalid email format"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.email-max-length", `Email must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({ description: "Admin email", example: "admin@example.com" }),
  firstName: z.string()
    .trim()
    .min(1, withKey("admin-user.first-name-required", "First name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.first-name-max-length", `First name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({ description: "First name", example: "System" }),
  lastName: z.string()
    .trim()
    .min(1, withKey("admin-user.last-name-required", "Last name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.last-name-max-length", `Last name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .openapi({ description: "Last name", example: "Admin" }),
  lang: z.enum(["en", "fr"]).openapi({ description: "Language preference", example: "en" }),
});

// ============ Combined Environment Detail Response (Flat) ============

export const SchemaEnvironmentDetailResponse = SchemaEnvironmentResponse.extend({
  // Database fields (flattened, nullable)
  databaseId: z.string().nullable().openapi({ description: "Database config ID", example: "db_001" }),
  databaseUrl: z.string().nullable().openapi({ description: "Database URL", example: "libsql://prod.turso.io" }),
  databaseToken: z.string().nullable().openapi({ description: "Masked access token", example: "***" }),
  databaseStatus: z.enum(["connected", "disconnected", "error"]).nullable().openapi({
    description: "Connection status",
    example: "connected",
  }),
  databaseCreatedAt: z.number().nullable().openapi({ description: "Database creation timestamp", example: 1711670400 }),
  // Admin user fields (flattened, nullable)
  adminUserId: z.string().nullable().openapi({ description: "Admin user ID", example: "admin_001" }),
  adminUsername: z.string().nullable().openapi({ description: "Admin username", example: "admin" }),
  adminEmail: z.string().nullable().openapi({ description: "Admin email", example: "admin@example.com" }),
  adminFirstName: z.string().nullable().openapi({ description: "First name", example: "System" }),
  adminLastName: z.string().nullable().openapi({ description: "Last name", example: "Admin" }),
  adminLang: z.string().nullable().openapi({ description: "Language", example: "en" }),
  adminUserCreatedAt: z.number().nullable().openapi({ description: "Admin user creation timestamp", example: 1711670400 }),
});

// ============ Environment Overview ============

export const SchemaEnvironmentOverviewGeneral = z.object({
  id: z.string().openapi({ description: "Environment ID", example: "env_001" }),
  name: z.string().openapi({ description: "Environment name", example: "Acme Corp" }),
  description: z.string().nullable().openapi({ description: "Optional description", example: "Main production environment" }),
  customSubdomain: z.string().nullable().openapi({ description: "Custom subdomain", example: "acme" }),
  customDomain: z.string().nullable().openapi({ description: "Custom domain", example: "acme.example.com" }),
  status: z.enum(["active", "inactive", "provisioning", "suspended", "deactivated"]).openapi({
    description: "Environment status",
    example: "active",
  }),
  timezone: z.string().openapi({ description: "Default timezone for new users", example: "Europe/Paris" }),
  defaultLanguage: z.string().openapi({ description: "Default language for new users", example: "fr" }),
  internalNotes: z.string().nullable().openapi({
    description: "Internal notes (super-admin only)",
    example: "Enterprise client since Jan 2026",
  }),
  createdAt: z.number().openapi({ description: "Creation timestamp", example: 1711670400 }),
  updatedAt: z.number().openapi({ description: "Last update timestamp", example: 1711843200 }),
});

export const SchemaEnvironmentOverviewPrimaryAdmin = z.object({
  id: z.string().openapi({ description: "Admin user ID", example: "usr_001" }),
  firstName: z.string().openapi({ description: "First name", example: "Jean" }),
  lastName: z.string().openapi({ description: "Last name", example: "Dupont" }),
  email: z.string().openapi({ description: "Email address", example: "jean@acme.com" }),
  isActive: z.boolean().openapi({ description: "Whether the admin account is active", example: true }),
  lastLoginAt: z.number().nullable().openapi({ description: "Last login timestamp", example: 1711843200 }),
});

export const SchemaEnvironmentFeatures = z.object({
  documents: z.boolean().openapi({ description: "Documents module enabled", example: true }),
  encryption: z.boolean().openapi({ description: "Encryption module enabled", example: true }),
  publicSharing: z.boolean().openapi({ description: "Public sharing enabled", example: true }),
  notes: z.boolean().openapi({ description: "Notes module enabled", example: true }),
  knowledgeBase: z.boolean().openapi({ description: "Knowledge base module enabled", example: true }),
});

export const SchemaEnvironmentQuotas = z.object({
  maxUsers: z.number().nullable().openapi({ description: "Max users (null = unlimited)", example: 50 }),
  maxStorageKb: z.number().nullable().openapi({ description: "Max storage in KB (null = unlimited)", example: 10485760 }),
  maxFileSizeKb: z.number().nullable().openapi({ description: "Max file size in KB (null = unlimited)", example: 102400 }),
  currentStorageKb: z.number().openapi({ description: "Current storage usage in KB", example: 524288 }),
});

export const SchemaEnvironmentOverviewDatabase = z.object({
  id: z.string().openapi({ description: "Database config ID", example: "db_001" }),
  url: z.string().openapi({ description: "Database URL", example: "libsql://prod.turso.io" }),
  token: z.string().openapi({ description: "Masked access token", example: "***" }),
  status: z.enum(["connected", "disconnected", "error"]).openapi({ description: "Connection status", example: "connected" }),
  createdAt: z.number().openapi({ description: "Creation timestamp", example: 1711670400 }),
});

export const SchemaEnvironmentOverviewResponse = z.object({
  general: SchemaEnvironmentOverviewGeneral,
  primaryAdmin: SchemaEnvironmentOverviewPrimaryAdmin.nullable().openapi({ description: "Primary admin (null if no admin user exists)" }),
  features: SchemaEnvironmentFeatures,
  quotas: SchemaEnvironmentQuotas,
  database: SchemaEnvironmentOverviewDatabase.nullable().openapi({ description: "Database config (null if not registered)" }),
});

// ============ Feature Toggle Update ============

export const SchemaEnvironmentFeaturesUpdateRequest = z.object({
  documents: z.boolean().optional().openapi({ description: "Documents module", example: true }),
  encryption: z.boolean().optional().openapi({ description: "Encryption module", example: true }),
  publicSharing: z.boolean().optional().openapi({ description: "Public sharing", example: false }),
  notes: z.boolean().optional().openapi({ description: "Notes module", example: true }),
  knowledgeBase: z.boolean().optional().openapi({ description: "Knowledge base module", example: true }),
});

// ============ Quota Update ============

export const SchemaEnvironmentQuotasUpdateRequest = z.object({
  maxUsers: z.number().int().min(0).nullable().optional()
    .openapi({ description: "Max users (null or 0 = unlimited)", example: 50 }),
  maxStorageKb: z.number().int().min(0).nullable().optional()
    .openapi({ description: "Max storage in KB (null or 0 = unlimited)", example: 10485760 }),
  maxFileSizeKb: z.number().int().min(0).nullable().optional()
    .openapi({ description: "Max file size in KB (null or 0 = unlimited)", example: 102400 }),
});

// ============ Primary Admin Update ============

export const SchemaEnvironmentPrimaryAdminUpdateRequest = z.object({
  firstName: z.string()
    .trim()
    .min(1, withKey("admin-user.first-name-required", "First name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.first-name-max-length", `First name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({ description: "First name", example: "Jean" }),
  lastName: z.string()
    .trim()
    .min(1, withKey("admin-user.last-name-required", "Last name is required"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.last-name-max-length", `Last name must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({ description: "Last name", example: "Dupont" }),
  email: z.string()
    .email(withKey("admin-user.email-invalid", "Invalid email format"))
    .max(
      STRING_LENGTH_CONSTRAINTS.NAME_MAX,
      withKey("admin-user.email-max-length", `Email must be at most ${STRING_LENGTH_CONSTRAINTS.NAME_MAX} characters`),
    )
    .optional()
    .openapi({ description: "Email address", example: "jean@acme.com" }),
});

// ============ Response DTOs for features/quotas/password-reset ============

export const SchemaEnvironmentFeaturesResponse = SchemaEnvironmentFeatures;

export const SchemaEnvironmentQuotasResponse = SchemaEnvironmentQuotas;

export const SchemaPrimaryAdminPasswordResetResponse = z.object({
  success: z.boolean(),
  message: z.string().optional(),
});

// ============ Export types ============

export type IEnvironmentResponse = z.infer<typeof SchemaEnvironmentResponse>;
export type IEnvironmentDetailResponse = z.infer<typeof SchemaEnvironmentDetailResponse>;
export type IEnvironmentCreateRequest = z.infer<typeof SchemaEnvironmentCreateRequest>;
export type IEnvironmentUpdateRequest = z.infer<typeof SchemaEnvironmentUpdateRequest>;
export type IDestroyConfirmationRequest = z.infer<typeof SchemaDestroyConfirmationRequest>;
export type IDatabaseResponse = z.infer<typeof SchemaDatabaseResponse>;
export type IDatabaseCreateRequest = z.infer<typeof SchemaDatabaseCreateRequest>;
export type ILocalDatabaseCreateRequest = z.infer<typeof SchemaLocalDatabaseCreateRequest>;
export type IDatabaseCreateRequestCombined = z.infer<typeof SchemaDatabaseCreateRequestCombined>;
export type IAdminUserResponse = z.infer<typeof SchemaAdminUserResponse>;
export type IAdminUserCreateRequest = z.infer<typeof SchemaAdminUserCreateRequest>;
export type IEnvironmentOverviewResponse = z.infer<typeof SchemaEnvironmentOverviewResponse>;
export type IEnvironmentFeaturesUpdateRequest = z.infer<typeof SchemaEnvironmentFeaturesUpdateRequest>;
export type IEnvironmentQuotasUpdateRequest = z.infer<typeof SchemaEnvironmentQuotasUpdateRequest>;
export type IEnvironmentPrimaryAdminUpdateRequest = z.infer<typeof SchemaEnvironmentPrimaryAdminUpdateRequest>;
export type IEnvironmentFeaturesResponse = z.infer<typeof SchemaEnvironmentFeaturesResponse>;
export type IEnvironmentQuotasResponse = z.infer<typeof SchemaEnvironmentQuotasResponse>;
export type IPrimaryAdminPasswordResetResponse = z.infer<typeof SchemaPrimaryAdminPasswordResetResponse>;
