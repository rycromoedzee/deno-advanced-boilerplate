/**
 * @file utils/documents/security-logging.ts
 * @description Security logging utilities for detecting and logging security threats
 * Requirements: 9.10, 9.11
 */

import { loggerAppSections, LoggerLevels } from "@logger/index.ts";
import type { HonoContext } from "@deps";
import { useLogSecurityEvent } from "@services/logger/index.ts";

/**
 * SQL injection patterns to detect
 */
const SQL_INJECTION_PATTERNS = [
  /(\bUNION\b.*\bSELECT\b)/i,
  /(\bSELECT\b.*\bFROM\b)/i,
  /(\bINSERT\b.*\bINTO\b)/i,
  /(\bUPDATE\b.*\bSET\b)/i,
  /(\bDELETE\b.*\bFROM\b)/i,
  /(\bDROP\b.*\bTABLE\b)/i,
  /(\bEXEC\b|\bEXECUTE\b)/i,
  /(;.*--)/,
  /('.*OR.*'.*=.*')/i,
  /(".*OR.*".*=.*")/i,
  /(1=1|1='1'|1="1")/i,
  /(\bxp_cmdshell\b)/i,
];

/**
 * Path traversal patterns to detect
 */
const PATH_TRAVERSAL_PATTERNS = [
  /\.\.\//,
  /\.\.\\/,
  /%2e%2e%2f/i,
  /%2e%2e\\/i,
  /\.\.%2f/i,
  /\.\.%5c/i,
  /%252e%252e%252f/i,
  /\.\/%2e\./i,
];

/**
 * Checks if a string contains SQL injection patterns
 */
export function containsSQLInjection(input: string): boolean {
  return SQL_INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Checks if a string contains path traversal patterns
 */
export function containsPathTraversal(input: string): boolean {
  return PATH_TRAVERSAL_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * Logs a SQL injection attempt
 */
export async function logSQLInjectionAttempt(
  c: HonoContext,
  input: string,
  source: string,
): Promise<void> {
  const ipAddress = c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  const path = c.req.path;
  const method = c.req.method;

  await useLogSecurityEvent(
    LoggerLevels.warn,
    "SQL injection attempt detected",
    "medium",
    loggerAppSections.DOCUMENTS_FOLDERS,
    "sql_injection_attempt",
    {
      ipAddress,
      userAgent,
      path,
      method,
      source,
      input: input.substring(0, 200), // Limit logged input length
      timestamp: Date.now(),
    },
  );
}

/**
 * Logs a path traversal attempt
 */
export async function logPathTraversalAttempt(
  c: HonoContext,
  input: string,
  source: string,
): Promise<void> {
  const ipAddress = c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  const path = c.req.path;
  const method = c.req.method;

  await useLogSecurityEvent(
    LoggerLevels.warn,
    "Path traversal attempt detected",
    "medium",
    loggerAppSections.DOCUMENTS_FOLDERS,
    "path_traversal_attempt",
    {
      message: "Path traversal attempt detected",
      section: loggerAppSections.DOCUMENTS_FOLDERS,
      messageKey: "path_traversal_attempt",
      details: {
        ipAddress,
        userAgent,
        path,
        method,
        source,
        input: input.substring(0, 200), // Limit logged input length
        timestamp: Date.now(),
      },
    },
  );
}

/**
 * Logs an unauthorized access attempt
 */
export async function logUnauthorizedAccessAttempt(
  c: HonoContext,
  resourceType: string,
  resourceId: string,
  userId: string | null,
  reason: string,
): Promise<void> {
  const ipAddress = c.req.header("x-forwarded-for") ||
    c.req.header("x-real-ip") ||
    "unknown";
  const userAgent = c.req.header("user-agent") || "unknown";
  const path = c.req.path;
  const method = c.req.method;

  await useLogSecurityEvent(
    LoggerLevels.warn,
    "Unauthorized access attempt",
    "medium",
    loggerAppSections.DOCUMENTS_FOLDERS,
    "unauthorized_access_attempt",
    {
      message: "Unauthorized access attempt",
      section: loggerAppSections.DOCUMENTS_FOLDERS,
      messageKey: "unauthorized_access_attempt",
      details: {
        ipAddress,
        userAgent,
        path,
        method,
        resourceType,
        resourceId,
        userId,
        reason,
        timestamp: Date.now(),
      },
    },
  );
}

/**
 * Validates common document/folder input fields for security threats
 * This is a convenience function for validating typical document/folder data structures
 */
export async function validateDocumentInputFields(
  c: HonoContext,
  input: {
    name?: string;
    description?: string;
    tags?: string[] | string;
    metadata?: Record<string, unknown> | string;
    folderId?: string;
    parentId?: string;
  },
): Promise<boolean> {
  const inputsToValidate: Record<string, string> = {};

  if (input.name) inputsToValidate.name = input.name;
  if (input.description) inputsToValidate.description = input.description;
  if (input.folderId) inputsToValidate.folderId = input.folderId;
  if (input.parentId) inputsToValidate.parentId = input.parentId;

  // Handle tags - convert array to JSON string for validation
  if (input.tags) {
    if (Array.isArray(input.tags)) {
      inputsToValidate.tags = JSON.stringify(input.tags);
    } else {
      inputsToValidate.tags = input.tags;
    }
  }

  // Handle metadata - convert object to JSON string for validation
  if (input.metadata) {
    if (typeof input.metadata === "object") {
      inputsToValidate.metadata = JSON.stringify(input.metadata);
    } else {
      inputsToValidate.metadata = input.metadata;
    }
  }

  return await validateAndLogSecurityThreats(c, inputsToValidate);
}

/**
 * Validates input for security threats and logs if detected
 * Returns true if threats are detected, false otherwise
 */
export async function validateAndLogSecurityThreats(
  c: HonoContext,
  inputs: Record<string, string>,
): Promise<boolean> {
  let threatsDetected = false;

  for (const [source, input] of Object.entries(inputs)) {
    if (containsSQLInjection(input)) {
      await logSQLInjectionAttempt(c, input, source);
      threatsDetected = true;
    }

    if (containsPathTraversal(input)) {
      await logPathTraversalAttempt(c, input, source);
      threatsDetected = true;
    }
  }

  return threatsDetected;
}
