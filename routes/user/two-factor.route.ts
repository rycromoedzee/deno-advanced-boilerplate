/**
 * @file routes/user/two-factor.route.ts
 * @description Route definitions for user two-factor authentication management
 */

import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { httpResponseInternalServerError } from "@utils/openapi/open-api-shared.ts";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const ErrorResponseSchema = ZodHttpExceptionSchema;

// =====================================
// Schema Definitions
// =====================================

const TwoFactorDeviceSchema = z.object({
  id: z.string().openapi({ example: "2fa_abc123" }),
  name: z.string().openapi({ example: "Authenticator App" }),
  isActive: z.boolean().openapi({ example: true }),
  isPrimary: z.boolean().openapi({ example: true }),
  lastUsedAt: z.number().nullable().openapi({ example: 1708000000 }),
  createdAt: z.number().openapi({ example: 1707000000 }),
});

const TwoFactorListResponseSchema = z.object({
  data: z.array(TwoFactorDeviceSchema),
});

const CreateTwoFactorRequestSchema = z.object({
  name: z.string()
    .trim()
    .min(1, withKey("validation.device-name-required", "Device name is required"))
    .max(100, withKey("validation.device-name-max-length", "Device name must be at most 100 characters"))
    .openapi({
      example: "New Authenticator",
      description: "Name for this 2FA device",
    }),
  isPrimary: z.boolean().optional().default(false).openapi({
    example: false,
    description: "Set as primary 2FA device",
  }),
  password: z.string().min(1, withKey("validation.password-required", "Password is required")).openapi({
    example: "user-password",
    description: "Current password required for security verification",
  }),
});

const CreateTwoFactorResponseSchema = z.object({
  secretId: z.string().openapi({ example: "2fa_xyz789" }),
  uri: z.string().openapi({
    example: "otpauth://totp/AppName:Device?secret=JBSWY3DPEHPK3PXP&issuer=AppName",
    description: "OTP Auth URI for QR code generation",
  }),
  backupCodes: z.array(z.string()).optional().openapi({
    example: ["abc123-def456-ghi789", "jkl012-mno345-pqr678"],
    description: "Backup codes (only provided on first 2FA device setup)",
  }),
});

const DeleteTwoFactorParamsSchema = z.object({
  id: z.string().openapi({ example: "2fa_abc123" }),
});

const DeleteTwoFactorRequestSchema = z.object({
  password: z.string().min(1, withKey("validation.password-required", "Password is required")).openapi({
    example: "user-password",
    description: "Current password required for security verification",
  }),
  twoFactorCode: z.string().length(6, withKey("validation.2fa-code-length", "2FA code must be 6 digits")).openapi({
    example: "123456",
    description: "2FA code from the device being removed",
  }),
});

const DeleteTwoFactorResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

const RegenerateBackupCodesRequestSchema = z.object({
  password: z.string().min(1, withKey("validation.password-required", "Password is required")).openapi({
    example: "user-password",
    description: "Current password required for security verification",
  }),
  backupCode: z.string().min(1, withKey("validation.backup-code-required", "Backup code is required")).openapi({
    example: "ABCDEFGH-12345678",
    description: "A current backup code (will be consumed during validation)",
  }),
});

const RegenerateBackupCodesResponseSchema = z.object({
  backupCodes: z.array(z.string()).openapi({
    example: ["abc123-def456-ghi789", "jkl012-mno345-pqr678"],
    description: "New backup codes - save these securely",
  }),
  message: z.string(),
});

const TwoFactorStatusResponseSchema = z.object({
  isEnabled: z.boolean().openapi({
    example: true,
    description: "Whether 2FA is enabled for the user",
  }),
  activeDeviceCount: z.number().openapi({
    example: 2,
    description: "Number of active 2FA devices",
  }),
  hasBackupCodes: z.boolean().openapi({
    example: true,
    description: "Whether backup codes are available",
  }),
});

// =====================================
// Routes
// =====================================

/**
 * List all 2FA devices for the current user
 */
