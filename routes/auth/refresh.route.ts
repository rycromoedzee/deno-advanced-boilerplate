/**
 * @file routes/auth/refresh.route.ts
 * @description Refresh route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

// Refresh response schema
const RefreshResponseSchema = z.object({
  message: z.string().openapi({
    example: "Token refreshed successfully",
    description: "Success message for token refresh",
  }),
  expiresAt: z.number().openapi({
    example: 1699123456789,
    description: "Unix timestamp (milliseconds) when the access token expires",
  }),
  refreshExpiresAt: z.number().openapi({
    example: 1701721456789,
    description: "Unix timestamp (milliseconds) when the refresh token expires",
  }),
});

// Error response schema
const ErrorResponseSchema = z.object({
  message: z.string().openapi({
    example: "Invalid refresh token",
    description: "Generic error message for security",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.unauthorized",
    description: "Localization key for the error message",
  }),
});

export const authRefreshRoute = createRoute({
  method: "post",
  path: "/refresh",
  operationId: "authRefresh",
  summary: "Refresh session via refresh-token cookie",
  description:
    "Refreshes the access token using a valid refresh token from an HTTP-only signed cookie. Returns new access and refresh tokens.\n\n**Behavior:** rotates the session — issues fresh access, refresh, and session-key cookies and returns the new expiry timestamps. The password-derived key is carried across from the old refresh token via the old session key.\n**Auth:** public (reads the signed `refresh_token` cookie; no validated access-token session required).\n**Permissions:** none beyond auth.",
  security: [],
  tags: [OpenAPITags.auth],
  responses: {
    200: {
      description: "Token refreshed successfully",
      headers: {
        "Set-Cookie": {
          description: "New access and refresh tokens set as HTTP-only cookies",
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
          schema: RefreshResponseSchema,
        },
      },
    },
    401: {
      description: "Invalid or missing refresh token",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: "Internal server error",
      content: {
        "application/json": {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});
