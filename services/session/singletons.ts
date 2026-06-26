/**
 * @file services/session/singletons.ts
 * @description Singleton instances and getters for session services
 */
import { SessionValidationService } from "./session-validate.service.ts";
import { SessionRateLimiter } from "./session-rate-limit.service.ts";
import { SessionAPIKeyCreationService, SessionAPIKeyValidationService } from "./session-api-key.service.ts";
import { SessionCreationService } from "./session-create.service.ts";
import { SessionLogoutService } from "./session-logout.service.ts";
import { SessionRevocationService } from "./session-revocation.service.ts";

/**
 * Singleton instances for session services
 */
let apiKeyValidationService: SessionAPIKeyValidationService | null = null;
let apiKeyCreationService: SessionAPIKeyCreationService | null = null;
let sessionValidationService: SessionValidationService | null = null;
let sessionCreateService: SessionCreationService | null = null;
let sessionLogoutService: SessionLogoutService | null = null;
let sessionRevocationService: SessionRevocationService | null = null;
let sessionRateLimiterInstance: SessionRateLimiter | null = null;

/**
 * Gets the singleton instance of SessionCreationService.
 * Creates a new instance on the first call and reuses it for later calls.
 * @returns SessionCreationService The singleton instance
 */
export function getSessionCreateService(): SessionCreationService {
  if (!sessionCreateService) {
    sessionCreateService = new SessionCreationService();
  }
  return sessionCreateService;
}

/**
 * Gets the singleton instance of SessionRateLimiter.
 * Creates a new instance on the first call and reuses it for later calls.
 * @returns SessionRateLimiter The singleton instance
 */
export function getSessionRateLimiter(): SessionRateLimiter {
  if (!sessionRateLimiterInstance) {
    sessionRateLimiterInstance = new SessionRateLimiter();
  }
  return sessionRateLimiterInstance;
}

/**
 * Gets the singleton instance of SessionAPIKeyValidationService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns SessionAPIKeyValidationService The singleton instance
 */
export function getSessionApiKeyValidation(): SessionAPIKeyValidationService {
  if (!apiKeyValidationService) {
    apiKeyValidationService = new SessionAPIKeyValidationService();
  }
  return apiKeyValidationService;
}

/**
 * Gets the singleton instance of SessionAPIKeyCreationService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns SessionAPIKeyCreationService The singleton instance
 */
export function getSessionApiKeyCreation(): SessionAPIKeyCreationService {
  if (!apiKeyCreationService) {
    apiKeyCreationService = new SessionAPIKeyCreationService();
  }
  return apiKeyCreationService;
}

/**
 * Gets the singleton instance of SessionValidationService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns SessionValidationService The singleton instance
 */
export function getSessionValidationService(): SessionValidationService {
  if (!sessionValidationService) {
    sessionValidationService = new SessionValidationService();
  }
  return sessionValidationService;
}

/**
 * Gets the singleton instance of SessionLogoutService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns SessionLogoutService The singleton instance
 */
export function getSessionLogoutService(): SessionLogoutService {
  if (!sessionLogoutService) {
    sessionLogoutService = new SessionLogoutService();
  }
  return sessionLogoutService;
}

/**
 * Gets the singleton instance of SessionRevocationService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns SessionRevocationService The singleton instance
 */
export function getSessionRevocationService(): SessionRevocationService {
  if (!sessionRevocationService) {
    sessionRevocationService = new SessionRevocationService();
  }
  return sessionRevocationService;
}
