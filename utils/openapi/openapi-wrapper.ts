/**
 * @file utils/openapi/openapi-wrapper.ts
 * @description OpenAPIHono app/rate-limit wrapper helpers
 */
import type { HonoContext, RouteConfig } from "@deps";
import { OpenAPIHono, z } from "@deps";
import { rateLimit } from "@middleware/rate-limit.middleware.ts";
import { envConfig } from "@config/env.ts";
import { AppHttpException } from "@utils/http-exception.ts";
import { parseMessageKey } from "@utils/validation/zod-message-key.ts";

// Simple type definition to avoid importing the complex middleware
export type RateLimitOptions = {
  max: number;
  window: number;
  blockDuration?: number;
  skip?: (c: HonoContext) => boolean | Promise<boolean>;
  enableIPBasedAdjustment?: boolean;
  suspiciousIPMultiplier?: number;
  keyPrefix?: string;
  keyGenerator?: (c: HonoContext) => string | Promise<string>;
};

/**
 * Default hook for all OpenAPIHono instances.
 * Intercepts Zod validation failures and throws AppHttpException
 * with a parsed messageKey from the error message.
 *
 * This ensures all validation errors include a messageKey for i18n.
 */
export const zodValidationHook = (
  result: { target: string; success: boolean; error?: z.ZodError; data?: unknown },
  _c: HonoContext,
): void => {
  if (!result.success && result.error) {
    const issue = result.error.issues[0];
    const { messageKey, message } = parseMessageKey(issue.message);

    throw new AppHttpException(400, {
      message,
      messageKey,
    });
  }
};

/**
 * Enhanced OpenAPIHono class with rate limiting support
 */
export class RateLimitedOpenAPIHono extends OpenAPIHono {
  /**
   * Register an OpenAPI route with optional rate limiting
   */
  openapiWithRateLimit<T extends RouteConfig, H = unknown>(
    route: T,
    handler: H,
    rateLimitOptions?: RateLimitOptions,
  ): RateLimitedOpenAPIHono {
    // Check if rate limiting is globally enabled and options are provided
    if (envConfig.rateLimit.enabled && rateLimitOptions) {
      const rateLimitMiddleware = rateLimit(rateLimitOptions);

      // Wrap the handler to include rate limiting
      const wrappedHandler = async (c: HonoContext) => {
        // Execute rate limit middleware first
        let shouldProceed = false;
        const middlewareResult = await rateLimitMiddleware(c, () => {
          shouldProceed = true;
          return Promise.resolve();
        });

        // If middleware returned a response (rate limit exceeded), return it
        if (middlewareResult !== undefined) {
          return middlewareResult;
        }

        // If middleware called next(), proceed with the actual handler
        if (shouldProceed) {
          // @ts-expect-error - Handler type flexibility
          return await handler(c);
        }
      };

      // Use the parent's openapi method with wrapped handler
      // @ts-expect-error - Accessing parent class method
      this.openapi(route, wrappedHandler);
    } else {
      // Use the parent's openapi method without rate limiting
      // (either disabled globally or no rate limit options provided)
      // @ts-expect-error - Accessing parent class method
      this.openapi(route, handler);
    }

    return this;
  }
}

/**
 * Factory function to create a RateLimitedOpenAPIHono instance
 * with the zodValidationHook pre-configured.
 */
export function createRateLimitedApp(
  options?: Omit<ConstructorParameters<typeof OpenAPIHono>[0], "defaultHook">,
) {
  return new RateLimitedOpenAPIHono({
    ...options,
    defaultHook: zodValidationHook,
  });
}
