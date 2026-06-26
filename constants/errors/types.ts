/**
 * @file constants/errors/types.ts
 * @description Shared types for error message constants (category, shape)
 */
/**
 * Shared types for error definitions across all error modules
 */

export interface ErrorDefinition {
  message: string;
  messageKey: string;
  statusCode: number;
}

export interface ErrorCategory {
  [key: string]: ErrorDefinition;
}
