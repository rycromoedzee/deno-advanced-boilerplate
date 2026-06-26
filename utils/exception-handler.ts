/**
 * @file utils/exception-handler.ts
 * @description HTTP exception handling helpers
 */
/**
 * Exception handling utilities for consistent error handling across services
 *
 * This module provides helper functions to standardize exception handling patterns,
 * ensuring that intentional HTTP exceptions propagate with their specific status codes
 * while unexpected errors are properly logged and converted to 500 responses.
 */

import { AppHttpException } from "./http-exception.ts";
import { envConfig } from "@config/env.ts";
import { type AllErrorKeys, getErrorDefinition } from "@constants/errors/index.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { Span } from "@interfaces/tracing.ts";

/**
 * Context information for error logging
 */
export interface ServiceErrorContext {
  /** Service class name (e.g., "SessionCreationService") */
  service: string;
  /** Method name (e.g., "createUserSession") */
  method: string;
  /** Logger section for categorization */
  section: loggerAppSections;
  /** Additional context details for logging */
  details?: Record<string, unknown>;
}

/**
 * Optional overrides for error logging.
 */
export interface ServiceErrorLogOverrides {
  /** Custom log message */
  message?: string;
  /** Custom message key */
  messageKey?: string;
  /** Additional details to merge into log context */
  details?: Record<string, unknown>;
}

/** Log overrides can be a static object or a factory function receiving the caught error */
export type ServiceErrorLogOverridesOrFactory =
  | ServiceErrorLogOverrides
  | ((error: unknown) => ServiceErrorLogOverrides);

function buildLogDetails(
  context: ServiceErrorContext,
  overrides?: ServiceErrorLogOverrides,
): Record<string, unknown> {
  return {
    service: context.service,
    method: context.method,
    ...context.details,
    ...overrides?.details,
  };
}

function getLogMessage(
  context: ServiceErrorContext,
  overrides?: ServiceErrorLogOverrides,
): string {
  return overrides?.message ?? `Unexpected error in ${context.service}.${context.method}`;
}

function getLogMessageKey(
  context: ServiceErrorContext,
  overrides?: ServiceErrorLogOverrides,
): string {
  return overrides?.messageKey ??
    `${context.service.toLowerCase()}.${context.method}.unexpected_error`;
}

/**
 * Handles caught errors by re-throwing AppHttpException instances
 * and converting unexpected errors to 500 responses with proper logging.
 *
 * This function implements the standard error handling pattern:
 * 1. Re-throw intentional HTTP exceptions (AppHttpException) immediately
 * 2. Log unexpected errors with structured logging
 * 3. Convert unexpected errors to 500 Internal Server Error
 *
 * @param error - The caught error to handle
 * @param context - Context information for logging
 * @param fallbackErrorKey - Error key from constants to use for 500 response (e.g., 'COMMON.INTERNAL_SERVER_ERROR')
 * @param logOverrides - Optional overrides for log message/messageKey/details
 * @throws AppHttpException - Always throws, either the original HTTP exception or a new 500 error
 */
function resolveLogOverrides(
  error: unknown,
  logOverrides?: ServiceErrorLogOverridesOrFactory,
): ServiceErrorLogOverrides | undefined {
  if (typeof logOverrides === "function") return logOverrides(error);
  return logOverrides;
}

/**
 * Build and throw an AppHttpException for the given error key, with the
 * "already-logged" marker set. Used by `handleServiceError*` so that outer
 * service boundaries (also using `tracedWithServiceErrorHandling`) skip
 * re-logging the same failure.
 */
function throwServiceError(
  errorKey: AllErrorKeys,
  causeReason?: unknown,
): never {
  const cause = envConfig.isProduction ? undefined : causeReason;
  let def;
  try {
    def = getErrorDefinition(errorKey);
  } catch (lookupError) {
    console.error(
      `[handleServiceError] Unknown error key "${errorKey}" — falling back to COMMON.INTERNAL_SERVER_ERROR`,
      lookupError,
    );
    def = getErrorDefinition("COMMON.INTERNAL_SERVER_ERROR");
  }

  const wrapped = new AppHttpException(def.statusCode, {
    message: def.message,
    messageKey: def.messageKey,
    cause,
  });
  wrapped._serviceErrorLogged = true;
  throw wrapped;
}

