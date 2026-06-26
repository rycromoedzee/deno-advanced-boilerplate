/**
 * @file models/users/recovery-phrase.model.ts
 * @description Response schemas for user recovery phrase operations
 */

import { z } from "@deps";

export const SchemaRecoveryPhraseStatusResponse = z.object({
  hasRecoveryPhrase: z.boolean().openapi({ description: "Whether a recovery phrase has been set up", example: true }),
  isVerified: z.boolean().openapi({ description: "Whether the user has confirmed the phrase via verify", example: true }),
  createdAt: z.number().optional().openapi({ description: "Unix timestamp (seconds) when the phrase was created", example: 1789977600 }),
  verifiedAt: z.number().optional().openapi({
    description: "Unix timestamp (seconds) when the phrase was last verified",
    example: 1790064000,
  }),
});

export const SchemaRecoveryPhraseCreateResponse = z.object({
  recoveryPhrase: z.string().openapi({
    description: "The 12-word BIP39 recovery phrase — shown only this once",
    example: "abandon ability able about above absent absorb abstract absurd abuse access accident",
  }),
  message: z.string().openapi({ description: "Human-readable result message", example: "Recovery phrase created successfully." }),
});

export const SchemaRecoveryPhraseVerifyResponse = z.object({
  isValid: z.boolean().openapi({ description: "Whether the submitted phrase matches the stored phrase", example: true }),
  message: z.string().openapi({ description: "Human-readable result message", example: "Recovery phrase verified successfully" }),
});

export const SchemaRecoveryPhraseResetResponse = z.object({
  recoveryPhrase: z.string().openapi({
    description: "The new 12-word BIP39 recovery phrase — shown only this once",
    example: "abandon ability able about above absent absorb abstract absurd abuse access accident",
  }),
  message: z.string().openapi({ description: "Human-readable result message", example: "Recovery phrase reset successfully." }),
});

export const SchemaRecoveryPhraseDeleteResponse = z.object({
  success: z.boolean().openapi({ description: "Whether the deletion succeeded", example: true }),
  message: z.string().openapi({
    description: "Human-readable result message",
    example: "Recovery phrase deleted successfully. Enhanced encryption features may be impacted.",
  }),
});

export type IRecoveryPhraseStatusResponse = z.infer<typeof SchemaRecoveryPhraseStatusResponse>;
export type IRecoveryPhraseCreateResponse = z.infer<typeof SchemaRecoveryPhraseCreateResponse>;
export type IRecoveryPhraseVerifyResponse = z.infer<typeof SchemaRecoveryPhraseVerifyResponse>;
export type IRecoveryPhraseResetResponse = z.infer<typeof SchemaRecoveryPhraseResetResponse>;
export type IRecoveryPhraseDeleteResponse = z.infer<typeof SchemaRecoveryPhraseDeleteResponse>;
