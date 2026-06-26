/**
 * @file services/session/session.constants.ts
 * @description Session service module (session)
 */
/**
 * Shared security configuration for session-related services.
 * Keeping this in a dedicated module avoids duplicated definitions.
 */
export const SESSION_SECURITY_CONFIG = {
  RATE_LIMITS_TTL: {
    SESSION_CREATION: {
      MAX_ATTEMPTS: 10,
      WINDOW_SECONDS: 15 * 60,
      BLOCK_DURATION_SECONDS: 30 * 60,
    },
    API_KEY_CREATION: {
      MAX_ATTEMPTS: 5,
      WINDOW_SECONDS: 60 * 60,
      BLOCK_DURATION_SECONDS: 2 * 60 * 60,
    },
    API_KEY_VALIDATION_FAILURES: {
      MAX_ATTEMPTS: 20,
      WINDOW_SECONDS: 60 * 60,
      BLOCK_DURATION_SECONDS: 2 * 60 * 60,
    },
    VALIDATION_FAILURES: {
      MAX_ATTEMPTS: 20,
      WINDOW_SECONDS: 10 * 60,
      BLOCK_DURATION_SECONDS: 60 * 60,
    },
  },
  INPUT_VALIDATION: {
    MAX_STRING_LENGTH: 1000,
    MAX_ARRAY_LENGTH: 100,
    ALLOWED_IP_FORMATS: ["ipv4", "ipv6", "cidr"],
    ALLOWED_DOMAIN_PATTERNS: ["standard", "wildcard"],
    MAX_DEVICE_INFO_LENGTH: 2000,
  },
  SECURITY_HEADERS: {
    MAX_USER_AGENT_LENGTH: 500,
    MAX_ACCEPT_LENGTH: 200,
    MAX_LANG_LENGTH: 50,
  },
} as const;

export const MAX_ACTIVE_SESSIONS = 50;
export const REVOCATION_CHALLENGE_WINDOW_MS = 30 * 1000;
