/**
 * @file models/users/two-factor.model.ts
 * @description Response schemas for user two-factor authentication operations
 */

import { z } from "@deps";

export const SchemaTwoFactorListResponse = z.object({
  data: z.array(z.record(z.string(), z.unknown())).openapi({ description: "Registered 2FA devices (secrets excluded)" }),
});

export const SchemaTwoFactorCreateResponse = z.object({
  secretId: z.string().openapi({ description: "Identifier of the newly created 2FA secret", example: "2fa_xyz789" }),
  uri: z.string().openapi({
    description: "OTP Auth URI for QR-code generation",
    example: "otpauth://totp/AppName:Device?secret=JBSWY3DPEHPK3PXP&issuer=AppName",
  }),
  backupCodes: z.array(z.string()).openapi({
    description: "Backup codes (only returned when this is the first 2FA device)",
    example: ["abc123-def456-ghi789", "jkl012-mno345-pqr789"],
  }),
});

export const SchemaTwoFactorDeleteResponse = z.object({
  success: z.literal(true).openapi({ description: "Confirmation that the device was removed", example: true }),
  message: z.string().openapi({
    description: "Human-readable result; notes when 2FA is disabled as a result",
    example: "2FA device removed successfully",
  }),
});

export const SchemaTwoFactorBackupCodesResponse = z.object({
  backupCodes: z.array(z.string()).openapi({
    description: "Newly generated backup codes — save securely; prior codes are invalidated",
    example: ["abc123-def456-ghi789", "jkl012-mno345-pqr789"],
  }),
  message: z.string().openapi({ description: "Human-readable result message", example: "Backup codes regenerated successfully." }),
});

export const SchemaTwoFactorStatusResponse = z.object({
  isEnabled: z.boolean().openapi({ description: "Whether 2FA is enabled for the user", example: true }),
  activeDeviceCount: z.number().openapi({ description: "Number of active 2FA devices", example: 2 }),
  hasBackupCodes: z.boolean().openapi({ description: "Whether backup codes are available", example: true }),
});

export const SchemaTwoFactorRevealResponse = z.object({
  secretId: z.string().openapi({ description: "Identifier of the revealed 2FA secret", example: "2fa_xyz789" }),
  name: z.string().openapi({ description: "Display name of the device", example: "Authenticator App" }),
  uri: z.string().openapi({
    description: "OTP Auth URI for QR-code generation",
    example: "otpauth://totp/AppName:Device?secret=JBSWY3DPEHPK3PXP&issuer=AppName",
  }),
  secret: z.string().openapi({ description: "Base32-encoded secret for manual entry", example: "JBSWY3DPEHPK3PXP" }),
});

export type ITwoFactorListResponse = z.infer<typeof SchemaTwoFactorListResponse>;
export type ITwoFactorCreateResponse = z.infer<typeof SchemaTwoFactorCreateResponse>;
export type ITwoFactorDeleteResponse = z.infer<typeof SchemaTwoFactorDeleteResponse>;
export type ITwoFactorBackupCodesResponse = z.infer<typeof SchemaTwoFactorBackupCodesResponse>;
export type ITwoFactorStatusResponse = z.infer<typeof SchemaTwoFactorStatusResponse>;
export type ITwoFactorRevealResponse = z.infer<typeof SchemaTwoFactorRevealResponse>;
