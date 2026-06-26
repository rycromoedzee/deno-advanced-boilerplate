/**
 * @file routes/auth/register.route.ts
 * @description Route definitions for user registration via token
 */

import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { SCHEMA_VALIDATION_PASSWORD } from "@models/auth/index.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// Path parameter schema
const TokenParamSchema = z.object({
  token: z.string().min(1).openapi({
    description: "Password reset/registration token",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  }),
});

// GET response schema
const RegisterValidationResponseSchema = z.object({
  fullName: z.string().openapi({
    example: "John Doe",
    description: "User's full name",
  }),
  environmentName: z.string().openapi({
    example: "Production",
    description: "Environment name",
  }),
  username: z.string().nullable().openapi({
    example: "johndoe",
    description: "User's username if already set, null otherwise",
  }),
  hasPasskey: z.boolean().openapi({
    example: false,
    description: "Whether the user already has a passkey registered.",
  }),
});

// POST request schema
const RegisterRequestSchema = z.object({
  mode: z.enum(["password", "passkey-begin"]).openapi({
    description: "Registration mode",
    example: "password",
  }),
  password: SCHEMA_VALIDATION_PASSWORD.optional().openapi({
    description: "New password (required when mode is 'password')",
    example: "SecureP@ss123",
  }),
  username: z.string()
    .min(3, withKey("validation.username-min-length", "Username must be at least 3 characters"))
    .max(50, withKey("validation.username-max-length", "Username must be at most 50 characters"))
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      withKey("validation.username-format", "Username may only contain letters, numbers, underscores, and hyphens"),
    )
    .optional()
    .openapi({
      description: "Optional username to use for passkey registration (passkey-begin only)",
      example: "adminuser",
    }),
  displayName: z.string()
    .min(1, withKey("validation.display-name-required", "Display name must be at least 1 character"))
    .max(100, withKey("validation.display-name-max-length", "Display name must be at most 100 characters"))
    .optional()
    .openapi({
      description: "Optional display name for authenticator UI (passkey-begin only)",
      example: "Main user",
    }),
}).refine(
  (data) => data.mode !== "password" || (data.password && data.password.length > 0),
  { message: withKey("validation.password-required-mode", "Password is required when mode is 'password'") },
);

// Password mode success response
const RegisterPasswordSuccessSchema = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string().openapi({ example: "Registration successful" }),
  userId: z.string().openapi({ example: "user_123" }),
  environmentId: z.string().openapi({ example: "env_456" }),
  displayName: z.string().openapi({ example: "John Doe" }),
});

// Passkey-begin response
const RegisterPasskeyBeginSchema = z.object({
  isAuthCompleted: z.literal(false),
  nextStep: z.literal("passkey-register"),
  attemptId: z.string().openapi({ example: "abc123..." }),
  creationOptions: z.record(z.string(), z.unknown()).openapi({
    description: "WebAuthn credential creation options",
  }),
});

// Passkey verify request
const RegisterPasskeyVerifyRequestSchema = z.object({
  attemptId: z.string().min(1, withKey("validation.attempt-id-required", "Attempt ID is required")).openapi({
    description: "Attempt ID from passkey-begin step",
    example: "abc123...",
  }),
  credential: z.record(z.string(), z.unknown()).openapi({
    description: "WebAuthn registration response",
  }),
  displayName: z.string()
    .max(100, withKey("validation.display-name-max-length", "Display name must be at most 100 characters"))
    .optional()
    .openapi({
      description: "Optional display name for the passkey",
      example: "My YubiKey",
    }),
  username: z.string()
    .min(3, withKey("validation.username-min-length", "Username must be at least 3 characters"))
    .max(50, withKey("validation.username-max-length", "Username must be at most 50 characters"))
    .regex(
      /^[a-zA-Z0-9_-]+$/,
      withKey("validation.username-format", "Username may only contain letters, numbers, underscores, and hyphens"),
    )
    .optional()
    .openapi({
      description: "Optional username to set for the user",
      example: "johndoe",
    }),
  prfOutput: z.object({
    first: z.string().optional().openapi({
      description: "PRF output from authenticator (base64-encoded)",
    }),
  }).optional().openapi({
    description: "PRF extension output for encryption key derivation",
  }),
});

// Passkey verify success response
const RegisterPasskeyVerifySuccessSchema = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string().openapi({ example: "Passkey registration successful" }),
  userId: z.string().openapi({ example: "user_123" }),
  environmentId: z.string().openapi({ example: "env_456" }),
  displayName: z.string().openapi({ example: "John Doe" }),
  prfSetupRecommended: z.boolean().openapi({
    description: "Whether PRF setup is recommended for encryption. If true, frontend should prompt user to set up PRF.",
    example: true,
  }),
});

// Error response
const ErrorResponseSchema = ZodHttpExceptionSchema;

/**
 * GET /api/auth/register/:token
 * Validates registration token and returns user info
 */
export const registerValidateRoute = createRoute({
  method: "get",
  path: "/register/{token}",
  operationId: "authRegisterValidate",
  summary: "Validate registration token",
  description: "Validates a password reset/registration token and returns user information.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    params: TokenParamSchema,
  },
  responses: {
    200: {
      description: "Token is valid, user info returned",
      content: {
        "application/json": { schema: RegisterValidationResponseSchema },
      },
    },
    401: {
      description: "Invalid or expired token",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

/**
 * POST /api/auth/register/:token
 * Handle registration with password or begin passkey flow
 */
export const registerRoute = createRoute({
  method: "post",
  path: "/register/{token}",
  operationId: "authRegisterComplete",
  summary: "Complete registration",
  description:
    'Completes user registration by setting password or starting passkey enrollment.\n\n**Behavior:** `mode: "password"` sets the password and mints a session (sets access/refresh cookies). `mode: "passkey-begin"` starts WebAuthn enrollment and returns creation options (202).\n**Auth:** public (gated by the registration token in the path).',
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    params: TokenParamSchema,
    body: {
      content: {
        "application/json": { schema: RegisterRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Password registration successful",
      headers: {
        "Set-Cookie": {
          description: "Session and refresh tokens",
          schema: { type: "array", items: { type: "string" } },
        },
      },
      content: {
        "application/json": { schema: RegisterPasswordSuccessSchema },
      },
    },
    202: {
      description: "Passkey registration initiated",
      content: {
        "application/json": { schema: RegisterPasskeyBeginSchema },
      },
    },
    400: {
      description: "Invalid token or request",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
    401: {
      description: "Invalid or expired token",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

/**
 * POST /api/auth/register/:token/passkey
 * Verify passkey registration and complete setup
 */
export const registerPasskeyVerifyRoute = createRoute({
  method: "post",
  path: "/register/{token}/passkey",
  operationId: "authRegisterPasskeyVerify",
  summary: "Verify passkey registration",
  description:
    "Verifies the passkey credential and completes registration.\n\n**Behavior:** verifies the WebAuthn registration response, completes setup, mints a session (sets access/refresh cookies), and reports whether PRF setup is recommended.\n**Auth:** public (gated by the registration token in the path).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    params: TokenParamSchema,
    body: {
      content: {
        "application/json": { schema: RegisterPasskeyVerifyRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Passkey registration successful",
      headers: {
        "Set-Cookie": {
          description: "Session and refresh tokens",
          schema: { type: "array", items: { type: "string" } },
        },
      },
      content: {
        "application/json": { schema: RegisterPasskeyVerifySuccessSchema },
      },
    },
    400: {
      description: "Invalid token or passkey verification failed",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
    401: {
      description: "Invalid or expired token",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});
