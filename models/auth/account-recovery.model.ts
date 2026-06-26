/**
 * @file models/auth/account-recovery.model.ts
 * @description Zod schemas for account recovery API requests and responses
 */

import { z } from "@deps";
import { SCHEMA_VALIDATION_PASSWORD } from "./passwords.model.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";

// Recovery phrase validation (12 BIP39 words)
const SCHEMA_RECOVERY_PHRASE = z.string()
  .trim()
  .min(1, withKey("account-recovery.recovery-phrase-required", "Recovery phrase is required"))
  .refine(
    (val) => val.split(/\s+/).length === 12,
    withKey("account-recovery.recovery-phrase-invalid-length", "Recovery phrase must be exactly 12 words"),
  )
  .openapi({
    description: "12-word BIP39 recovery phrase (space-separated)",
    example: "abandon ability able about above absent absorb abstract absurd abuse access accident",
  });

// Initiate recovery request
export const SchemaAccountRecoveryInitiateRequest = z.object({
  identifier: z.string().trim().min(1, withKey("account-recovery.identifier-required", "Email or username is required")).openapi({
    description: "Email address or username identifying the account to recover",
    example: "user@example.com",
  }),
});

export type IAccountRecoveryInitiateRequest = z.infer<
  typeof SchemaAccountRecoveryInitiateRequest
>;

// Initiate recovery response
export const SchemaAccountRecoveryInitiateResponse = z.object({
  identifierType: z.enum(["email", "username"]).openapi({
    description: "How the supplied identifier was interpreted",
    example: "email",
  }),
  recoveryOptions: z.object({
    emailLink: z.boolean().openapi({
      description: "Whether an email recovery link can be sent",
      example: true,
    }),
    recoveryPhrase: z.boolean().openapi({
      description: "Whether a 12-word recovery phrase is available",
      example: true,
    }),
  }),
  enhancedEncryptionEnabled: z.boolean().openapi({
    description: "Whether end-to-end encryption is enabled on the account",
    example: false,
  }),
  hasRecoveryPhrase: z.boolean().openapi({
    description: "Whether a recovery phrase has been set for the account",
    example: true,
  }),
});

export type IAccountRecoveryInitiateResponse = z.infer<
  typeof SchemaAccountRecoveryInitiateResponse
>;

// Verify recovery phrase request
export const SchemaVerifyRecoveryPhraseRequest = z.object({
  identifier: z.string().trim().min(1, withKey("account-recovery.identifier-required", "Email or username is required")).openapi({
    description: "Email address or username identifying the account",
    example: "user@example.com",
  }),
  recoveryPhrase: SCHEMA_RECOVERY_PHRASE,
});

export type IVerifyRecoveryPhraseRequest = z.infer<
  typeof SchemaVerifyRecoveryPhraseRequest
>;

// Verify recovery phrase response
export const SchemaVerifyRecoveryPhraseResponse = z.object({
  recoveryToken: z.string().openapi({
    description: "Short-lived recovery token authorizing the remainder of the recovery flow",
    example: "rec_2xq9j4k7Lm3pRt8vN1cYb6wZ",
  }),
});

export type IVerifyRecoveryPhraseResponse = z.infer<
  typeof SchemaVerifyRecoveryPhraseResponse
>;

// Reset password request
export const SchemaResetPasswordRecoveryRequest = z.object({
  recoveryToken: z.string().optional().openapi({
    description: "Recovery token from phrase verification (required if emailToken is absent)",
    example: "rec_2xq9j4k7Lm3pRt8vN1cYb6wZ",
  }),
  emailToken: z.string().optional().openapi({
    description: "Token from the recovery email link (required if recoveryToken is absent)",
    example: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  }),
  newPassword: SCHEMA_VALIDATION_PASSWORD,
}).refine(
  (data) => data.recoveryToken || data.emailToken,
  withKey("account-recovery.token-required", "Either recoveryToken or emailToken is required"),
);

export type IResetPasswordRecoveryRequest = z.infer<
  typeof SchemaResetPasswordRecoveryRequest
>;

// Reset password response
export const SchemaResetPasswordRecoveryResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether the password was reset successfully",
    example: true,
  }),
  newRecoveryPhrase: z.string().optional().openapi({
    description: "Newly rotated 12-word recovery phrase, when the old one is invalidated by the reset",
    example: "abandon ability able about above absent absorb abstract absurd abuse access accident",
  }),
});

export type IResetPasswordRecoveryResponse = z.infer<
  typeof SchemaResetPasswordRecoveryResponse
>;

// Register passkey begin request
export const SchemaRegisterPasskeyBeginRequest = z.object({
  recoveryToken: z.string().min(1, withKey("account-recovery.recovery-token-required", "Recovery token is required")),
});

export type IRegisterPasskeyBeginRequest = z.infer<
  typeof SchemaRegisterPasskeyBeginRequest
>;

// Register passkey begin response
export const SchemaRegisterPasskeyBeginResponse = z.object({
  attemptId: z.string(),
  creationOptions: z.any(), // PublicKeyCredentialCreationOptionsJSON
  prfSalt: z.string(),
});

export type IRegisterPasskeyBeginResponse = z.infer<
  typeof SchemaRegisterPasskeyBeginResponse
>;

// Register passkey complete request
export const SchemaRegisterPasskeyCompleteRequest = z.object({
  recoveryToken: z.string().min(1, withKey("account-recovery.recovery-token-required", "Recovery token is required")),
  attemptId: z.string().min(1, withKey("account-recovery.attempt-id-required", "Attempt ID is required")),
  registrationResponse: z.any(), // RegistrationResponseJSON
  prfOutput: z.string().min(1, withKey("account-recovery.prf-output-required", "PRF output is required")),
});

export type IRegisterPasskeyCompleteRequest = z.infer<
  typeof SchemaRegisterPasskeyCompleteRequest
>;

// Register passkey complete response
export const SchemaRegisterPasskeyCompleteResponse = z.object({
  success: z.boolean(),
  newRecoveryPhrase: z.string().optional(),
});

export type IRegisterPasskeyCompleteResponse = z.infer<
  typeof SchemaRegisterPasskeyCompleteResponse
>;
