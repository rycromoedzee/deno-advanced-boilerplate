/**
 * @file services/logger/types.ts
 * @description Shared types for logger services
 */
/**
 * Enhanced logging interfaces for structured logging
 */

// Import and re-export LogContext from shared location to avoid circular dependencies
import type { LogContext } from "@interfaces/context.ts";
export type { LogContext };

export interface LogEntry {
  level: LoggerLevels;
  message: string;
  section: loggerAppSections;
  messageKey: string;
  details?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  raw?: unknown;
  timestamp: string;
  correlationId?: string;
  requestId?: string;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  instanceId?: string;
}

// LogContext moved to @interfaces/context.ts to avoid circular dependencies

// =====================
// Utility Type & Helpers
// =====================
export interface LoggerOptions {
  message: string;
  section: loggerAppSections;
  messageKey: string;
  details?: Record<string, unknown>;
  meta?: Record<string, unknown>;
  raw?: unknown;
  context?: LogContext;
}

export enum loggerAppSections {
  "NOTIFICATION_CONFIG" = "NOTIFICATION_CONFIG",
  "NOTIFICATIONS" = "NOTIFICATIONS",
  "USER" = "USER",
  "ENV_CONFIG_USER" = "ENV_CONFIG_USER",
  "PASSWORD" = "PASSWORD",
  "EMAIL" = "EMAIL",
  "EMAIL_WEBHOOK" = "EMAIL_WEBHOOK",
  "PASSKEYS" = "PASSKEYS",
  "AUTH" = "AUTH",
  "JWT" = "JWT",
  "BACKUP" = "BACKUP",
  "TOKEN" = "TOKEN",
  "SESSION" = "SESSION",
  "INTERNAL" = "INTERNAL",
  "DEBUG" = "DEBUG",
  "USER_ENCRYPTED" = "USER_ENCRYPTED",
  "SECURITY_DASHBOARD" = "SECURITY_DASHBOARD",
  "THREAT_INTELLIGENCE" = "THREAT_INTELLIGENCE",
  "CSP" = "CSP",
  "PUBLIC_SHARE" = "PUBLIC_SHARE",
  "DOCUMENTS" = "DOCUMENTS",
  "DOCUMENTS_FOLDERS" = "DOCUMENTS_FOLDERS",
  "DOCUMENTS_DOWNLOAD" = "DOCUMENTS_DOWNLOAD",
  "DOCUMENTS_STREAM" = "DOCUMENTS_STREAM",
  "DOCUMENTS_UPLOAD" = "DOCUMENTS_UPLOAD",
  "STORAGE" = "STORAGE",
  "ENCRYPTION" = "ENCRYPTION",
  "NOTES" = "NOTES",
  "TRACING" = "TRACING",
  "LOG_TRACE" = "LOG_TRACE",
}

export enum LoggerLevels {
  "info" = "info",
  "warn" = "warn",
  "trace" = "trace",
  "error" = "error",
  "debug" = "debug",
  "critical" = "critical",
}
