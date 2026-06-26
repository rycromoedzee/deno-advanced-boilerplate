/**
 * @file constants/http-headers.ts
 * @description Centralized HTTP header constants
 *
 * Per RFC 6648, custom headers should NOT use the 'X-' prefix.
 * https://datatracker.ietf.org/doc/html/rfc6648
 */

/**
 * Custom HTTP headers used by the application
 */
export const HTTP_HEADERS = {
  /**
   * Header for passing the share key from frontend to backend
   * for zero-knowledge public sharing.
   *
   * The share key is extracted from the URL fragment (#) by the frontend
   * and passed to the server via this header. It is never stored in the
   * database or logged.
   */
  SHARE_KEY: "Share-Key",

  /**
   * Standard headers used throughout the application
   */
  CONTENT_TYPE: "Content-Type",
  AUTHORIZATION: "Authorization",
  CONTENT_LENGTH: "Content-Length",
  CONTENT_DISPOSITION: "Content-Disposition",
  CONTENT_RANGE: "Content-Range",
  ACCEPT_RANGES: "Accept-Ranges",
  CACHE_CONTROL: "Cache-Control",
  RANGE: "Range",

  /**
   * Custom application headers
   */
  CSRF_TOKEN: "CSRF-Token",
  API_KEY: "Api-Key",
  CORRELATION_ID: "Correlation-ID",
  REQUEST_ID: "Request-ID",
  ADMIN_TOKEN: "Admin-Token",
  TRACE_ID: "Trace-ID",
  ROOT_SPAN_ID: "Root-Span-ID",
} as const;

/**
 * Authentication header naming constants
 * Used for cookies and internal context variables
 */
export const AUTH_HEADER_NAMING = {
  access: "access_token",
  refresh: "refresh_token",
  /**
   * Ephemeral session key cookie for client-bound cache encryption.
   * Generated at login, rotated at each token refresh.
   * Never stored server-side — the cache-encrypted derived key can only be
   * decrypted while this cookie is present in the request.
   */
  sessionKey: "session_key",
  api: "Api-Key",
  internalToolAccess: "Api-Auth",
  internalUsageAuthUserIdDetails: "Auth-User-Details",
  internalUsageAuthUserEnvironmentIdDetails: "Auth-User-Environment-Details",
  internalUsageAuthApiKeyDetails: "Auth-API-Key-Details",
  // User context for audit trails and authorization
  internalUsageAuthUserIsAdmin: "Auth-User-IsAdmin",
  internalUsageAuthUserFirstName: "Auth-User-FirstName",
  internalUsageAuthUserLastName: "Auth-User-LastName",
  // Internal context key for session key (passed via Hono context, not HTTP header)
  internalSessionKey: "Internal-Session-Key",
  // Internal context for the auth middleware's validated JWT session, threaded
  // so the encryption-key path can reuse it instead of re-running
  // validateJWTSession. Contains encryption-derived keys — SENSITIVE: set only
  // by the auth middleware post-validation, never logged/traced/serialized.
  internalValidatedSession: "Internal-Validated-Session",
} as const;

/**
 * Headers that should be allowed in CORS preflight requests
 */
export const CORS_ALLOW_HEADERS = [
  HTTP_HEADERS.CONTENT_TYPE,
  HTTP_HEADERS.AUTHORIZATION,
  HTTP_HEADERS.CSRF_TOKEN,
  HTTP_HEADERS.API_KEY,
  HTTP_HEADERS.CORRELATION_ID,
  HTTP_HEADERS.REQUEST_ID,
  HTTP_HEADERS.ADMIN_TOKEN,
  HTTP_HEADERS.TRACE_ID,
  HTTP_HEADERS.ROOT_SPAN_ID,
  HTTP_HEADERS.RANGE,
  HTTP_HEADERS.SHARE_KEY,
] as const;

/**
 * Headers that should be exposed to the client via CORS
 */
export const CORS_EXPOSE_HEADERS = [
  HTTP_HEADERS.CSRF_TOKEN,
  HTTP_HEADERS.CORRELATION_ID,
  HTTP_HEADERS.REQUEST_ID,
  HTTP_HEADERS.TRACE_ID,
  HTTP_HEADERS.ROOT_SPAN_ID,
  HTTP_HEADERS.CONTENT_DISPOSITION,
  HTTP_HEADERS.CONTENT_RANGE,
  HTTP_HEADERS.ACCEPT_RANGES,
] as const;
