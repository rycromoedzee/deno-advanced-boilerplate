/**
 * @file interfaces/context.ts
 * @description Shared request/context types kept import-free to avoid cycles
 */
/**
 * Shared Context Types
 *
 * Common context types used across the application.
 * These are kept in a separate file with NO imports to avoid circular dependencies.
 */

/**
 * Base context information passed through the application
 * Used by both logging and tracing systems
 */
export interface LogContext {
  correlationId?: string;
  requestId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  sessionId?: string;
  parentCorrelationId?: string;
  instanceId?: string;
}
