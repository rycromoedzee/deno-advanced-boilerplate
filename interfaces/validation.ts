/**
 * @file interfaces/validation.ts
 * @description Input validation service interfaces
 * These interfaces define the structure for validation operations and configurations
 */

import { ValidationResult } from "@utils/shared/types.ts";

/**
 * Schema definition for input validation
 */
export interface IValidationSchema<T = unknown> {
  type: "string" | "number" | "object" | "array" | "boolean";
  required?: boolean;
  maxLength?: number;
  minLength?: number;
  pattern?: RegExp;
  sanitize?: boolean;
  allowedValues?: T[];
  customValidator?: (value: unknown) => ValidationResult;
}

/**
 * Configuration for HTML sanitization
 */
export interface IValidationSanitizationOptions {
  allowedTags?: string[];
  allowedAttributes?: Record<string, string[]>;
  stripScripts?: boolean;
  stripEvents?: boolean;
}

/**
 * File upload restrictions
 */
export interface IValidationFileRestrictions {
  maxSize: number;
  allowedTypes: string[];
  allowedExtensions: string[];
  scanForMalware?: boolean;
}

/**
 * Result of input validation operation
 */
export interface IValidationResult<T = unknown> {
  isValid: boolean;
  data?: T;
  errors: string[];
  warnings: string[];
  sanitized?: T;
  riskScore: number;
  detectedThreats: string[];
}
