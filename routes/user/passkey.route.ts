/**
 * @file routes/user/passkey.route.ts
 * @description Passkey management routes for authenticated users
 */

import { createRoute, z } from "@deps";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";
import { USERNAME_MAX_LENGTH, USERNAME_MIN_LENGTH, USERNAME_REGEX } from "@utils/auth/index.ts";

const ErrorResponseSchema = ZodHttpExceptionSchema;

/**
 * Account login identifier (not the per-credential display name). Must match
 * the canonical username rules: letters, numbers, underscores and hyphens
 * only — no `@`, spaces or other punctuation.
 */
const UsernameSchema = z.string()
  .min(USERNAME_MIN_LENGTH, withKey("validation.username-min-length", "Username must be at least 3 characters"))
  .max(USERNAME_MAX_LENGTH, withKey("validation.username-max-length", "Username must be at most 50 characters"))
  .regex(
    USERNAME_REGEX,
    withKey("validation.username-format", "Username may only contain letters, numbers, underscores, and hyphens"),
  )
  .openapi({ description: "Account login username (set only when adding your first passkey)", example: "adminuser" });

const PasskeyListItemSchema = z.object({
  id: z.string(),
  displayName: z.string().nullable(),
  createdAt: z.number(),
  backedUp: z.boolean(),
  transports: z.array(z.string()).nullable(),
  hasPrf: z.boolean().optional(),
});

const PasskeyListResponseSchema = z.object({
  data: z.array(PasskeyListItemSchema),
  passkeysRequirePrfSetup: z.boolean().optional(),
});

const PasskeyBeginResponseSchema = z.object({
  attemptId: z.string(),
  creationOptions: z.record(z.string(), z.unknown()),
  requiresReauth: z.boolean(),
  reauthType: z.enum(["password", "passkey", "password_or_passkey"]).optional(),
  requireUserVerification: z.boolean().optional(),
  message: z.string().optional(),
});

const PasskeyVerifyRequestSchema = z.object({
  attemptId: z.string().min(1, withKey("passkey.attempt-id-required", "Attempt ID is required")),
  credential: z.record(z.string(), z.unknown()),
  displayName: z.string().max(100).optional(),
  username: UsernameSchema.optional(),
  prfOutput: z.object({
    first: z.string().optional(),
  }).optional(),
  reauthToken: z.string().optional(),
});

const PasskeyVerifyResponseSchema = z.object({
  success: z.literal(true),
  credentialId: z.string(),
  prfSetupRequired: z.boolean().optional(),
  prfSetup: z.object({
    attemptId: z.string(),
    requestOptions: z.record(z.string(), z.unknown()),
    prfEvaluationRequest: z.object({
      salt: z.string().optional(),
      saltsByCredential: z.record(z.string(), z.string()).optional(),
    }).optional(),
    reauthToken: z.string(),
    reauthTokenExpiresAt: z.number(),
  }).optional(),
});

const ReauthPasswordRequestSchema = z.object({
  password: z.string().min(1, withKey("passkey.password-required", "Password is required")),
  purpose: z.enum(["passkey_add", "passkey_delete"]),
});

const ReauthPasskeyBeginRequestSchema = z.object({
  purpose: z.enum(["passkey_add", "passkey_delete", "password_set"]),
});

