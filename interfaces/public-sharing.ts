/**
 * @file interfaces/public-sharing.ts
 * @description Public sharing service interfaces
 * Separated from encryption interfaces for better organization
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";

/**
 * Public sharing configuration interface
 */
export interface PublicShareConfig {
  /** Optional recipient email address */
  recipientEmail?: string;
  /** Optional recipient name */
  recipientName?: string;
  /** Optional recipient language preference */
  recipientLanguage?: string;
  /** Optional password for password-protected shares */
  password?: string | null;
  /** Permission level for the public share */
  permissionLevel?: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  /** Optional expiration timestamp */
  expiresAt?: number | null;
  /** Whether to notify on access */
  notifyOnAccess?: boolean;
}

/**
 * Public share result interface
 */
export interface PublicShareResult {
  /** Unique share token for public access */
  shareToken: string;
  /** Share expiration timestamp (if any) */
  expiresAt?: number | null;
  /** Whether the share is password protected */
  isPasswordProtected: boolean;
}

/**
 * Extended public share result with secure link components
 */
export interface ExtendedPublicShareResult extends PublicShareResult {
  /** Complete shareable URI */
  publicUri: string;
  /** Raw volume identifier (base64url-encoded, not URL-encoded) */
  volumeId: string;
  /** Raw link identifier (base64url-encoded, not URL-encoded) */
  linkId: string;
}

/**
 * Public share information interface
 */
export interface PublicShareInfo {
  resourceId: string;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  isPasswordProtected: boolean;
  expiresAt?: number | null;
  recipientEmail?: string;
  recipientName?: string;
  recipientLanguage?: string;
}
