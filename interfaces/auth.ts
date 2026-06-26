/**
 * @file interfaces/auth.ts
 * @description Authentication-related interfaces for constants and configuration
 * These interfaces define the structure of configuration objects and constants
 */

import type { AuthenticatorTransportFuture } from "@deps";

/**
 * Internal binary blob for backup code storage.
 * Layout: [shared_salt: 16 bytes][hash_0: 32 bytes]...[hash_N: 32 bytes]
 * Total size = 16 + (numberOfCodes * 32) bytes
 */
export type IBackupCodeBinaryBlob = Uint8Array;

/**
 * WebAuthn credential structure for passkey authentication
 */
export interface IAuthWebAuthnCredential {
  id: string;
  publicKey: string;
  counter: number;
  backedUp: boolean;
  transports?: AuthenticatorTransportFuture[];
  [key: string]: unknown;
}

/**
 * Password pepper configuration interface for password hashing
 */
export interface IAuthPepperConfig {
  passwordPepper: string;
  newPasswordPepper?: string;
  isPasswordRotationInProgress?: boolean;
}

/**
 * Progressive delay configuration for authentication rate limiting
 */
export interface IAuthProgressiveDelayConfig {
  baseDelayMs: number;
  maxDelayMs: number;
  exponentialBase: number;
  maxAttempts: number;
  blockDurationMs: number;
  windowMs: number;
  enableIPBasedAdjustment: boolean;
}

/**
 * Authentication flow types enum
 */
export enum AuthFlowType {
  DIRECT_LOGIN = "direct_login",
  TWO_FA_SINGLE = "two_fa_single",
}

/**
 * Magic link JWT payload interface
 */
export interface IAuthMagicLinkPayload {
  email: string;
  sub: string;
  type: "magic";
  iat: number;
  exp: number;
  jti: string;
}

/**
 * TOTP payload interface for rate limiting and validation
 */
export interface IAuthTOTPPayload {
  count: number;
  windowStart: number;
}

/**
 * User information for token payloads
 */
interface IAuthUserTokenInfo {
  userId: string;
  environment: string;
  displayName?: string;
  has2FA?: boolean;
}

/**
 * Token validation results
 */
export interface IAuthMultiUserTokenData {
  users: IAuthUserTokenInfo[];
  isValid: boolean;
}

/**
 * Multi-user token payload for environment selection
 */
export interface IAuthMultiUserTokenPayload {
  type: string;
  sessionId?: string; // Make optional to handle type compatibility
  sub: string;
  aud: string;
  exp: number;
  iat: number;
}

/**
 * Cached user selection data
 */
export interface IAuthCachedUserSelection {
  users: IAuthUserTokenInfo[];
  identityId: string;
  createdAt: number;
}

/**
 * Password reset token data interface
 */
export interface IAuthPasswordResetTokenData {
  userId: string;
  tokenHash: string;
  createdAt: number;
  expiresAt: number;
  used: boolean;
  environmentId: string;
}

/**
 * Password reset result interface
 */
export interface IAuthPasswordResetResult {
  token: string;
  hashedToken: string;
  expiresAt: number;
}

/**
 * Authentication attempt data for progressive delay
 */
export interface IAuthAttemptData {
  userId?: string;
  ipAddress: string;
  userAgent: string;
  attemptCount: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
  nextAllowedAt: number;
  isBlocked: boolean;
  blockExpiresAt?: number;
  riskScore: number;
}

/**
 * Delay calculation result interface
 */
export interface IAuthDelayResult {
  shouldDelay: boolean;
  delayMs: number;
  nextAllowedAt: number;
  attemptCount: number;
  isBlocked: boolean;
  blockExpiresAt?: number;
}

/**
 * Environment information interface
 */
export interface IAuthEnvironmentInfo {
  userId: string;
  environment: string;
  displayName: string;
}

/**
 * Authentication flow context interface
 */
export interface IAuthFlowContext {
  flowType: AuthFlowType;
  users: unknown[]; // Will be typed as IUserWithEnvironment[] when that interface is available
  requiresSelection: boolean;
  requires2FA: boolean;
  environments?: IAuthEnvironmentInfo[];
}

/**
 * Internal authentication flow context with sensitive data
 * Used only within authentication handlers - should not be exposed to end users
 */
export interface IAuthFlowContextInternal extends IAuthFlowContext {
  password: string;
}

/**
 * Registration mode type - determines how the registration token is consumed
 */
export type IAuthRegistrationMode = "password" | "passkey-begin";

/**
 * Request body for POST /api/auth/register/:token
 */
export interface IAuthRegisterRequest {
  mode: IAuthRegistrationMode;
  password?: string; // Required when mode === "password"
  username?: string; // Optional when mode === "passkey-begin"
  displayName?: string; // Optional when mode === "passkey-begin"
}

/**
 * Response for GET /api/auth/register/:token (token validation)
 */
export interface IAuthRegisterValidationResponse {
  fullName: string;
  environmentName: string;
  username: string | null;
  hasPasskey: boolean;
}

/**
 * Response for POST /api/auth/register/:token (password mode)
 */
export interface IAuthRegisterPasswordResponse {
  isAuthCompleted: true;
  message: string;
  userId: string;
  environmentId: string;
  displayName: string;
}

/**
 * Response for POST /api/auth/register/:token (passkey-begin mode)
 */
export interface IAuthRegisterPasskeyBeginResponse {
  isAuthCompleted: false;
  nextStep: "passkey-register";
  attemptId: string;
  creationOptions: Record<string, unknown>;
}

/**
 * Request body for POST /api/auth/register/:token/passkey
 */
export interface IAuthRegisterPasskeyVerifyRequest {
  attemptId: string;
  credential: Record<string, unknown>;
  username?: string;
  displayName?: string | null;
  prfOutput?: { first?: string };
}

/**
 * Response for POST /api/auth/register/:token/passkey
 */
export interface IAuthRegisterPasskeyVerifyResponse {
  isAuthCompleted: true;
  message: string;
  userId: string;
  environmentId: string;
  displayName: string;
}
