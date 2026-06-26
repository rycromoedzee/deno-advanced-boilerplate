/**
 * @file models/users/api-keys.model.ts
 * @description Api Keys model/types
 */
import { z } from "@deps";
import { SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP } from "../shared.model.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

/**
 * API Key creation request schema
 */
export const SchemaUserApiKeyCreateRequest = z.object({
  name: z.string()
    .min(1, withKey("api-key.name-required", "Name is required"))
    .max(100, withKey("api-key.name-max-length", "Name must be at most 100 characters"))
    .openapi({ description: "Human-readable name for the API key", example: "CI deploy key" }),
  description: z.string()
    .max(500, withKey("api-key.description-max-length", "Description must be at most 500 characters"))
    .optional()
    .openapi({ description: "Optional description of the key's purpose", example: "Used by the staging pipeline" }),
  permissions: z.array(z.string()).optional()
    .openapi({
      description: "Permission names to apply for this API key",
      example: [
        "users.read",
        "documents.sharing.public",
      ],
    }),
  permissionGroup: z.string().optional()
    .openapi({
      description: "Use a set of permissions that are saved to a group. The group ID should be provided",
      example: "r1xgsghgcwsa6n6v",
    }),
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP.refine(
    (val) => !val || val > Date.now(),
    { message: withKey("api-key.expiration-future", "Expiration timestamp must be in the future") },
  ),
  ipRestrictions: z.array(z.string())
    .max(10, withKey("api-key.ip-restrictions-max", "Maximum 10 IP restrictions allowed"))
    .optional()
    .openapi({
      description: "String array of IPs that are allowed to use the API Key",
      example: ["192.168.1.1", "10.0.0.1"],
    }),
  domainRestrictions: z.array(z.string())
    .max(10, withKey("api-key.domain-restrictions-max", "Maximum 10 domain restrictions allowed"))
    .optional()
    .openapi({
      description: "String array of domains that are allowed to use the API Key",
      example: ["google.ca", "my.domain.com"],
    }),
})
  .refine(
    (data) => data.permissions || data.permissionGroup,
    {
      message: withKey("api-key.permissions-or-group-required", "Either 'permissions' or 'permissionGroup' must be specified"),
      path: ["permissions"],
    },
  )
  .refine(
    (data) => !(data.permissions && data.permissionGroup),
    {
      message: withKey(
        "api-key.permissions-or-group-exclusive",
        "Cannot specify both 'permissions' and 'permissionGroup' - choose one approach",
      ),
      path: ["permissionGroup"],
    },
  )
  .refine(
    (data) => !(data.domainRestrictions && data.ipRestrictions),
    {
      message: withKey(
        "api-key.restrictions-exclusive",
        "Cannot specify both 'ipRestrictions' and 'domainRestrictions' - choose one approach",
      ),
      path: ["ipRestrictions"],
    },
  );

export type IUserApiKeyCreateRequest = z.infer<typeof SchemaUserApiKeyCreateRequest>;

/**
 * API Key creation response schema
 */
export const SchemaUserApiKeyCreateResponse = z.object({
  id: z.string().openapi({ description: "CUID2 identifier of the created API key", example: "ck1m2x9qp0000qzrm4x8p3f2h" }),
  name: z.string().openapi({ description: "Name assigned to the API key", example: "CI deploy key" }),
  key: z.string().openapi({
    description: "Full plaintext API key — shown only once at creation",
    example: "dab_live_a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  }),
  keyEndingIn: z.string().openapi({ description: "Last characters of the key for display", example: "o5p6" }),
  permissions: z.array(z.string()).openapi({
    description: "Effective permission names granted to the key",
    example: ["users.read", "documents.sharing.public"],
  }),
  expiresAt: SCHEMA_VALIDATION_OPTIONAL_TIMESTAMP,
});

export type IUserApiKeyCreateResponse = z.infer<typeof SchemaUserApiKeyCreateResponse>;

/**
 * API Key extension response schema
 */
export const SchemaUserApiKeyExtendResponse = z.object({
  success: z.boolean().openapi({ description: "Whether the extension succeeded", example: true }),
  newExpiresAt: z.number().int().nonnegative().openapi({
    description: "The new expiration timestamp (unix seconds)",
    example: 1789977600,
  }),
});

export type IUserApiKeyExtendResponse = z.infer<typeof SchemaUserApiKeyExtendResponse>;

/**
 * API Key revocation response schema
 * Revocation returns 204 No Content, but we provide a schema
 * for consistency with the handler pattern.
 */
export const SchemaUserApiKeyRevokeResponse = z.object({
  success: z.boolean().openapi({ description: "Whether the revocation succeeded", example: true }),
});

export type IUserApiKeyRevokeResponse = z.infer<typeof SchemaUserApiKeyRevokeResponse>;
