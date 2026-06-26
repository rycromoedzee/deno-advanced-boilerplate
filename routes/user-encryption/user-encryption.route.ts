/**
 * @file routes/user-encryption/user-encryption.route.ts
 * @description Route definitions for user encryption management
 */

import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import {
  ErrorSchema,
  httpResponseBadRequest,
  httpResponseInternalServerError,
  httpResponseUnauthorized,
} from "@utils/openapi/open-api-shared.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// =====================================
// Enhanced Encryption Opt-In Route
// =====================================
export const enhancedEncryptionOptInRoute = createRoute({
  method: "post",
  path: "/encryption/opt-in",
  summary: "Opt-in to enhanced encryption",
  operationId: "userEncryptionOptIn",
  description: "Opt-in to OWASP-compliant enhanced encryption with recovery phrase.\n\n" +
    "**Behavior:** Generates and stores a recovery phrase, enables user-controlled encryption, migrates data/wrapping keys to the user master key, and caches the password-derived key on the current access (and refresh) token so the session can decrypt immediately. Returns the plaintext recovery phrase once. Rejects if already opted in.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires the current account password.\n" +
    "**Notes:** Passkey-only users must use `POST /user/encryption/opt-in/passkey` instead. The recovery phrase is shown only this once.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            password: z.string().min(1, withKey("encryption.password-required-input", "Password is required")),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            recoveryPhrase: z.string(),
            message: z.string(),
          }),
        },
      },
      description: "Enhanced encryption setup successful",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Enhanced Encryption Opt-In for Passkey Users Route
// =====================================
export const enhancedEncryptionOptInPasskeyRoute = createRoute({
  method: "post",
  path: "/encryption/opt-in/passkey",
  summary: "Opt-in to enhanced encryption (passkey users)",
  operationId: "userEncryptionOptInPasskey",
  description: "Opt-in to enhanced encryption for passkey-only users using a PRF-derived key.\n\n" +
    "**Behavior:** Enables user-controlled encryption using the passkey's PRF-derived key (pre-cached via `POST /user/encryption/prf-setup/*`), generates and stores a recovery phrase, migrates keys, and re-caches the PRF key on the current session. Returns the plaintext recovery phrase once. Rejects if already opted in, or if the user has a password (those users must use the password route).\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires a PRF-capable passkey with cached PRF material.\n" +
    "**Notes:** The recovery phrase is shown only this once.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            recoveryPhrase: z.string(),
            message: z.string(),
          }),
        },
      },
      description: "Enhanced encryption setup successful",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Check Encryption Status Route
// =====================================
export const checkEncryptionStatusRoute = createRoute({
  method: "get",
  path: "/encryption/status",
  summary: "Check encryption status",
  operationId: "userEncryptionGetStatus",
  description: "Check if user has enhanced encryption enabled.\n\n" +
    "**Behavior:** Returns whether enhanced encryption is enabled for the calling user (and the active key version, when applicable). Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            isEnhancedEncryptionEnabled: z.boolean(),
            encryptionKeyVersion: z.number().optional(),
          }),
        },
      },
      description: "Encryption status retrieved successfully",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Verify Recovery Phrase Route
// =====================================
export const verifyRecoveryPhraseRoute = createRoute({
  method: "post",
  path: "/encryption/verify-recovery-phrase",
  summary: "Verify recovery phrase",
  operationId: "userEncryptionVerifyRecoveryPhrase",
  description: "Verify that the provided recovery phrase matches the stored phrase.\n\n" +
    "**Behavior:** Compares the submitted phrase against the stored phrase and returns an `isValid` boolean plus a message. Does not mutate state.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Used to confirm the user has saved their phrase or to gate key-rotation/recovery flows.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            recoveryPhrase: z.string().min(1, withKey("encryption.recovery-phrase-required", "Recovery phrase is required")),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            isValid: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: "Recovery phrase verification result",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Disable Enhanced Encryption Route
// =====================================
export const disableEnhancedEncryptionRoute = createRoute({
  method: "post",
  path: "/encryption/disable",
  summary: "Disable enhanced encryption",
  operationId: "userEncryptionDisable",
  description:
    "Disable enhanced encryption for the current user. This will clear all encrypted master keys. User data will remain but will no longer be accessible with user-key encryption.\n\n" +
    "**Behavior:** Retrieves the master key via the current session token, then reverts data keys to app encryption (converting shared-access keys as needed) and clears the user's encrypted master keys. Reports counts of migrated and converted keys. Rejects if not opted in.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Largely irreversible — re-enabling requires a fresh opt-in.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: "Enhanced encryption disabled successfully",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Check Can Enable Encryption Route
// =====================================
export const canEnableEncryptionRoute = createRoute({
  method: "get",
  path: "/encryption/can-enable",
  summary: "Check if user can enable encryption",
  operationId: "userEncryptionCanEnable",
  description:
    "Check if the current user can enable enhanced encryption. Returns whether user has password, passkeys, or PRF available. If user has passkeys but no PRF, they need to set up PRF first.\n\n" +
    "**Behavior:** Returns capability flags (`hasPassword`, `hasPasskeys`, `hasPRF`, `needsPRFSetup`), an overall `canEnable` boolean, and the `recommendedMethod` (`password`, `passkey`, or `none`). Read-only, no side effects.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Drives the client UI for which opt-in path to present.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            canEnable: z.boolean(),
            hasPassword: z.boolean(),
            hasPasskeys: z.boolean(),
            hasPRF: z.boolean(),
            needsPRFSetup: z.boolean(),
            recommendedMethod: z.enum(["password", "passkey", "none"]),
          }),
        },
      },
      description: "Encryption capability check result",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Initiate PRF Setup Route
// =====================================
export const initiatePRFSetupRoute = createRoute({
  method: "post",
  path: "/encryption/prf-setup/begin",
  summary: "Initiate PRF setup for passkey users",
  operationId: "userEncryptionPrfSetupBegin",
  description:
    "Initiates a PRF setup flow for passkey-only users who want to enable encryption. Returns authentication options with PRF extension enabled. The user must authenticate with their passkey, then call `/user/encryption/prf-setup/verify` with the PRF output.\n\n" +
    "**Behavior:** Returns a WebAuthn assertion challenge (with PRF evaluation request) so the caller can derive and cache a PRF key.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Prerequisite for `POST /user/encryption/opt-in/passkey` on passkey-only accounts.",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            attemptId: z.string(),
            requestOptions: z.any(),
            prfEvaluationRequest: z.object({
              salt: z.string().optional(),
              saltsByCredential: z.record(z.string(), z.string()).optional(),
            }).optional(),
          }),
        },
      },
      description: "PRF setup initiated successfully",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Verify PRF Setup Route
