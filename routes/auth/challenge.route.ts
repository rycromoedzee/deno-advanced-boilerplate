/**
 * @file routes/auth/challenge.route.ts
 * @description Challenge route definition
 */
import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { SCHEMA_VALIDATION_PASSWORD } from "@models/auth/index.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

export const AuthChallengePayloadSchema = z.object({
  password: SCHEMA_VALIDATION_PASSWORD
    .optional(),
  twoFactorCode: z.string().min(6, withKey("validation.2fa-code-min-length", "2FA code must be at least 6 characters")).openapi({
    description: "User's two-factor code",
    example: "123456",
  }).optional(),
});

export const authChallengeRoute = createRoute({
  method: "post",
  path: "/challenge",
  operationId: "authChallenge",
  tags: [OpenAPITags.auth],
  summary: "Re-verify identity on a suspicious session",
  description:
    "Re-verifies a user's identity when a step-up challenge is triggered (e.g. the system notices something suspicious about the session).\n\n**Behavior:** reads the existing `access_token` cookie and re-verifies its JWT, then re-checks the password (and 2FA code when 2FA is enabled). On success it mints a fresh session — new access, refresh, and session-key cookies — and sets a 24-hour challenge-grace cache keyed by user + IP so the same IP is not re-challenged immediately.\n**Auth:** step-in-flow (consumes the existing `access_token` cookie; no validated-session middleware).\n**Permissions:** none beyond auth.\n**Notes:** runs under timing protection; 2FA-enabled accounts must supply both `password` and `twoFactorCode`.",
  security: [],
  request: {
    body: {
      content: {
        "application/json": {
          schema: AuthChallengePayloadSchema,
        },
      },
      description: "Password and (when 2FA is enabled) the current 2FA code",
    },
  },
  responses: {
    200: {
      description: "Response",
      headers: {
        "Set-Cookie": {
          description: "Session and refresh tokens will be set",
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
    },
    401: {
      description: "Unauthorized",
      content: {
        "application/json": {
          schema: ZodHttpExceptionSchema,
        },
      },
    },
  },
});
