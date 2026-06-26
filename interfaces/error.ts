/**
 * @file interfaces/error.ts
 * @description Shared error type definitions
 */
/**
 * Error handling types and interfaces
 */

/**
 * Error severity levels
 */
export enum ErrorSeverity {
  LOW = "low",
  MEDIUM = "medium",
  HIGH = "high",
  CRITICAL = "critical",
}

/**
 * Error categories for monitoring and alerting
 */
export enum ErrorCategory {
  AUTHENTICATION = "authentication",
  AUTHORIZATION = "authorization",
  VALIDATION = "validation",
  DATABASE = "database",
  EXTERNAL_SERVICE = "external_service",
  RATE_LIMITING = "rate_limiting",
  ENCRYPTION = "encryption",
  BUSINESS_LOGIC = "business_logic",
  SYSTEM = "system",
}
