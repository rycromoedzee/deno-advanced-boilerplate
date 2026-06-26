/**
 * @file services/public-access/generic-public-access.handler.ts
 * @description Generic handler factory for public resource access
 */

import type { HonoContext } from "@deps";
import { PublicAccessValidator } from "./public-access.validator.ts";
import { ResourceManager } from "./resource-manager.ts";
import type { AccessContext, ResourceType } from "@interfaces/public-access.ts";
import { resolveAllowedOrigin } from "@utils/network/index.ts";
import { requestContext } from "@db/index.ts";

/**
 * Creates a generic public access handler for any resource type
 * @param resourceType - Type of resource to create handler for
 * @returns Handler function that handles public access for the resource type
 */
export const createGenericPublicAccessHandler = (resourceType: ResourceType) => {
  return async (c: HonoContext) => {
    const startTime = performance.now();

    try {
      // Get resource configuration
      const config = ResourceManager.getConfig(resourceType);

      // Validate and extract request data (includes environmentId from shareId prefix)
      const validatedRequest = await PublicAccessValidator.validateAndExtractRequest(c, config);

      // Get the appropriate strategy for this resource type
      const strategy = ResourceManager.getStrategy(resourceType);

      // Create access context for strategy
      const accessContext: AccessContext = {
        context: c,
        request: validatedRequest,
        config,
        startTime,
      };

      // Run within request context with environmentId so getTenantDB() works
      return await requestContext.run(
        {
          environmentId: validatedRequest.environmentId,
          userId: "", // No user for public access
        },
        () => strategy.handleAccess(accessContext),
      );
    } catch (error) {
      return await PublicAccessValidator.handleError(c, startTime, error);
    }
  };
};

/**
 * Creates multiple public access handlers for different resource types
 * @param resourceTypes - Array of resource types to create handlers for
 * @returns Object with handler functions for each resource type
 */
export const createMultiplePublicAccessHandlers = (
  resourceTypes: ResourceType[],
): Partial<Record<ResourceType, (c: HonoContext) => Promise<Response>>> => {
  const handlers: Partial<Record<ResourceType, (c: HonoContext) => Promise<Response>>> = {};

  for (const resourceType of resourceTypes) {
    handlers[resourceType] = createGenericPublicAccessHandler(resourceType);
  }

  return handlers;
};

/**
 * Middleware for adding common headers to public access responses
 * @param resourceType - Type of resource
 * @returns Middleware function that adds common headers
 */
export const publicAccessHeadersMiddleware = (resourceType: ResourceType) => {
  return async (c: HonoContext, next: () => Promise<void>) => {
    const _config = ResourceManager.getConfig(resourceType);

    // Add common security headers
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", "DENY");

    // Add CORS headers if needed
    const origin = c.req.header("Origin");
    const allowedOrigin = resolveAllowedOrigin(origin);
    if (allowedOrigin) {
      c.header("Access-Control-Allow-Origin", allowedOrigin);
      c.header("Vary", "Origin");
      c.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
    }

    await next();
  };
};
