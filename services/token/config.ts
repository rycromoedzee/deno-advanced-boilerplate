/**
 * @file services/token/config.ts
 * @description Configuration for token services
 */
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";

export interface ITokensSessionData {
  sessionId?: string;
  userId: string;
  tokenHash: string;
  deviceInfo: ITokensDeviceTypeOptions;
  createdAt: number; // Timestamp in milliseconds (from getTimeNow())
  ipAddress: string;
  environmentId?: string;
  revokedAt?: number; // Timestamp in milliseconds (from getTimeNow())
  // User encryption data (if user has encryption enabled)
  encryptionData?: ITokensEncryptionData;
  // Cached user profile (populated at session creation, avoids DB query per request)
  firstName?: string;
  lastName?: string;
}

export interface ITokensEncryptionData {
  // Store encrypted password-derived key in session data directly
  encryptedPasswordDerivedKey: string; // Password-derived key encrypted with app secret + JWT token combination (salt embedded) - Base64 encoded for cache storage
  lastAccessedAt: number; // When the encryption key was last accessed
  ipAddress?: string; // IP address for security tracking
  userAgent?: string; // User agent for security tracking
  // Optional PRF-derived key for passkey sessions
  encryptedPRFDerivedKey?: string;
  prfCredentialId?: string;
}

export interface ITokensRefreshTokenData {
  sessionId?: string;
  userId: string;
  fingerprint: string;
  /** Token expiration timestamp (when the token expires) */
  expiresAt: number;
  createdAt: number;
  ipAddress: string;
  maxAgeType: number;
  // User encryption data (if user has encryption enabled)
  encryptedPasswordDerivedKey?: string; // Password-derived key encrypted with app secret + refresh token combination - Base64 encoded for cache storage
  // PRF-derived key for passkey sessions (persisted across token refresh)
  encryptedPRFDerivedKey?: string;
  prfCredentialId?: string;
}

export interface ITokensCurrentSessions {
  sessionId?: string;
  ipAddress: string;
  userAgent: string;
  createdAt: number;
  accessTokenHash?: string;
  refreshTokenHash?: string;
  lastRotatedAt?: number;
  tokenHash?: string;
}

export interface ITokensPayloadCreateJWT {
  sub: string;
  type: JWT_TOKEN_TYPES;
  aud: (typeof JWT_TOKEN_CONFIG.audiences)[keyof typeof JWT_TOKEN_CONFIG.audiences];
  environmentId?: string;
}

export interface ITokensPayloadEmail extends ITokensPayloadJWT {
  category: string;
}

export interface ITokensPayloadJWT extends ITokensPayloadCreateJWT {
  iat: number;
  exp: number;
  iss: string;
  nbf: number;
  [key: string]: unknown;
}

export interface ITokensDeviceTypeOptions {
  userAgent: string;
  accept: string;
  lang: string;
}
