/**
 * @file services/token/index.ts
 * @description Barrel exports for token services
 */
export { TokenHelperService } from "./token-helper.service.ts";
export { encodeTokenBytes, generateRefreshTokenBytes, JWTAuthTokenCreateFingerprint, tokenHashString } from "./token-utils.ts";
// Legacy export - renamed to generateSecureResetToken but keeping for backwards compatibility
export { generateJwtResetToken, generateSecureResetToken } from "./token.service.ts";

import { TokenHelperService } from "./token-helper.service.ts";

// Singleton instance and initialization state
let tokenHelperInstance: TokenHelperService | null = null;
let initializationError: Error | null = null;

/**
 * Gets the singleton instance of TokenHelperService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 *
 * This implementation uses a synchronous initialization pattern that is safe
 * for concurrent access in JavaScript's single-threaded event loop.
 *
 * @returns TokenHelperService The singleton instance
 * @throws Error If initialization fails
 */
export function getTokenHelperService(): TokenHelperService {
  // Return cached instance if available
  if (tokenHelperInstance) {
    return tokenHelperInstance;
  }

  // Re-throw previous initialization error to maintain consistent behavior
  if (initializationError) {
    throw initializationError;
  }

  // Attempt initialization
  try {
    tokenHelperInstance = new TokenHelperService();
    return tokenHelperInstance;
  } catch (error) {
    // Store error for consistent re-throwing on subsequent calls
    initializationError = new Error(
      `Failed to initialize TokenHelperService: ${error instanceof Error ? error.message : "Unknown error"}`,
    );
    throw initializationError;
  }
}

export * from "./config.ts";

/**
 * Test utility function to reset singleton instances.
 * This should only be used in test environments.
 * @internal
 */
export function resetTokenSingletons(): void {
  tokenHelperInstance = null;
  initializationError = null;
}