// =====================================
export const verifyPRFSetupRoute = createRoute({
  method: "post",
  path: "/encryption/prf-setup/verify",
  summary: "Verify PRF setup and cache key",
  operationId: "userEncryptionPrfSetupVerify",
  description:
    "Completes PRF setup by verifying the passkey authentication and caching the PRF-derived key. After this, the user can call `/user/encryption/opt-in/passkey` to enable encryption.\n\n" +
    "**Behavior:** Verifies the WebAuthn `credential`, extracts the credential id and PRF output, and caches the PRF-derived key for the calling user. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** On success the caller is ready to opt in via the passkey route.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            attemptId: z.string().min(1, withKey("encryption.prf-attempt-id-required", "Attempt ID is required")),
            credential: z.any(),
            prfOutput: z.object({
              first: z.string().min(1, withKey("encryption.invalid-prf-output", "PRF output is required")),
            }),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: "PRF setup completed successfully",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Rotate Master Key Route
// =====================================
export const rotateMasterKeyRoute = createRoute({
  method: "post",
  path: "/encryption/rotate-master-key",
  summary: "Rotate master key",
  operationId: "userEncryptionRotateMasterKey",
  description:
    "Rotates the user's master encryption key. All data keys and wrapping keys are re-encrypted. Requires enhanced encryption to be enabled and a valid recovery phrase.\n\n" +
    "**Behavior:** Verifies the supplied `recoveryPhrase`, generates a new master key, re-encrypts all data/wrapping keys, and re-wraps passkey keys where possible. Passkey wraps that cannot be completed synchronously are reported as `pendingPasskeyRewraps` and finalized on the user's next login. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires a valid recovery phrase.\n" +
    "**Notes:** Any pending passkey rewraps must complete before those passkeys can unlock the new key.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            recoveryPhrase: z.string().trim().min(1, withKey("encryption.recovery-phrase-required", "Recovery phrase is required")),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            pendingPasskeyRewraps: z.number(),
            message: z.string(),
          }),
        },
      },
      description: "Master key rotated successfully",
    },
    ...httpResponseBadRequest,
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});

// =====================================
// Rewrap Stale Passkey Route
// =====================================
export const rewrapStalePasskeyRoute = createRoute({
  method: "post",
  path: "/encryption/rewrap-stale-passkey",
  summary: "Rewrap stale passkey with recovery phrase",
  operationId: "userEncryptionRewrapStalePasskey",
  description:
    "Re-wraps the current passkey's encryption with a valid recovery phrase. Used when a passkey has a stale encryption wrap (version mismatch) and the rotation escrow has expired.\n\n" +
    "**Behavior:** Verifies the supplied `recoveryPhrase` and re-wraps the current passkey's key material to the active master key, recovering access without a full re-login. Requires the caller's access token.\n" +
    "**Auth:** Cookie session — access token required.\n" +
    "**Permissions:** None beyond auth — scoped to the calling user. Requires a valid recovery phrase.\n" +
    "**Notes:** Returns 409 when a stale passkey is detected and recovery is required.",
  request: {
    body: {
      content: {
        "application/json": {
          schema: z.object({
            recoveryPhrase: z.string().trim().min(1, withKey("encryption.recovery-phrase-required", "Recovery phrase is required")),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: z.object({
            success: z.boolean(),
            message: z.string(),
          }),
        },
      },
      description: "Passkey re-wrapped successfully",
    },
    ...httpResponseBadRequest,
    409: {
      content: {
        "application/json": {
          schema: ErrorSchema,
        },
      },
      description: "Conflict - stale passkey requires recovery phrase",
    },
    ...httpResponseUnauthorized,
    ...httpResponseInternalServerError,
  },
  tags: [OpenAPITags.userEncryption],
});
