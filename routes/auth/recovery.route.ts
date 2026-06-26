/**
 * @file routes/auth/recovery.route.ts
 * @description Account recovery API routes
 */

import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { httpResponseBadRequest, httpResponseInternalServerError, httpResponseUnauthorized } from "@utils/openapi/open-api-shared.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";
import {
  SchemaAccountRecoveryInitiateRequest,
  SchemaAccountRecoveryInitiateResponse,
  SchemaResetPasswordRecoveryRequest,
  SchemaResetPasswordRecoveryResponse,
  SchemaVerifyRecoveryPhraseRequest,
  SchemaVerifyRecoveryPhraseResponse,
} from "@models/auth/index.ts";

/**
 * POST /api/auth/recovery/begin
 * Initiates account recovery — determines available options for the given identifier
 */
export const recoveryBeginRoute = createRoute({
  method: "post",
  path: "/recovery/begin",
  operationId: "authRecoveryStart",
  summary: "Initiate account recovery",
  description:
    "Starts the account recovery process. For email, sends a reset link if account exists (always returns success to prevent enumeration). For username, returns available recovery options without revealing account existence.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: SchemaAccountRecoveryInitiateRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Recovery options returned",
      content: {
        "application/json": {
          schema: SchemaAccountRecoveryInitiateResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/auth/recovery/verify-phrase
 * Verifies recovery phrase and issues a recovery token
 */
export const recoveryVerifyPhraseRoute = createRoute({
  method: "post",
  path: "/recovery/verify-phrase",
  operationId: "authRecoveryVerify",
  summary: "Verify recovery phrase",
  description: "Verifies the recovery phrase and issues a recovery token. Accepts email or username as identifier.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: SchemaVerifyRecoveryPhraseRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Recovery phrase verified",
      content: {
        "application/json": {
          schema: SchemaVerifyRecoveryPhraseResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/auth/recovery/reset-password
 * Resets the user's password during recovery
 */
export const recoveryResetPasswordRoute = createRoute({
  method: "post",
  path: "/recovery/reset-password",
  operationId: "authRecoveryResetPassword",
  summary: "Reset password during recovery",
  description:
    "Resets the user's password using either a recovery token (from phrase verification) or an email token (from email link).\n\n**Behavior:** sets the new password and, where applicable, returns a freshly rotated recovery phrase.\n**Auth:** public (gated by the recovery or email token in the body).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: SchemaResetPasswordRecoveryRequest,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Password reset successful",
      content: {
        "application/json": {
          schema: SchemaResetPasswordRecoveryResponse,
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

// Schemas for 2FA and backup code routes during recovery
const RecoveryDisable2FARequestSchema = z.object({
  recoveryToken: z.string().min(1, withKey("validation.recovery-token-required", "Recovery token is required")),
  twoFactorCode: z.string().optional(),
});

const RecoveryDisable2FAResponseSchema = z.object({
  success: z.boolean(),
});

const RecoveryVerifyBackupCodeRequestSchema = z.object({
  /** Recovery token (from phrase verification) OR emailToken (from email link). One must be provided. */
  recoveryToken: z.string().optional(),
  emailToken: z.string().optional(),
  /** A 2FA TOTP code (6-digit) or a backup code. One of the two must be provided. */
  twoFaCode: z.string().optional(),
  backupCode: z.string().optional(),
}).refine(
  (data) => data.recoveryToken || data.emailToken,
  withKey("validation.token-required", "Either recoveryToken or emailToken is required"),
).refine(
  (data) => data.twoFaCode || data.backupCode,
  withKey("validation.2fa-or-backup-required", "Either a 2FA code or backup code is required"),
);

const RecoveryVerifyBackupCodeResponseSchema = z.object({
  success: z.boolean(),
  verifiedToken: z.string(),
});

const RecoverySendResetEmailRequestSchema = z.object({
  email: z.string().email(withKey("validation.email-required", "Valid email is required")),
});

const RecoverySendResetEmailResponseSchema = z.object({
  success: z.boolean(),
});

const RecoveryVerifyEmailTokenRequestSchema = z.object({
  emailToken: z.string().min(1, withKey("validation.email-token-required", "Email token is required")),
});

const RecoveryVerifyEmailTokenResponseSchema = z.object({
  valid: z.boolean(),
  identifier: z.string().optional(),
  recoveryOptions: z.object({
    emailLink: z.boolean(),
    recoveryPhrase: z.boolean(),
  }).optional(),
  enhancedEncryptionEnabled: z.boolean().optional(),
  hasRecoveryPhrase: z.boolean().optional(),
  /** True if 2FA is enabled — frontend must gate on 2FA/backup code before password reset */
  has2FA: z.boolean().optional(),
  requiresUserSelection: z.boolean().optional(),
  availableUsers: z.array(z.object({
    userId: z.string(),
    environmentName: z.string(),
    displayName: z.string(),
  })).optional(),
});

/**
 * POST /api/auth/recovery/disable-2fa
 * Disables 2FA during recovery (when authenticator is lost)
 */
export const recoveryDisable2FARoute = createRoute({
  method: "post",
  path: "/recovery/disable-2fa",
  operationId: "authRecoveryDisable2FA",
  summary: "Disable 2FA during recovery",
  description:
    "Disables two-factor authentication during account recovery when the authenticator device is lost.\n\n**Auth:** public (gated by the recovery token in the body).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RecoveryDisable2FARequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "2FA disabled",
      content: { "application/json": { schema: RecoveryDisable2FAResponseSchema } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/auth/recovery/verify-backup-code
 * Verifies a 2FA backup code during recovery
 */
export const recoveryVerifyBackupCodeRoute = createRoute({
  method: "post",
  path: "/recovery/verify-backup-code",
  operationId: "authRecoveryVerifyBackupCode",
  summary: "Verify 2FA backup code during recovery",
  description:
    "Verifies a 2FA backup code to allow recovery when the authenticator is unavailable.\n\n**Behavior:** on success returns a fresh verified token to continue the recovery flow.\n**Auth:** public (gated by the recovery/email token in the body).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RecoveryVerifyBackupCodeRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Backup code verified",
      content: { "application/json": { schema: RecoveryVerifyBackupCodeResponseSchema } },
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/auth/recovery/send-reset-email
 * Sends account recovery email
 */
export const recoverySendResetEmailRoute = createRoute({
  method: "post",
  path: "/recovery/send-reset-email",
  operationId: "authRecoverySendEmail",
  summary: "Send account recovery email",
  description: "Sends an account recovery email link. Always returns success to prevent email enumeration.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RecoverySendResetEmailRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Recovery email sent (or silently no-op if email not found)",
      content: { "application/json": { schema: RecoverySendResetEmailResponseSchema } },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

/**
 * POST /api/auth/recovery/verify-email-token
 * Validates an email recovery token
 */
export const recoveryVerifyEmailTokenRoute = createRoute({
  method: "post",
  path: "/recovery/verify-email-token",
  operationId: "authRecoveryVerifyEmailToken",
  summary: "Verify email recovery token",
  description:
    "Validates the token from the recovery email link and returns available recovery options.\n\n**Auth:** public (gated by the email token in the body).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: RecoveryVerifyEmailTokenRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "Token validation result with recovery options",
      content: { "application/json": { schema: RecoveryVerifyEmailTokenResponseSchema } },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});