const ReauthPasskeyBeginResponseSchema = z.object({
  attemptId: z.string(),
  requestOptions: z.record(z.string(), z.unknown()),
  prfEvaluationRequest: z.object({
    salt: z.string().optional(),
    saltsByCredential: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

const ReauthPasskeyVerifyRequestSchema = z.object({
  attemptId: z.string().min(1, withKey("validation.attempt-id-required", "Attempt ID is required")),
  credential: z.record(z.string(), z.unknown()),
  prfOutput: z.object({
    first: z.string().optional(),
  }).optional(),
  purpose: z.enum(["passkey_add", "passkey_delete", "password_set"]),
});

const ReauthTokenResponseSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});

const PasskeyPrfSetupBeginRequestSchema = z.object({
  credentialId: z.string().min(1, withKey("validation.credential-id-required", "Credential ID is required")),
});

const PasskeyPrfSetupBeginResponseSchema = z.object({
  attemptId: z.string(),
  requestOptions: z.record(z.string(), z.unknown()),
  prfEvaluationRequest: z.object({
    salt: z.string().optional(),
    saltsByCredential: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

const PasskeyPrfSetupVerifyRequestSchema = z.object({
  attemptId: z.string().min(1, withKey("validation.attempt-id-required", "Attempt ID is required")),
  credential: z.record(z.string(), z.unknown()),
  prfOutput: z.object({
    first: z.string().optional(),
  }).optional(),
  reauthToken: z.string().min(1, withKey("validation.reauth-token-required", "Re-authentication token is required")),
});

const PasskeyPrfSetupVerifyResponseSchema = z.object({
  success: z.literal(true),
  credentialId: z.string(),
});

const DeletePasskeyParamsSchema = z.object({
  id: z.string(),
});

const DeletePasskeyRequestSchema = z.object({
  reauthToken: z.string(),
});

const DeletePasskeyResponseSchema = z.object({
  success: z.literal(true),
});

export const listPasskeysRoute = createRoute({
  method: "get",
  path: "/passkey",
  summary: "List passkeys",
  operationId: "userPasskeyList",
  description: "List the calling user's registered passkeys.\n\n" +
    "**Behavior:** Returns each passkey's id, display name, creation timestamp, backup flag, transports, and PRF status, plus a `passkeysRequirePrfSetup` flag indicating whether any passkey lacks PRF (needed for enhanced encryption).\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Credential secrets are never returned.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "List of passkeys",
      content: { "application/json": { schema: PasskeyListResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const addPasskeyBeginRoute = createRoute({
  method: "post",
  path: "/passkey/begin",
  summary: "Begin adding passkey",
  operationId: "userPasskeyBeginEnrollment",
  description: "Start the WebAuthn registration flow to add a new passkey.\n\n" +
    "**Behavior:** Generates and persists a `creationOptions` challenge (plus an `attemptId`) for the caller's origin. The optional `username` is only accepted when adding the user's first passkey. May return a re-auth requirement depending on account state.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Send the returned `creationOptions` to the authenticator, then complete with `POST /user/passkey/verify`.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            displayName: z.string()
              .min(1, withKey("validation.display-name-required", "Display name must be at least 1 character"))
              .max(100, withKey("validation.display-name-max-length", "Display name must be at most 100 characters"))
              .optional(),
            username: UsernameSchema.optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: "Passkey creation options",
      content: { "application/json": { schema: PasskeyBeginResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const addPasskeyVerifyRoute = createRoute({
  method: "post",
  path: "/passkey/verify",
  summary: "Verify and store passkey",
  operationId: "userPasskeyCompleteEnrollment",
  description: "Complete the WebAuthn registration flow and store the new passkey.\n\n" +
    "**Behavior:** Verifies the authenticator's signed `credential` against the challenge bound to `attemptId`, persists the credential, and (when applicable) kicks off PRF setup. Requires the caller's access token (cookie or `Authorization: Bearer`).\n" +
    "**Auth:** Cookie session — access token required to bind the new credential to the active session.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** May return a `prfSetup` payload if PRF derivation is required for enhanced encryption.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: { "application/json": { schema: PasskeyVerifyRequestSchema } },
    },
  },
  responses: {
    200: {
      description: "Passkey stored",
      content: { "application/json": { schema: PasskeyVerifyResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const reauthPasswordRoute = createRoute({
  method: "post",
  path: "/passkey/reauth/password",
  summary: "Re-authenticate with password",
  operationId: "userPasskeyReauthPassword",
  description: "Re-authenticate the current session with the account password to obtain a step-up re-auth token.\n\n" +
    "**Behavior:** Verifies the supplied `password` against the current session/user, then issues a short-lived `reauthToken` bound to the given `purpose` (`passkey_add` or `passkey_delete`). Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires knowledge of the current password.\n" +
    "**Notes:** The issued token is single-use and purpose-scoped; IP and user-agent are logged.",
  tags: [OpenAPITags.users],
  request: {
    body: { content: { "application/json": { schema: ReauthPasswordRequestSchema } } },
  },
  responses: {
    200: {
      description: "Re-authentication token issued",
      content: { "application/json": { schema: ReauthTokenResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const reauthPasskeyBeginRoute = createRoute({
  method: "post",
  path: "/passkey/reauth/begin",
  summary: "Begin passkey re-authentication",
  operationId: "userPasskeyReauthBegin",
  description: "Start a WebAuthn re-authentication (assertion) flow for step-up auth.\n\n" +
    "**Behavior:** Returns authentication `requestOptions` (with optional PRF evaluation request) bound to the given `purpose` (`passkey_add`, `passkey_delete`, or `password_set`). Send the result to `POST /user/passkey/reauth/verify`.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** IP and user-agent are recorded for the re-auth attempt.",
  tags: [OpenAPITags.users],
  request: {
    body: { content: { "application/json": { schema: ReauthPasskeyBeginRequestSchema } } },
  },
  responses: {
    200: {
      description: "Passkey re-authentication options",
      content: { "application/json": { schema: ReauthPasskeyBeginResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const reauthPasskeyVerifyRoute = createRoute({
  method: "post",
  path: "/passkey/reauth/verify",
  summary: "Verify passkey re-authentication",
  operationId: "userPasskeyReauthVerify",
  description: "Complete the WebAuthn re-authentication flow and issue a step-up re-auth token.\n\n" +
    "**Behavior:** Verifies the signed `credential` against the challenge bound to `attemptId`, then returns a short-lived `token` tied to the request `purpose`. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires possession of a registered passkey.\n" +
    "**Notes:** The issued token is single-use and purpose-scoped.",
  tags: [OpenAPITags.users],
  request: {
    body: { content: { "application/json": { schema: ReauthPasskeyVerifyRequestSchema } } },
  },
  responses: {
    200: {
      description: "Re-authentication token issued",
      content: { "application/json": { schema: ReauthTokenResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const deletePasskeyRoute = createRoute({
  method: "delete",
  path: "/passkey/{id}",
  summary: "Delete passkey",
  operationId: "userPasskeyDelete",
  description: "Delete a registered passkey by credential id.\n\n" +
    "**Behavior:** Consumes a valid step-up `reauthToken` (obtained via `POST /user/passkey/reauth/password` or `/reauth/verify` with `purpose: passkey_delete`) and removes the credential identified by the path `id`. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires a valid purpose-scoped re-auth token.\n" +
    "**Notes:** Deleting the last passkey may lock out passkey-based login and impact enhanced-encryption unlock. IP is logged.",
  tags: [OpenAPITags.users],
  request: {
    params: DeletePasskeyParamsSchema,
    body: { content: { "application/json": { schema: DeletePasskeyRequestSchema } } },
  },
  responses: {
    200: {
      description: "Passkey deleted",
      content: { "application/json": { schema: DeletePasskeyResponseSchema } },
    },
    400: {
      description: "Bad request",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
  },
});

export const passkeyPrfSetupBeginRoute = createRoute({
  method: "post",
  path: "/passkey/prf-setup/begin",
  summary: "Begin PRF setup for a passkey",
  operationId: "userPasskeyPrfSetupBegin",
  description: "Start a WebAuthn flow to configure the PRF extension on an existing passkey (for enhanced-encryption key derivation).\n\n" +
    "**Behavior:** Returns authentication `requestOptions` (with PRF evaluation request) bound to the passkey identified by the body `credentialId`. Complete with `POST /user/passkey/prf-setup/verify`.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Origin is derived from the request host.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": {
          schema: PasskeyPrfSetupBeginRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "PRF setup authentication options",
      content: { "application/json": { schema: PasskeyPrfSetupBeginResponseSchema } },
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

export const passkeyPrfSetupVerifyRoute = createRoute({
  method: "post",
  path: "/passkey/prf-setup/verify",
  summary: "Verify PRF setup for a passkey",
  operationId: "userPasskeyPrfSetupVerify",
  description: "Complete PRF setup by verifying the passkey assertion and persisting the PRF output.\n\n" +
    "**Behavior:** Verifies the signed `credential` against the challenge bound to `attemptId`, extracts the PRF output (from `prfOutput.first` or `clientExtensionResults`), consumes the supplied `reauthToken`, and stores the derived PRF material for the credential. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires a valid re-auth token.\n" +
    "**Notes:** After this, the passkey can derive the enhanced-encryption key. IP is logged.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": {
          schema: PasskeyPrfSetupVerifyRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: "PRF setup verified",
      content: { "application/json": { schema: PasskeyPrfSetupVerifyResponseSchema } },
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
