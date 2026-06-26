/**
 * @file models/users/passkey.model.ts
 * @description Response schemas for user passkey management operations
 */

import { z } from "@deps";

export const SchemaPasskeyListResponse = z.object({
  data: z.array(z.record(z.string(), z.unknown())),
  passkeysRequirePrfSetup: z.boolean(),
});

export const SchemaPasskeyBeginResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyVerifyResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyReauthPasswordResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyReauthBeginResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyReauthVerifyResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyDeleteResponse = z.object({
  success: z.literal(true).openapi({ description: "Confirmation that the passkey was deleted", example: true }),
});

export const SchemaPasskeyPrfSetupBeginResponse = z.record(z.string(), z.unknown());

export const SchemaPasskeyPrfSetupVerifyResponse = z.record(z.string(), z.unknown());

export type IPasskeyListResponse = z.infer<typeof SchemaPasskeyListResponse>;
export type IPasskeyBeginResponse = z.infer<typeof SchemaPasskeyBeginResponse>;
export type IPasskeyVerifyResponse = z.infer<typeof SchemaPasskeyVerifyResponse>;
export type IPasskeyReauthPasswordResponse = z.infer<typeof SchemaPasskeyReauthPasswordResponse>;
export type IPasskeyReauthBeginResponse = z.infer<typeof SchemaPasskeyReauthBeginResponse>;
export type IPasskeyReauthVerifyResponse = z.infer<typeof SchemaPasskeyReauthVerifyResponse>;
export type IPasskeyDeleteResponse = z.infer<typeof SchemaPasskeyDeleteResponse>;
export type IPasskeyPrfSetupBeginResponse = z.infer<typeof SchemaPasskeyPrfSetupBeginResponse>;
export type IPasskeyPrfSetupVerifyResponse = z.infer<typeof SchemaPasskeyPrfSetupVerifyResponse>;
