/**
 * @file routes/auth/logout.route.ts
 * @description Logout route definition
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";

// Error response schema
const ErrorResponseSchema = z.object({
  message: z.string().openapi({
    example: "Invalid session",
    description: "Generic error message for security",
  }),
  messageKey: z.string().optional().openapi({
    example: "auth.unauthorized",
    description: "Localization key for the error message",
  }),
});

export const authLogoutRoute = createRoute({
  method: "post",
  path: "/logout",
  operationId: "authLogout",
  summary: "Log out and invalidate session",
  description:
    "Logs out the user by invalidating the current access token and refresh token. Clears the authentication cookies.\n\n**Behavior:** reads the existing access/refresh cookies, revokes the session server-side, and clears the `access_token`, `refresh_token`, and session-key cookies (Max-Age=0). If no tokens are present it still clears cookies and returns 204.\n**Auth:** public (operates on the presented cookies; no validated session required).\n**Permissions:** none beyond auth.",
  security: [],
  tags: [OpenAPITags.auth],
  responses: {
    204: {
      description: "User logged out successfully",
      headers: {
        "Set-Cookie": {
          description: "Cleared authentication cookies (access_token and refresh_token)",
          schema: {
            type: "array",
            items: {
              type: "string",
            },
            example: [
              "access_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
              "refresh_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0",
            ],
          },
        },
      },
    },
    401: {
      description: "No active session found",
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
