/**
 * @file interfaces/session.ts
 * @description Session service interfaces
 * These interfaces define the structure for session management operations
 */

import { ITokensRequestHeaders } from "./token.ts";

/**
 * API Key creation payload
 */
export interface ISessionCreateApiKeyPayload {
  name: string;
  permissions?: string[];
  permissionGroup?: string;
  expiresAt?: number;
  ipRestrictions?: string[];
  domainRestrictions?: string[];
  userId: string;
  environmentId?: string;
}

/**
 * API Key creation result
 */
export interface ISessionCreateApiKeyResult {
  apiKey: string;
  id: string;
  keyEndingIn: string;
  expiresAt?: number;
  permissions: string[];
}

/**
 * Session creation result containing tokens
 */
export interface ISessionCreationResult {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  refreshExpiresAt: number;
  /** Ephemeral session key to set as cookie. Client-held; never stored server-side. */
  sessionKey: string;
}

/**
 * Cached API key data structure
 */
export interface ISessionCachedApiKeyData {
  userId: string;
  environmentId?: string | null;
  expiresAt: number | null;
  ipRestrictions: string[] | null;
  domainRestrictions: string[] | null;
  hashedKey: string;
}

/**
 * Current session encryption data
 */
export interface ISessionCurrentSessionEncryptionData {
  encryptedPasswordDerivedKey: string;
  lastAccessedAt: number;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Current session data structure
 */
export interface ISessionCurrentSessionData {
  ipAddress: string;
  userAgent: string;
  createdAt: number;
  tokenHash: string;
}

/**
 * Refresh session data structure
 */
export interface ISessionRefreshSessionData {
  userId: string;
  fingerprint: string;
  expiresAt: number;
  createdAt: number;
  ipAddress: string;
}

/**
 * Current user sessions data structure
 */
export interface ISessionCurrentUserSessionsData {
  userId: string;
  tokenHash: string;
  deviceInfo: ITokensRequestHeaders;
  createdAt: number;
  ipAddress: string;
  encryptionData?: ISessionCurrentSessionEncryptionData;
}
