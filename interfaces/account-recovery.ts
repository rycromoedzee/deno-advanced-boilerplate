/**
 * @file interfaces/account-recovery.ts
 * @description Account recovery interfaces shared across services and handlers
 */

/** Result from recovery initiation */
export interface IAccountRecoveryInitiateResult {
  identifierType: "email" | "username";
  recoveryOptions: {
    /** True if email link recovery is available (identity has email) */
    emailLink: boolean;
    /** True if recovery phrase verification is available */
    recoveryPhrase: boolean;
  };
  enhancedEncryptionEnabled: boolean;
  hasRecoveryPhrase: boolean;
}

/** Internal token data stored in cache (server-side only) */
export interface IAccountRecoveryTokenData {
  identityId: string; // Changed from userId - identity is the auth container
  userId?: string; // Set only after user selection (multi-tenant)
  tokenHash: string;
  encryptedMasterKey: string; // Encrypted with token-derived key (never plaintext)
  createdAt: number;
  expiresAt: number;
  used: boolean;
  /** Available users for this identity (multi-tenant) */
  availableUsers?: Array<{
    userId: string;
    environmentName: string;
    displayName: string;
  }>;
}

/** Request to verify recovery phrase - uses identityId from email token */
export interface IVerifyRecoveryPhraseRequest {
  emailToken: string; // JWT from email link - contains identityId
  recoveryPhrase: string;
}

/** Response from recovery phrase verification */
export interface IVerifyRecoveryPhraseResponse {
  recoveryToken: string;
  /** Only populated if identity has multiple users */
  requiresUserSelection?: boolean;
  availableUsers?: Array<{
    userId: string;
    environmentName: string;
    displayName: string;
  }>;
}

/** Request to select user (multi-tenant) */
export interface ISelectUserRequest {
  recoveryToken: string;
  userId: string;
}

/** Request to reset password during recovery */
export interface IResetPasswordRecoveryRequest {
  recoveryToken?: string;
  emailToken?: string;
  newPassword: string;
  /** Security option: invalidate other credentials */
  invalidateOtherCredentials?: boolean;
  /** Reason for recovery - affects security posture */
  recoveryReason?: "lost_device" | "forgot_password" | "suspected_compromise";
}

/** Response from password reset during recovery */
export interface IResetPasswordRecoveryResponse {
  success: boolean;
  newRecoveryPhrase?: string;
  requiresTwoFactor?: boolean; // If 2FA enabled
}

/** Request to begin passkey registration during recovery */
export interface IRegisterPasskeyBeginRequest {
  recoveryToken: string;
}

/** Response from passkey registration begin */
export interface IRegisterPasskeyBeginResponse {
  attemptId: string;
  creationOptions: unknown;
  prfSalt: string;
}

/** Request to complete passkey registration during recovery */
export interface IRegisterPasskeyCompleteRequest {
  recoveryToken: string;
  attemptId: string;
  registrationResponse: unknown;
  prfOutput: string;
}

/** Response from passkey registration complete */
export interface IRegisterPasskeyCompleteResponse {
  success: boolean;
  newRecoveryPhrase?: string;
}

/** Internal result from looking up user by identifier */
export interface IAccountRecoveryLookupResult {
  found: boolean;
  userId?: string;
  identityId?: string;
  email?: string;
  username?: string;
  language?: string;
  hasPassword?: boolean;
  hasPasskeys?: boolean;
  enhancedEncryptionEnabled?: boolean;
  hasRecoveryPhrase?: boolean;
}
