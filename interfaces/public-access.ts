/**
 * @file interfaces/public-access.ts
 * @description Generic interfaces for resource-agnostic public access system
 */

import type { HonoContext } from "@deps";
import type { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import type { DynamicColumnTable } from "@interfaces/encryption.ts";
import type { IHashingContext } from "@utils/text/index.ts";

/**
 * Base interface for any publicly accessible resource
 */
export interface PublicResource {
  id: string;
  name: string;
  type: ResourceType;
  metadata: Record<string, unknown>;
}

/**
 * Resource types that can be publicly shared
 */
export enum ResourceType {
  DOCUMENT = "document",
  FOLDER = "folder",
  IMAGE = "image",
  VIDEO = "video",
  AUDIO = "audio",
  CUSTOM = "custom",
}

/**
 * Context for validated public access requests
 */
export interface ValidatedAccessRequest {
  /** Share ID for database lookup (from query parameter) */
  shareToken: string;
  /** Share key for zero-knowledge decryption (from Share-Key header) */
  shareKey?: string;
  password?: string;
  requestContext: RequestContext;
  resourceType: ResourceType;
  /** Environment ID extracted from shareToken prefix (for tenant DB routing) */
  environmentId: string;
}

/**
 * Request context information extracted from incoming request
 */
export interface RequestContext {
  ipAddress?: string;
  userAgent?: string;
  referer?: string;
}

/**
 * Context passed to access strategies
 */
export interface AccessContext {
  context: HonoContext;
  request: ValidatedAccessRequest;
  config: ResourceConfig;
  startTime: number;
}

/**
 * Result of public share creation
 */
export interface PublicShareResult {
  shareToken: string;
  publicUri: string;
  volumeId: string;
  linkId: string;
  expiresAt?: number;
  isPasswordProtected: boolean;
  publicUrl?: string; // Optional full URL
}

/**
 * Options for creating public shares
 */
export interface PublicShareOptions {
  password?: string;
  expiresAt?: number;
  permissionLevel?: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  recipientEmail?: string;
  recipientName?: string;
  recipientLanguage?: string;
  notifyOnAccess?: boolean;
}

/**
 * Configuration for a resource type
 */
export interface ResourceConfig {
  type: ResourceType;
  baseUrlPath: string;
  serviceFactory: () => ResourceAccessService;
  encryptionContext: IHashingContext;
  responseSchema: unknown;
  permissionLevel: DB_ENUM_PERMISSION_ACCESS_LEVEL;
  /** Drizzle table reference with dynamic column access (see DynamicColumnTable) */
  tableName: DynamicColumnTable; // Database table name for the resource
  resourceIdColumn: string; // Column name for resource ID in table
}

/**
 * Generic interface for resource access services
 */
export interface ResourceAccessService {
  verifyPublicShareAccess(
    shareId: string,
    shareKey: string,
    password?: string,
    metadata?: RequestContext,
  ): Promise<{
    isValid: boolean;
    resourceId: string;
    resource: PublicResource | null;
    dataKeyId: string | null;
  }>;
}

/**
 * Strategy interface for handling different types of public access
 */
export interface ResourceAccessStrategy {
  getResourceType(): ResourceType;
  handleAccess(context: AccessContext): Promise<Response>;
  validatePermissions(userId: string, resourceId: string): Promise<boolean>;
}

/**
 * Configuration for public sharing system
 */
export interface PublicSharingConfig {
  cacheControl: {
    withPassword: string;
    withoutPassword: string;
  };
  timing: {
    authOperation: string;
  };
  security: {
    maxFailedAttempts: number;
    lockoutDuration: number;
  };
}