export const listTwoFactorRoute = createRoute({
  method: "get",
  path: "/two-factor",
  summary: "List 2FA devices",
  operationId: "userTwoFactorList",
  description: "Get all two-factor authentication devices for the current user.\n\n" +
    "**Behavior:** Returns the user's registered TOTP devices (id, name, primary flag, active flag, timestamps). Secrets are never included.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "List of 2FA devices",
      content: {
        "application/json": { schema: TwoFactorListResponseSchema },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Create a new 2FA device
 */
export const createTwoFactorRoute = createRoute({
  method: "post",
  path: "/two-factor",
  summary: "Create 2FA device",
  operationId: "userTwoFactorCreate",
  description: "Create a new two-factor authentication device. Requires password verification. Returns URI for QR code.\n\n" +
    "**Behavior:** Verifies the current password, provisions a new TOTP secret, and returns the `otpauth://` URI (for QR generation) plus a `secretId`. Backup codes are returned only when this is the user's first 2FA device.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires knowledge of the current account password.\n" +
    "**Notes:** Request and audit logging include IP and user-agent.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: CreateTwoFactorRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "2FA device created successfully",
      content: {
        "application/json": { schema: CreateTwoFactorResponseSchema },
      },
    },
    400: {
      description: "Bad request - invalid input",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized or invalid password",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Delete a 2FA device
 */
export const deleteTwoFactorRoute = createRoute({
  method: "delete",
  path: "/two-factor/{id}",
  summary: "Delete 2FA device",
  operationId: "userTwoFactorDelete",
  description:
    "Remove a two-factor authentication device. Requires password verification and a 2FA code from the device being removed. If this is the last device, 2FA will be disabled.\n\n" +
    "**Behavior:** Verifies the current password and a live 2FA code generated by the device being removed, then deletes that device. Removing the last active device disables 2FA for the account; the response message reflects this.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires the current password and a valid code from the targeted device.\n" +
    "**Notes:** Returns 404 if the device does not exist. IP and user-agent are logged.",
  tags: [OpenAPITags.users],
  request: {
    params: DeleteTwoFactorParamsSchema,
    body: {
      content: {
        "application/json": { schema: DeleteTwoFactorRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "2FA device deleted successfully",
      content: {
        "application/json": { schema: DeleteTwoFactorResponseSchema },
      },
    },
    400: {
      description: "Bad request - device not found or invalid input",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized or invalid password/2FA code",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Regenerate backup codes
 */
export const regenerateBackupCodesRoute = createRoute({
  method: "post",
  path: "/two-factor/backup-codes",
  summary: "Regenerate backup codes",
  operationId: "userTwoFactorRegenerateBackupCodes",
  description:
    "Generate new backup codes for 2FA. Old codes will be invalidated. Requires password verification and a current backup code (which will be consumed).\n\n" +
    "**Behavior:** Verifies the current password and consumes one current backup code, then issues a fresh set of backup codes (invalidating all prior codes).\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires the current password and an unconsumed backup code.\n" +
    "**Notes:** Requires 2FA to be enabled. IP and user-agent are logged.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: RegenerateBackupCodesRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Backup codes regenerated successfully",
      content: {
        "application/json": { schema: RegenerateBackupCodesResponseSchema },
      },
    },
    400: {
      description: "Bad request - 2FA not enabled or no backup codes available",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized or invalid password/backup code",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Get 2FA status
 */
export const getTwoFactorStatusRoute = createRoute({
  method: "get",
  path: "/two-factor/status",
  summary: "Get 2FA status",
  operationId: "userTwoFactorGetStatus",
  description: "Get the current 2FA status for the user.\n\n" +
    "**Behavior:** Returns whether 2FA is enabled, the count of active devices, and whether backup codes are available. Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "2FA status retrieved successfully",
      content: {
        "application/json": { schema: TwoFactorStatusResponseSchema },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

// =====================================
// Reveal 2FA Secret Schema Definitions
// =====================================

const RevealTwoFactorParamsSchema = z.object({
  id: z.string().openapi({ example: "2fa_abc123" }),
});

const RevealTwoFactorRequestSchema = z.object({
  password: z.string().min(1, withKey("validation.password-required", "Password is required")).openapi({
    example: "user-password",
    description: "Current password required for security verification",
  }),
});

const RevealTwoFactorResponseSchema = z.object({
  secretId: z.string().openapi({ example: "2fa_xyz789" }),
  name: z.string().openapi({ example: "Authenticator App" }),
  uri: z.string().openapi({
    example: "otpauth://totp/AppName:Device?secret=JBSWY3DPEHPK3PXP&issuer=AppName",
    description: "OTP Auth URI for QR code generation",
  }),
  secret: z.string().openapi({
    example: "JBSWY3DPEHPK3PXP",
    description: "Base32-encoded secret for manual entry",
  }),
});

/**
 * Reveal 2FA secret
 */
export const revealTwoFactorRoute = createRoute({
  method: "post",
  path: "/two-factor/{id}/reveal",
  summary: "Reveal 2FA secret",
  operationId: "userTwoFactorReveal",
  description:
    "Reveal the secret and URI for an existing 2FA device. Requires password verification. Useful when user needs to re-add their authenticator to a new device.\n\n" +
    "**Behavior:** Verifies the current password, then returns the base32 secret, `otpauth://` URI, device name, and `secretId` for the device identified by the path parameter.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires knowledge of the current account password.\n" +
    "**Notes:** Sensitive — returns the raw TOTP secret. IP and user-agent are logged.",
  tags: [OpenAPITags.users],
  request: {
    params: RevealTwoFactorParamsSchema,
    body: {
      content: {
        "application/json": { schema: RevealTwoFactorRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "2FA secret revealed successfully",
      content: {
        "application/json": { schema: RevealTwoFactorResponseSchema },
      },
    },
    400: {
      description: "Bad request - device not found",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized or invalid password",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});
