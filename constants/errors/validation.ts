/**
 * @file constants/errors/validation.ts
 * @description Validation error message constants
 */
/**
 * Input Validation Error Constants
 */

import type { ErrorCategory } from "./types.ts";

/**
 * Input Validation Errors
 */
export const VALIDATION_ERRORS = {
  REQUIRED_FIELD_MISSING: {
    message: "Required field is missing",
    messageKey: "validation.required-field-missing",
    statusCode: 400,
  },
  INVALID_FORMAT: {
    message: "Invalid format provided",
    messageKey: "validation.invalid-format",
    statusCode: 400,
  },
  VALUE_TOO_SHORT: {
    message: "Value is too short",
    messageKey: "validation.value-too-short",
    statusCode: 400,
  },
  VALUE_TOO_LONG: {
    message: "Value is too long",
    messageKey: "validation.value-too-long",
    statusCode: 400,
  },
  INVALID_EMAIL: {
    message: "Invalid email address format",
    messageKey: "validation.invalid-email",
    statusCode: 400,
  },
  INVALID_URL: {
    message: "Invalid URL format",
    messageKey: "validation.invalid-url",
    statusCode: 400,
  },
  INVALID_DATE: {
    message: "Invalid date format",
    messageKey: "validation.invalid-date",
    statusCode: 400,
  },
  INVALID_NUMBER: {
    message: "Invalid number format",
    messageKey: "validation.invalid-number",
    statusCode: 400,
  },
  VALUE_OUT_OF_RANGE: {
    message: "Value is out of acceptable range",
    messageKey: "validation.value-out-of-range",
    statusCode: 400,
  },
  INVALID_ENUM_VALUE: {
    message: "Invalid enum value provided",
    messageKey: "validation.invalid-enum-value",
    statusCode: 400,
  },
  SCHEMA_VALIDATION_FAILED: {
    message: "Schema validation failed",
    messageKey: "validation.schema-validation-failed",
    statusCode: 400,
  },
  DUPLICATE_VALUE: {
    message: "Duplicate value not allowed",
    messageKey: "validation.duplicate-value",
    statusCode: 409,
  },
  INVALID_JSON: {
    message: "Invalid JSON format",
    messageKey: "validation.invalid-json",
    statusCode: 400,
  },
  MALFORMED_REQUEST: {
    message: "Malformed request body",
    messageKey: "validation.malformed-request",
    statusCode: 400,
  },
} as const satisfies ErrorCategory;

export type ValidationErrorKey = keyof typeof VALIDATION_ERRORS;
