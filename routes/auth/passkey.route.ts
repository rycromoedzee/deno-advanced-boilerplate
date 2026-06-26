/**
 * @file routes/auth/passkey.route.ts
 * @description Route definitions for passkey-based login
 *
 * Uses types from @simplewebauthn/types for TypeScript type safety.
 * Zod schemas are provided for OpenAPI validation and documentation.
 */

import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";
import type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON } from "@deps";

// Re-export types for use in handlers and frontend
export type { AuthenticationResponseJSON, PublicKeyCredentialRequestOptionsJSON };

// ============================================
// Zod Schemas for OpenAPI Validation
// These schemas validate requests/responses and generate OpenAPI docs
// ============================================

/**
 * Schema for AuthenticationResponseJSON from @simplewebauthn/types
 * @see {@link https://simplewebauthn.dev/docs/packages/types}
 */
const AuthenticationResponseJSONSchema = z.object({
  id: z.string(),
  rawId: z.string(),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string(),
    authenticatorData: z.string(),
    signature: z.string(),
    userHandle: z.string().optional(),
  }),
  authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  clientExtensionResults: z.record(z.string(), z.unknown()),
});

/**
 * Schema for PublicKeyCredentialRequestOptionsJSON from @simplewebauthn/types
 * @see {@link https://simplewebauthn.dev/docs/packages/types}
 */
const PublicKeyCredentialRequestOptionsJSONSchema = z.object({
  challenge: z.string(),
  timeout: z.number().optional(),
  rpId: z.string().optional(),
  allowCredentials: z.array(z.object({
    id: z.string(),
    type: z.literal("public-key"),
    transports: z.array(z.enum([
      "ble",
      "cable",
      "hybrid",
      "internal",
      "nfc",
      "smart-card",
      "usb",
    ])).optional(),
  })).optional(),
  userVerification: z.enum(["required", "preferred", "discouraged"]).optional(),
  extensions: z.record(z.string(), z.unknown()).optional(),
});

// ============================================
// Passkey Login Request/Response Schemas
// ============================================

/** Passkey login begin request */
const PasskeyLoginBeginRequestSchema = z.object({
  username: z.string().min(1, withKey("validation.username-required", "Username is required")).openapi({
    description: "User's username",
    example: "adminuser",
  }),
});

/** Passkey login begin response */
const PasskeyLoginBeginResponseSchema = z.object({
  isAuthCompleted: z.literal(false),
  nextStep: z.literal("passkey-verify"),
  attemptId: z.string().openapi({
    description: "Unique attempt ID to be used in verify step",
  }),
  requestOptions: PublicKeyCredentialRequestOptionsJSONSchema.openapi({
    description: "WebAuthn PublicKeyCredentialRequestOptionsJSON from @simplewebauthn/types",
  }),
  prfEvaluationRequest: z.object({
    salt: z.string().optional(),
    saltsByCredential: z.record(z.string(), z.string()).optional(),
  }).optional().openapi({
    description: "PRF evaluation request for encryption key derivation",
  }),
});

/** Passkey login verify request */
const PasskeyLoginVerifyRequestSchema = z.object({
  attemptId: z.string().min(1, withKey("validation.attempt-id-required", "Attempt ID is required")).openapi({
    description: "Attempt ID from passkey-begin step",
  }),
  credential: AuthenticationResponseJSONSchema.openapi({
    description: "WebAuthn AuthenticationResponseJSON from @simplewebauthn/types",
  }),
  prfOutput: z.object({
    first: z.string().optional(),
  }).optional().openapi({
    description: "PRF extension output for encryption key derivation",
  }),
});

/** Passkey login success response */
const PasskeyLoginSuccessSchema = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string(),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
});

/** Error response */
const ErrorResponseSchema = ZodHttpExceptionSchema;

/**
 * POST /api/auth/passkey/begin
 * Initiates passkey login by looking up user credentials
 */
export const passkeyLoginBeginRoute = createRoute({
  method: "post",
  path: "/passkey/begin",
  operationId: "authPasskeyOptions",
  summary: "Begin passkey login",
  description: "Looks up user's passkey credentials by username and returns WebAuthn authentication options. " +
    "The requestOptions field matches PublicKeyCredentialRequestOptionsJSON from @simplewebauthn/types.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": { schema: PasskeyLoginBeginRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Passkey login options generated",
      content: {
        "application/json": { schema: PasskeyLoginBeginResponseSchema },
      },
    },
    401: {
      description: "Invalid credentials or no passkeys registered",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});

/**
 * POST /api/auth/passkey/verify
 * Verifies passkey authentication and creates session
 */
export const passkeyLoginVerifyRoute = createRoute({
  method: "post",
  path: "/passkey/verify",
  operationId: "authPasskeyAuthenticate",
  summary: "Verify passkey login",
  description: "Verifies WebAuthn authentication response and creates user session. " +
    "The credential field matches AuthenticationResponseJSON from @simplewebauthn/types.\n\n**Behavior:** verifies the assertion against the `attemptId` from the begin step, derives the encryption key from PRF output when present, and mints a session (sets access/refresh/session-key cookies).\n**Auth:** public (gated by the single-use `attemptId`).",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": { schema: PasskeyLoginVerifyRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Passkey login successful",
      headers: {
        "Set-Cookie": {
          description: "Session and refresh tokens",
          schema: { type: "array", items: { type: "string" } },
        },
      },
      content: {
        "application/json": { schema: PasskeyLoginSuccessSchema },
      },
    },
    400: {
      description: "Invalid passkey verification",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
    401: {
      description: "Invalid or expired session",
      content: {
        "application/json": { schema: ErrorResponseSchema },
      },
    },
  },
});
