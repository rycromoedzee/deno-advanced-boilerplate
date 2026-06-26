/**
 * @file services/session/index.ts
 * @description Session service exports and public API
 */
import { SESSION_SECURITY_CONFIG } from "./session.constants.ts";

// Re-export all service classes
export { SessionRateLimiter } from "./session-rate-limit.service.ts";
export { useSessionLogSecurityEvent } from "./session-security-validation.service.ts";
export { SessionCreationService } from "./session-create.service.ts";
export { SessionValidationService } from "./session-validate.service.ts";
export { SessionRevocationService } from "./session-revocation.service.ts";
export { SessionLogoutService } from "./session-logout.service.ts";
export { SessionAPIKeyCreationService, SessionAPIKeyValidationService } from "./session-api-key.service.ts";

// Re-export singleton getters from singletons.ts
export {
  getSessionApiKeyCreation,
  getSessionApiKeyValidation,
  getSessionCreateService,
  getSessionLogoutService,
  getSessionRateLimiter,
  getSessionRevocationService,
  getSessionValidationService,
} from "./singletons.ts";

// Re-export interfaces and types from interfaces folder
export type { ISessionCreateApiKeyPayload, ISessionCreateApiKeyResult, ISessionCreationResult } from "@interfaces/session.ts";

/**
 * Security configuration for session services
 */
export const SECURITY_CONFIG = SESSION_SECURITY_CONFIG;

/**
 * Authentication header naming constants
 * Re-exported from centralized http-headers constants
 */
export { AUTH_HEADER_NAMING } from "@constants/http-headers.ts";
