/**
 * @file models/auth/auth-response.model.ts
 * @description Zod response schemas for auth handler endpoints
 */

import { z } from "@deps";

// ==========================================
// Login response schemas
// ==========================================

/** Direct login success response (status 200) */
export const SchemaAuthLoginDirectResponse = z.object({
  message: z.string(),
  isAuthCompleted: z.literal(true),
  nextStep: z.literal("direct-login"),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
});

/** 2FA challenge response (status 202) */
export const SchemaAuthLoginTwoFAResponse = z.object({
  message: z.string(),
  redirectTo: z.string(),
  isAuthCompleted: z.literal(false),
  nextStep: z.literal("two-factor"),
  postTwoFactorNextStep: z.literal("direct-login"),
});

/** Union of all login success responses */
export const SchemaAuthLoginResponse = z.union([
  SchemaAuthLoginDirectResponse,
  SchemaAuthLoginTwoFAResponse,
]);

// ==========================================
// Challenge response schema
// ==========================================

/** Challenge verification success response (status 200) */
export const SchemaAuthChallengeResponse = z.object({
  success: z.literal(true),
});

// ==========================================
// Register response schemas
// ==========================================

/** Registration token validation response (GET /register/:token) */
export const SchemaRegisterValidateResponse = z.object({
  fullName: z.string(),
  environmentName: z.string(),
  username: z.string().nullable(),
  hasPasskey: z.boolean(),
});

/** Password registration success response (POST /register/:token, mode=password) */
export const SchemaRegisterPasswordResponse = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string(),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
});

/** Passkey registration begin response (POST /register/:token, mode=passkey-begin) */
export const SchemaAuthRegisterPasskeyBeginResponse = z.object({
  isAuthCompleted: z.literal(false),
  nextStep: z.literal("passkey-register"),
  attemptId: z.string(),
  creationOptions: z.record(z.string(), z.unknown()),
});

/** Union of register success responses */
export const SchemaRegisterResponse = z.union([
  SchemaRegisterPasswordResponse,
  SchemaAuthRegisterPasskeyBeginResponse,
]);

/** Passkey verify registration success response */
export const SchemaRegisterPasskeyVerifyResponse = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string(),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
  prfSetupRecommended: z.boolean(),
});

// ==========================================
// Passkey login response schemas
// ==========================================

/** Passkey login begin response */
export const SchemaPasskeyLoginBeginResponse = z.object({
  isAuthCompleted: z.literal(false),
  nextStep: z.literal("passkey-verify"),
  attemptId: z.string(),
  requestOptions: z.record(z.string(), z.unknown()),
  prfEvaluationRequest: z.object({
    salt: z.string().optional(),
    saltsByCredential: z.record(z.string(), z.string()).optional(),
  }).optional(),
});

/** Passkey login verify success response */
export const SchemaPasskeyLoginVerifyResponse = z.object({
  isAuthCompleted: z.literal(true),
  message: z.string(),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
  stalePasskeyCredentialId: z.string().optional(),
});

// ==========================================
// Magic-link response schemas
// ==========================================

/**
 * Magic-link request endpoint response (status 202).
 * ALWAYS identical whether or not the email exists — prevents account
 * enumeration (F14 / Decision Gate G4).
 */
export const SchemaMagicLinkRequestResponse = z.object({
  message: z.string().openapi({
    description: "Generic acknowledgement — identical whether or not the email exists",
    example: "If an account exists for that email, a sign-in link is on its way.",
  }),
});

/**
 * Magic-link consume response. Shape depends on the account's E2EE state (G2-C):
 *   - E2EE off, no 2FA -> 200, isAuthCompleted true, nextStep "direct-login"
 *     (+ userId/environmentId/displayName); a full key-less session is set via cookies.
 *   - E2EE off, 2FA on  -> 202, isAuthCompleted false, nextStep "two-factor"   (+ redirectTo)
 *   - E2EE on, passkey  -> 202, isAuthCompleted false, nextStep "passkey-login" (+ redirectTo)
 * Other E2EE-on configurations are rejected (403/409) and never reach this schema.
 */
