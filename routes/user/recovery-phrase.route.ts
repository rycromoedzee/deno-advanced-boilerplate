/**
 * @file routes/user/recovery-phrase.route.ts
 * @description Route definitions for user recovery phrase management
 */

import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { httpResponseInternalServerError } from "@utils/openapi/open-api-shared.ts";
import { ZodHttpExceptionSchema } from "@utils/http-exception.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

const ErrorResponseSchema = ZodHttpExceptionSchema;

// =====================================
// Schema Definitions
// =====================================

const RecoveryPhraseStatusResponseSchema = z.object({
  hasRecoveryPhrase: z.boolean().openapi({
    example: true,
    description: "Whether a recovery phrase has been set up",
  }),
  isVerified: z.boolean().openapi({
    example: true,
    description: "Whether the recovery phrase has been verified by the user",
  }),
  createdAt: z.number().optional().openapi({
    example: 1707000000,
    description: "Unix timestamp when recovery phrase was created",
  }),
  verifiedAt: z.number().optional().openapi({
    example: 1707500000,
    description: "Unix timestamp when recovery phrase was verified",
  }),
});

const CreateRecoveryPhraseResponseSchema = z.object({
  recoveryPhrase: z.string().openapi({
    example: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
    description: "12-word BIP39 recovery phrase - SAVE THIS SECURELY",
  }),
  message: z.string(),
});

const VerifyRecoveryPhraseRequestSchema = z.object({
  recoveryPhrase: z.string()
    .trim()
    .min(1, withKey("validation.recovery-phrase-required", "Recovery phrase is required"))
    .openapi({
      example: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
      description: "12-word BIP39 recovery phrase to verify",
    }),
});

const VerifyRecoveryPhraseResponseSchema = z.object({
  isValid: z.boolean().openapi({
    example: true,
    description: "Whether the recovery phrase is valid",
  }),
  message: z.string(),
});

const ResetRecoveryPhraseRequestSchema = z.object({
  currentPhrase: z.string()
    .trim()
    .min(1, withKey("validation.recovery-phrase-required", "Current recovery phrase is required"))
    .openapi({
      example: "word1 word2 word3 word4 word5 word6 word7 word8 word9 word10 word11 word12",
      description: "Current 12-word BIP39 recovery phrase",
    }),
});

const ResetRecoveryPhraseResponseSchema = z.object({
  recoveryPhrase: z.string().openapi({
    example: "new1 new2 new3 new4 new5 new6 new7 new8 new9 new10 new11 new12",
    description: "New 12-word BIP39 recovery phrase - SAVE THIS SECURELY",
  }),
  message: z.string(),
});

const DeleteRecoveryPhraseResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
});

// =====================================
// Routes
// =====================================

/**
 * Get recovery phrase status
 */
export const getRecoveryPhraseStatusRoute = createRoute({
  method: "get",
  path: "/recovery-phrase",
  summary: "Get recovery phrase status",
  operationId: "userRecoveryPhraseGetStatus",
  description: "Get the current recovery phrase status for the authenticated user. Does not reveal the actual phrase.\n\n" +
    "**Behavior:** Returns metadata only — whether a phrase exists, whether it has been verified, and the created/verified timestamps. Never returns the phrase text.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Recovery phrase status retrieved successfully",
      content: {
        "application/json": { schema: RecoveryPhraseStatusResponseSchema },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Create a new recovery phrase
 */
export const createRecoveryPhraseRoute = createRoute({
  method: "post",
  path: "/recovery-phrase",
  summary: "Create recovery phrase",
  operationId: "userRecoveryPhraseCreate",
  description:
    "Create a new recovery phrase for the user. If one already exists, this will replace it. Returns the new phrase - this is the only time it will be shown.\n\n" +
    "**Behavior:** Generates a fresh 12-word BIP39 phrase, stores it (hashed), and returns the plaintext once. Any existing phrase is overwritten.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** The plaintext phrase is never retrievable again — the client must persist it securely. Replacing an existing phrase impacts enhanced encryption recovery.",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Recovery phrase created successfully",
      content: {
        "application/json": { schema: CreateRecoveryPhraseResponseSchema },
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
    ...httpResponseInternalServerError,
  },
});

/**
 * Verify a recovery phrase
 */
export const verifyRecoveryPhraseRoute = createRoute({
  method: "post",
  path: "/recovery-phrase/verify",
  summary: "Verify recovery phrase",
  operationId: "userRecoveryPhraseVerify",
  description:
    "Verify that the provided recovery phrase matches the stored phrase. Use this to confirm user has correctly saved their phrase.\n\n" +
    "**Behavior:** Compares the submitted phrase against the stored phrase and returns an `isValid` boolean plus a human-readable message. Does not mutate state.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Tenant-scoped.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: VerifyRecoveryPhraseRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Recovery phrase verification result",
      content: {
        "application/json": { schema: VerifyRecoveryPhraseResponseSchema },
      },
    },
    400: {
      description: "Bad request - invalid input",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Reset recovery phrase (requires current phrase)
 */
export const resetRecoveryPhraseRoute = createRoute({
  method: "post",
  path: "/recovery-phrase/reset",
  summary: "Reset recovery phrase",
  operationId: "userRecoveryPhraseReset",
  description: "Reset the recovery phrase. Returns a new phrase. WARNING: This impacts enhanced encryption.\n\n" +
    "**Behavior:** Generates and stores a fresh 12-word BIP39 phrase, returning the plaintext once. The `currentPhrase` body field is accepted for forward compatibility but is **not** validated against the stored phrase by design — the reset succeeds without proving knowledge of the current phrase.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** The new plaintext phrase is shown only this once. Resetting re-derives enhanced-encryption key material and may require re-encrypting data.",
  tags: [OpenAPITags.users],
  request: {
    body: {
      content: {
        "application/json": { schema: ResetRecoveryPhraseRequestSchema },
      },
    },
  },
  responses: {
    200: {
      description: "Recovery phrase reset successfully",
      content: {
        "application/json": { schema: ResetRecoveryPhraseResponseSchema },
      },
    },
    400: {
      description: "Bad request - invalid current phrase",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});

/**
 * Delete recovery phrase
 */
export const deleteRecoveryPhraseRoute = createRoute({
  method: "delete",
  path: "/recovery-phrase",
  summary: "Delete recovery phrase",
  operationId: "userRecoveryPhraseDelete",
  description: "Remove the recovery phrase entirely. WARNING: This is destructive and will impact enhanced encryption.\n\n" +
    "**Behavior:** Deletes the stored phrase for the calling user. Enhanced-encryption recovery flows that depend on the phrase will no longer function.\n" +
    "**Auth:** Cookie session (or API key).\n" +
    "**Permissions:** None beyond auth — scoped to the calling user.\n" +
    "**Notes:** Destructive and irreversible; encrypted data may become unrecoverable without another unlock path (password / passkey PRF).",
  tags: [OpenAPITags.users],
  responses: {
    200: {
      description: "Recovery phrase deleted successfully",
      content: {
        "application/json": { schema: DeleteRecoveryPhraseResponseSchema },
      },
    },
    401: {
      description: "Unauthorized",
      content: { "application/json": { schema: ErrorResponseSchema } },
    },
    ...httpResponseInternalServerError,
  },
});
