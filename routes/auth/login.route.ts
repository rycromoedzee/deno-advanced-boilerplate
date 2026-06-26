/**
 * @file routes/auth/login.route.ts
 * @description Login route definition
 */
import { createRoute, z } from "@deps";
import { SCHEMA_VALIDATION_PASSWORD } from "@models/auth/index.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const LoginRequestSchema = z.object({
  email: z.string().email(withKey("validation.email-invalid", "Invalid email address")).openapi({
    example: "user@example.com",
    description: "User's email address for authentication",
  }),
  password: SCHEMA_VALIDATION_PASSWORD,
});

// Direct login response schema (Requirements 1.1, 2.1)
const DirectLoginResponseSchema = z.object({
  message: z.string().openapi({
    example: "Login successful",
    description: "Success message for direct authentication",
  }),
  isAuthCompleted: z.boolean().openapi({
    example: true,
    description: "Flag indicating authentication is complete",
  }),
  nextStep: z.literal("direct-login").openapi({
    example: "direct-login",
    description: "Next step for authentication - direct login",
  }),
  userId: z.string().optional().openapi({
    example: "user_123",
    description: "Unique identifier of the authenticated user (only present on successful login)",
  }),
  environmentId: z.string().optional().openapi({
    example: "env_456",
    description: "Unique identifier of the user's environment (only present on successful login)",
  }),
  displayName: z.string().optional().openapi({
    example: "John Doe",
    description: "Display name of the authenticated user (only present on successful login)",
  }),
});

// 2FA challenge response schema (Requirements 1.2, 2.2, 4.1, 4.2)
const TwoFAResponseSchema = z.object({
  message: z.string().openapi({
    example: "2FA verification required",
    description: "Message indicating 2FA verification is required",
  }),
  redirectTo: z.string().openapi({
    example: "/api/auth/two-factor",
    description: "URL endpoint for 2FA verification",
  }),
  isAuthCompleted: z.boolean().openapi({
    example: false,
    description: "Flag indicating authentication is complete",
  }),
  nextStep: z.literal("two-factor").openapi({
    example: "two-factor",
    description: "Next step for authentication - two-factor verification",
  }),
  postTwoFactorNextStep: z.enum(["direct-login", "multi-user"]).openapi({
    example: "direct-login",
    description: "Next step after successful two-factor verification",
  }),
});

// Multi-user selection response schema (Requirements 3.1, 3.2)
const MultiUserResponseSchema = z.object({
  message: z.string().openapi({
    example: "Multiple environments found",
    description: "Message indicating multiple user environments are available",
  }),
  redirectTo: z.string().openapi({
    example: "/api/auth/multi-user",
    description: "URL endpoint for multi-user selection",
  }),
  isAuthCompleted: z.boolean().openapi({
    example: false,
    description: "Flag indicating authentication is complete",
  }),
  nextStep: z.literal("multi-user").openapi({
    example: "multi-user",
    description: "Next step for authentication - multi-user selection",
  }),
  environments: z.array(z.object({
    userId: z.string().openapi({
      example: "user_123",
      description: "Unique identifier of the user in this environment",
    }),
    environment: z.string().openapi({
      example: "Demo 123",
      description: "Name of the environment",
    }),
    displayName: z.string().openapi({
      example: "John Doe (Production)",
      description: "Display name for the user in this environment",
    }),
  })).openapi({
    example: [
      {
        userId: "user_123",
        environment: "Production",
        displayName: "John Doe (Production)",
      },
      {
        userId: "user_456",
        environment: "Staging",
        displayName: "John Doe (Staging)",
      },
    ],
    description: "List of available environments for user selection",
  }),
  requiresSelection: z.boolean().optional().openapi({
    example: true,
    description: "Flag indicating user environment selection is required",
  }),
});

// Generic error response schema for consistent error handling
const ErrorResponseSchema = z.object({
  message: z.string().openapi({
    example: "Invalid credentials",
    description: "Generic error message for security",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.creds-invalid",
    description: "Localization key for the error message",
  }),
});

// Rate limiting error response schema
const RateLimitErrorSchema = z.object({
  message: z.string().openapi({
    example: "Account temporarily blocked. Please try again later.",
    description: "Rate limiting error message",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.temporarily-blocked",
    description: "Localization key for rate limiting error",
  }),
});

export const authLoginRoute = createRoute({
  method: "post",
  path: "/login",
  operationId: "authLogin",
  summary: "Authenticate user with multi-user and 2FA support",
  description:
    "Handles authentication for single/multi-user scenarios with 2FA support. Returns different responses based on user count, subdomain presence, and 2FA status.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: LoginRequestSchema,
        },
      },
      description: "User credentials for authentication",
    },
  },
  responses: {
    200: {
      description: "Authentication successful - direct login",
      headers: {
        "Set-Cookie": {
          description: "Session and refresh tokens (set only for direct login scenarios)",
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
          schema: DirectLoginResponseSchema.openapi({
            description: "Direct login success (single user, no 2FA)",
          }),
        },
      },
    },
    202: {
      description: "Authentication in progress - 2FA challenge or multi-user selection required",
      content: {
        "application/json": {
          schema: z.discriminatedUnion("nextStep", [
            TwoFAResponseSchema,
            MultiUserResponseSchema,
          ]).openapi({
            description: "Two-factor challenge or multi-user environment selection required",
          }),
        },
      },
    },
    401: {
      description: "Authentication failed",
      content: {
        "application/json": {
          schema: ErrorResponseSchema.openapi({
            description: "Authentication failure with generic error message",
          }),
        },
      },
    },
    429: {
      description: "Rate limited - account temporarily blocked due to too many failed attempts",
      content: {
        "application/json": {
          schema: RateLimitErrorSchema,
        },
      },
    },
  },
});
