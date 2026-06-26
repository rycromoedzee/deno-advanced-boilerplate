/**
 * @file utils/shared/types.ts
 * @description Shared types for shared utilities
 */
export interface ValidationResult {
  isValid: boolean;
  errors: string[];
  sanitized?: string;
}

export interface RequestContext {
  ip: string;
  userAgent: string;
  timestamp: Date;
  headers: Record<string, string>;
}
