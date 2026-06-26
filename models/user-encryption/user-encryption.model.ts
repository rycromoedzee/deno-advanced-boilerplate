/**
 * @file models/user-encryption/user-encryption.model.ts
 * @description Response schemas for user encryption management operations
 */

import { z } from "@deps";

export const SchemaEncryptionOptInResponse = z.object({
  success: z.literal(true),
  recoveryPhrase: z.string(),
  message: z.string(),
});

export const SchemaEncryptionStatusResponse = z.object({
  isEnhancedEncryptionEnabled: z.boolean(),
});

export const SchemaEncryptionVerifyRecoveryPhraseResponse = z.object({
  isValid: z.boolean(),
  message: z.string(),
});

export const SchemaEncryptionDisableResponse = z.object({
  success: z.boolean(),
  migratedKeys: z.number(),
  sharedKeysConverted: z.number(),
  message: z.string(),
});

export const SchemaEncryptionCanEnableResponse = z.record(z.string(), z.unknown());

export const SchemaEncryptionPRFSetupResponse = z.object({
  success: z.boolean(),
});

export const SchemaEncryptionPRFVerifyResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const SchemaEncryptionRotateKeyResponse = z.object({
  success: z.literal(true),
  pendingPasskeyRewraps: z.number(),
  message: z.string(),
});

export const SchemaEncryptionRewrapPasskeyResponse = z.object({
  success: z.boolean(),
  message: z.string(),
});

export type IEncryptionOptInResponse = z.infer<typeof SchemaEncryptionOptInResponse>;
export type IEncryptionStatusResponse = z.infer<typeof SchemaEncryptionStatusResponse>;
export type IEncryptionVerifyRecoveryPhraseResponse = z.infer<typeof SchemaEncryptionVerifyRecoveryPhraseResponse>;
export type IEncryptionDisableResponse = z.infer<typeof SchemaEncryptionDisableResponse>;
export type IEncryptionCanEnableResponse = z.infer<typeof SchemaEncryptionCanEnableResponse>;
export type IEncryptionPRFSetupResponse = z.infer<typeof SchemaEncryptionPRFSetupResponse>;
export type IEncryptionPRFVerifyResponse = z.infer<typeof SchemaEncryptionPRFVerifyResponse>;
export type IEncryptionRotateKeyResponse = z.infer<typeof SchemaEncryptionRotateKeyResponse>;
export type IEncryptionRewrapPasskeyResponse = z.infer<typeof SchemaEncryptionRewrapPasskeyResponse>;