export function handleServiceError(
  error: unknown,
  context: ServiceErrorContext,
  fallbackErrorKey: AllErrorKeys,
  logOverrides?: ServiceErrorLogOverridesOrFactory,
): never {
  if (error instanceof AppHttpException) {
    // Log 5xx errors before re-throwing — they indicate backend failures that need visibility.
    // Skip if the error was already logged by an inner service boundary
    // (marked via AppHttpException._serviceErrorLogged) so nested calls
    // (e.g. PublicSharingService → NotePublicShare) don't emit two ERROR
    // events for a single failure.
    if (error.status >= 500 && !error._serviceErrorLogged) {
      useLogger(LoggerLevels.error, {
        message: getLogMessage(context, undefined),
        messageKey: getLogMessageKey(context, undefined),
        section: context.section,
        details: {
          ...buildLogDetails(context, undefined),
          httpStatusCode: error.status,
          errorMessageKey: error.messageKey,
        },
        raw: error,
      });
    }
    throw error;
  }

  const resolved = resolveLogOverrides(error, logOverrides);

  // Log unexpected errors with structured logging
  useLogger(LoggerLevels.error, {
    message: getLogMessage(context, resolved),
    messageKey: getLogMessageKey(context, resolved),
    section: context.section,
    details: buildLogDetails(context, resolved),
    raw: error,
  });

  throwServiceError(fallbackErrorKey, error);
}

/**
 * Async variant of handleServiceError that supports running custom logic
 * for unexpected errors (e.g., security event logging).
 *
 * @param error - The caught error to handle
 * @param context - Context information for logging
 * @param fallbackErrorKey - Error key from constants to use for 500 response
 * @param logOverrides - Optional overrides for log message/messageKey/details
 * @param onUnexpected - Optional hook for additional async work on unexpected errors
 * @throws AppHttpException - Always throws, either the original HTTP exception or a new 500 error
 */
export async function handleServiceErrorAsync(
  error: unknown,
  context: ServiceErrorContext,
  fallbackErrorKey: AllErrorKeys,
  logOverrides?: ServiceErrorLogOverridesOrFactory,
  onUnexpected?: (error: unknown) => void | Promise<void>,
): Promise<never> {
  if (error instanceof AppHttpException) {
    // Log 5xx errors before re-throwing — they indicate backend failures that need visibility.
    // Skip if the error was already logged by an inner service boundary
    // (marked via AppHttpException._serviceErrorLogged) so nested calls
    // (e.g. PublicSharingService → NotePublicShare) don't emit two ERROR
    // events for a single failure.
    if (error.status >= 500 && !error._serviceErrorLogged) {
      useLogger(LoggerLevels.error, {
        message: getLogMessage(context, undefined),
        messageKey: getLogMessageKey(context, undefined),
        section: context.section,
        details: {
          ...buildLogDetails(context, undefined),
          httpStatusCode: error.status,
          errorMessageKey: error.messageKey,
        },
        raw: error,
      });
    }
    throw error;
  }

  const resolved = resolveLogOverrides(error, logOverrides);

  useLogger(LoggerLevels.error, {
    message: getLogMessage(context, resolved),
    messageKey: getLogMessageKey(context, resolved),
    section: context.section,
    details: buildLogDetails(context, resolved),
    raw: error,
  });

  if (onUnexpected) {
    try {
      await onUnexpected(error);
    } catch (hookError) {
      console.error("Failed to run error hook:", hookError);
    }
  }

  throwServiceError(fallbackErrorKey, error);
}

/**
 * Traced wrapper that includes standard error handling.
 *
 * This combines span lifecycle management with the default error handling
 * pattern to keep service methods consistent and concise.
 */
export async function tracedWithServiceErrorHandling<T>(
  spanName: string,
  context: ServiceErrorContext,
  fallbackErrorKey: AllErrorKeys,
  operation: (span: Span) => Promise<T>,
  options?: {
    attributes?: Record<string, unknown>;
    logOverrides?: ServiceErrorLogOverridesOrFactory;
    onUnexpected?: (error: unknown) => void | Promise<void>;
  },
): Promise<T> {
  return await traced(
    spanName,
    "service",
    async (span) => {
      try {
        return await operation(span);
      } catch (error) {
        return await handleServiceErrorAsync(
          error,
          context,
          fallbackErrorKey,
          options?.logOverrides,
          options?.onUnexpected,
        );
      }
    },
    options?.attributes ?? {},
  );
}
