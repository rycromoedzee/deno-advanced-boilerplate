/**
 * @file services/public-access/public-share.creator.ts
 * @description Generic creator for public shares across all resource types
 */

import { DB_ENUM_PERMISSION_ACCESS_LEVEL } from "@db/enums/index.ts";
import { envConfig } from "@config/env.ts";
import { getTimeNow } from "@utils/shared/time.ts";
import { DataAccessService } from "@services/encryption/index.ts";
import { PublicSharingService } from "@services/public-sharing/public-sharing.service.ts";
import type { PublicShareOptions, PublicShareResult, ResourceType } from "@interfaces/public-access.ts";
import type { HonoContext } from "@deps";
import { ResourceManager } from "./resource-manager.ts";
import { requestContext } from "@db/index.ts";

/**
 * Generic creator for public shares
 * Handles share creation for any resource type with consistent behavior
 */
export class PublicShareCreator {
  /**
   * Creates a public share for any resource type
   * @param resourceType - Type of resource to share
   * @param resourceId - ID of resource to share
   * @param options - Options for public share
   * @param userId - ID of user creating the share
   * @param context - Hono context for encryption key access
   * @returns Public share result with token and URLs
   */
  static async createPublicShare(
    resourceType: ResourceType,
    resourceId: string,
    options: PublicShareOptions,
    userId: string,
    context: HonoContext,
  ): Promise<PublicShareResult> {
    // Get resource-specific configuration
    const config = ResourceManager.getConfig(resourceType);

    // Get encryption key for the user
    const encryptionKey = await DataAccessService.getEncryptionKeyForDataMasterKey(context);

    // Prepare share configuration
    const shareConfig = {
      password: options.password,
      expiresAt: options.expiresAt,
      permissionLevel: options.permissionLevel || DB_ENUM_PERMISSION_ACCESS_LEVEL.READ,
      recipientEmail: options.recipientEmail,
      recipientName: options.recipientName,
      recipientLanguage: options.recipientLanguage || "en",
      notifyOnAccess: options.notifyOnAccess || false,
    };

    // Create share using generic PublicSharingService
    const publicSharingService = new PublicSharingService({
      tableName: config.tableName,
      resourceIdColumn: config.resourceIdColumn,
    });

    // Get environmentId from request context for tenant DB routing
    const environmentId = requestContext.getStore()?.environmentId;

    const result = await publicSharingService.createPublicShare(
      resourceId,
      userId,
      shareConfig,
      config.encryptionContext,
      encryptionKey.key,
      environmentId,
    );

    // Build public URL using resource-specific configuration
    const publicUrl = this.buildPublicShareUrl(result.publicUri, config.baseUrlPath);

    return {
      ...result,
      publicUrl,
      expiresAt: result.expiresAt || undefined, // Ensure type compatibility
    };
  }

  /**
   * Builds a public share URL based on resource configuration
   * @param publicUri - URI from secure link generator
   * @param baseUrlPath - Base path for resource type
   * @returns Complete public share URL
   */
  static buildPublicShareUrl(publicUri: string, baseUrlPath: string): string {
    const protocol = envConfig.public.frontURL.startsWith("http") ? "" : "https://";
    return `${protocol}${envConfig.public.frontURL}${baseUrlPath}${publicUri}`;
  }

  /**
   * Creates multiple public shares for different resource types
   * @param shares - Array of share requests
   * @param context - Hono context for encryption key access
   * @returns Array of public share results
   */
  static async createMultiplePublicShares(
    shares: Array<{
      resourceType: ResourceType;
      resourceId: string;
      options: PublicShareOptions;
      userId: string;
    }>,
    context: HonoContext,
  ): Promise<PublicShareResult[]> {
    const results = await Promise.allSettled(
      shares.map((share) =>
        this.createPublicShare(
          share.resourceType,
          share.resourceId,
          share.options,
          share.userId,
          context,
        )
      ),
    );

    return results
      .filter((result) => result.status === "fulfilled")
      .map((result) => (result as PromiseFulfilledResult<PublicShareResult>).value);
  }

  /**
   * Validates public share options
   * @param options - Options to validate
   * @returns True if options are valid
   */
  static validateShareOptions(options: PublicShareOptions): boolean {
    // Check expiration date if provided
    if (options.expiresAt && options.expiresAt < getTimeNow()) {
      return false;
    }

    // Check password complexity if provided
    if (options.password && options.password.length < 8) {
      return false;
    }

    return true;
  }
}