export const SchemaMagicLinkConsumeResponse = z.object({
  message: z.string().openapi({
    description: "Outcome message describing the next step in the flow",
    example: "Magic link verified.",
  }),
  isAuthCompleted: z.boolean().openapi({
    description: "Whether authentication is fully complete (true) or another step remains (false)",
    example: true,
  }),
  nextStep: z.enum(["direct-login", "two-factor", "passkey-login"]).openapi({
    description: "Next step the client should perform",
    example: "direct-login",
  }),
  redirectTo: z.string().optional().openapi({
    description: "URL the client should hit next, when a step remains",
    example: "/api/auth/two-factor",
  }),
  userId: z.string().optional().openapi({
    description: "Authenticated user's id (present on direct-login completion)",
    example: "user_01HZX4M3K2P7Q9R1S5T8V0W1XY",
  }),
  environmentId: z.string().optional().openapi({
    description: "Authenticated user's environment (tenant) id (present on direct-login completion)",
    example: "env_01HZX9B6N4R8T2V6X0C3D5G7HK",
  }),
  displayName: z.string().optional().openapi({
    description: "Authenticated user's display name (present on direct-login completion)",
    example: "John Doe",
  }),
  /** Present on the passkey-login handoff so the client can start the ceremony. */
  username: z.string().nullable().optional().openapi({
    description: "Username to seed the passkey ceremony (passkey-login handoff)",
    example: "johndoe",
  }),
  /** Present on the passkey-login handoff (display/fallback). */
  email: z.string().nullable().optional().openapi({
    description: "Email fallback for the passkey ceremony (passkey-login handoff)",
    example: "user@example.com",
  }),
});

// ==========================================
// Two-factor response schema
// ==========================================

/** 2FA verification success response */
export const SchemaTwoFactorAuthResponse = z.object({
  nextStep: z.literal("direct-login"),
  isAuthCompleted: z.literal(true),
  message: z.string(),
  userId: z.string(),
  environmentId: z.string(),
  displayName: z.string(),
});

// ==========================================
// Recovery response schemas
// ==========================================

/** Recovery disable 2FA response */
export const SchemaRecoveryDisable2FAResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether 2FA was disabled successfully",
    example: true,
  }),
});

/** Recovery verify backup code response */
export const SchemaRecoveryVerifyBackupCodeResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether the backup code was verified",
    example: true,
  }),
  verifiedToken: z.string().openapi({
    description: "Fresh verified token authorizing the remainder of the recovery flow",
    example: "rec_2xq9j4k7Lm3pRt8vN1cYb6wZ",
  }),
});

/** Recovery send reset email response */
export const SchemaRecoverySendResetEmailResponse = z.object({
  success: z.boolean().openapi({
    description: "Always true — identical whether or not the email exists to prevent enumeration",
    example: true,
  }),
});

/** Recovery verify email token response */
export const SchemaRecoveryVerifyEmailTokenResponse = z.object({
  valid: z.boolean().openapi({
    description: "Whether the email token is valid",
    example: true,
  }),
  identifier: z.string().optional().openapi({
    description: "Identifier (email/username) the token resolved to",
    example: "user@example.com",
  }),
  recoveryOptions: z.object({
    emailLink: z.boolean().openapi({
      description: "Whether an email recovery link is available",
      example: true,
    }),
    recoveryPhrase: z.boolean().openapi({
      description: "Whether a 12-word recovery phrase is available",
      example: true,
    }),
  }).optional(),
  enhancedEncryptionEnabled: z.boolean().optional().openapi({
    description: "Whether end-to-end encryption is enabled on the account",
    example: false,
  }),
  hasRecoveryPhrase: z.boolean().optional().openapi({
    description: "Whether a recovery phrase has been set",
    example: true,
  }),
  has2FA: z.boolean().optional().openapi({
    description: "Whether 2FA is enabled — frontend must gate on 2FA/backup code before password reset",
    example: false,
  }),
  requiresUserSelection: z.boolean().optional().openapi({
    description: "Whether the user must choose among multiple environments",
    example: false,
  }),
  availableUsers: z.array(z.object({
    userId: z.string().openapi({
      description: "User id within a specific environment",
      example: "user_01HZX4M3K2P7Q9R1S5T8V0W1XY",
    }),
    environmentName: z.string().openapi({
      description: "Name of the environment",
      example: "Production",
    }),
    displayName: z.string().openapi({
      description: "Display name of the user in that environment",
      example: "John Doe (Production)",
    }),
  })).optional(),
});
