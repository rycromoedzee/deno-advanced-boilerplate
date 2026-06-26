/**
 * @file routes/user/password.route.ts
 * @description Password management routes for authenticated users
 */

import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { SCHEMA_VALIDATION_PASSWORD } from "@models/auth/index.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const ErrorResponseSchema = ZodHttpExceptionSchema;

const SetPasswordRequestSchema = z.object({
  reauthToken: z.string().min(1, withKey("validation.reauth-token-required", "Re-authentication token is required")),
  newPassword: SCHEMA_VALIDATION_PASSWORD,
});

const SetPasswordResponseSchema = z.object({
  success: z.literal(true),
});

export const setPasswordRoute = createRoute({
  method: "post",
  path: "/password/set",
  summary: "Set password with passkey re-authentication",
  operationId: "userPasswordSet",
  description: "Sets a password for the authenticated user after passkey re-authentication with PRF output.\n\n" +
    "**Behavior:** Consumes a single-use re-authentication token (issued by `POST /user/passkey/reauth/*`) and sets the new password, deriving the password key and wiring it into the enhanced-encryption master-key wrap.\n" +
    "**Auth:** Cookie session (the access token identifies the user and session).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Requires a valid `reauthToken` tied to the current session; the token is consumed on success.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: SetPasswordRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Password set successfully",
      content: {
        "application/json": { schema: SetPasswordResponseSchema },
      },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

/**
 * Change Password Route
 */
const ChangePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1, withKey("validation.current-password-required", "Current password is required")),
  newPassword: SCHEMA_VALIDATION_PASSWORD,
});

const _ChangePasswordResponseSchema = z.object({
  success: z.literal(true),
});

export const changePasswordRoute = createRoute({
  method: "post",
  path: "/password/change",
  summary: "Change password for authenticated user",
  operationId: "userPasswordChange",
  description:
    "Changes the password for an authenticated user. Requires current password verification. Updates the password-encrypted master key if enhanced encryption is enabled, and updates the session with the new password-derived key.\n\n" +
    "**Behavior:** Verifies the current password, then rotates to the new password, re-wrapping the enhanced-encryption master key when enabled and re-keying the active session so the user stays logged in.\n" +
    "**Auth:** Cookie session — requires both a valid access token and a refresh token cookie.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Returns `204 No Content` on success. Constant-time password verification; current password must be correct.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: ChangePasswordRequestSchema },
      },
    },
  },
  responses: {
    204: {
      description: "Password changed successfully",
    },
    400: {
      description: "Bad request - invalid password format",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized - invalid current password",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});
