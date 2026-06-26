/**
 * @file routes/auth/two-factor.route.ts
 * @description Two Factor route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const TwoFARequestSchema = z.object({
  code: z.string()
    .min(6, withKey("validation.2fa-code-min-length", "2FA code must be at least 6 characters"))
    .max(20, withKey("validation.2fa-code-max-length", "2FA code must be at most 8 characters"))
    .openapi({
      example: "123456",
      description: "6-20 digit 2FA code from authenticator app or backup code",
    }),
});

const TwoFADirectLoginResponseSchema = z.object({
  nextStep: z.literal("direct-login").openapi({
    example: "direct-login",
  }),
  isAuthCompleted: z.boolean().openapi({
    example: true,
    description: "Flag indicating authentication is complete",
  }),
  message: z.string().openapi({ example: "2FA verification successful" }),
  userId: z.string().openapi({
    example: "user_123",
    description: "Unique identifier of the authenticated user",
  }),
  environmentId: z.string().openapi({
    example: "env_456",
    description: "Unique identifier of the user's environment",
  }),
  displayName: z.string().openapi({
    example: "John Doe",
    description: "Display name of the authenticated user",
  }),
});

const TwoFAMultiUserResponseSchema = z.object({
  nextStep: z.literal("multi-user").openapi({ example: "multi-user" }),
  isAuthCompleted: z.boolean().openapi({
    example: false,
    description: "Flag indicating authentication is complete",
  }),
  message: z.string().openapi({ example: "Multiple environments found" }),
  environments: z.array(z.object({
    userId: z.string().openapi({ example: "user_123" }),
    environment: z.string().openapi({ example: "production" }),
    displayName: z.string().optional().openapi({
      example: "John Doe - Production",
    }),
  })).openapi({
    description: "Available environments for user selection",
  }),
});

const TwoFAErrorResponseSchema = z.object({
  message: z.string().openapi({ example: "Invalid credentials" }),
  messageKey: z.string().optional().openapi({
    example: "auth.creds-invalid",
  }),
});

const RateLimitErrorSchema = z.object({
  message: z.string().openapi({
    example: "Account temporarily blocked. Please try again later.",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.temporarily-blocked",
  }),
});

export const twoFactorAuthRoute = createRoute({
  method: "post",
  path: "/two-factor",
  operationId: "authTwoFactorVerify",
  summary: "Verify 2FA code",
  description:
    "Verifies 2FA code for single user, multi-user, or mixed user scenarios.\n\n**Behavior:** consumes the 2FA challenge token from the `access_token` cookie (issued by login). On success either mints the final session (200, sets access/refresh/session-key cookies) or, for multi-user accounts, returns the environment selection list (202).\n**Auth:** step-in-flow (consumes the 2FA challenge cookie; no validated-session middleware).\n**Permissions:** none beyond auth.",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: TwoFARequestSchema,
        },
      },
      description: "2FA verification request with code (challenge token from cookie)",
    },
  },
  responses: {
    200: {
      description: "2FA verification successful - session created",
      headers: {
        "Set-Cookie": {
          description: "Session tokens set when authentication is complete",
          schema: {
            type: "array",
            items: {
              type: "string",
            },
            example: [
              "access_token=abc123def456; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400",
              "refresh_token=abc123def456; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=31536000",
            ],
          },
        },
      },
      content: {
        "application/json": {
          schema: TwoFADirectLoginResponseSchema,
        },
      },
    },
    202: {
      description: "2FA verification successful - requires user selection",
      content: {
        "application/json": {
          schema: TwoFAMultiUserResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid credentials or token",
      content: {
        "application/json": {
          schema: TwoFAErrorResponseSchema,
        },
      },
    },
    429: {
      description: "Too many requests - rate limited",
      content: {
        "application/json": {
          schema: RateLimitErrorSchema,
        },
      },
    },
  },
});
