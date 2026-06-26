/**
 * @file services/tracing/span-utils.ts
 * @description Span Utils service module (tracing)
 */
import type { OperationType, Span } from "@interfaces/tracing.ts";
import { getTraceContext } from "./trace-context.service.ts";
import { AppHttpException } from "@utils/http-exception.ts";

/**
 * Extract error information and attach it to a span
 * Handles AppHttpException with cause chain and standard Error objects
 *
 * @param span - The span to attach error info to
 * @param error - The error that occurred
 * @returns The formatted span error object
 */
function attachSpanError(span: Span, error: unknown): void {
  span.status = "error";
  const errorMessage = error instanceof AppHttpException && error.cause
    ? `${error.message} - Cause: ${String(error.cause)}`
    : error instanceof Error
    ? error.message
    : String(error);
  span.error = {
    name: error instanceof Error ? error.name : "UnknownError",
    message: errorMessage,
    stack: error instanceof Error ? error.stack : undefined,
  };
}

/**
 * Wrap an async operation with automatic span tracking
 *
 * This utility provides a convenient way to trace operations without manually
 * managing span lifecycle. It automatically handles span creation, error recording,
 * and cleanup in a try/finally block.
 *
 * @param name - Human-readable name for the span (e.g., 'db.query.users', 'upload.file')
 * @param operationType - Type of operation ('http', 'db', 'cache', 'service', 'handler')
 * @param operation - The async function to execute within the span
 * @param attributes - Optional attributes to attach to the span
 * @returns The result of the operation
 *
 * @example
 * ```typescript
 * const result = await traced('db.query.users', 'db', async (span) => {
 *   span.attributes['db.table'] = 'users';
 *   span.attributes['db.operation'] = 'SELECT';
 *
 *   const users = await db.query('SELECT * FROM users WHERE id = ?', [userId]);
 *
 *   span.attributes['db.rows_returned'] = users.length;
 *   return users;
 * });
 * ```
 */
export function traced<T>(
  name: string,
  operationType: OperationType,
  operation: (span: Span) => Promise<T>,
  attributes: Record<string, unknown> = {},
): Promise<T> {
  const traceService = getTraceContext();
  const span = traceService.startSpan(name, operationType, attributes);

  return traceService.runWithSpan(span, async () => {
    try {
      const result = await operation(span);
      span.status = "ok";
      return result;
    } catch (error) {
      attachSpanError(span, error);
      traceService.recordException(error);
      throw error;
    } finally {
      traceService.finishSpan(span);
    }
  }) as Promise<T>;
}

/**
 * Wrap a synchronous operation with automatic span tracking
 *
 * This utility provides a convenient way to trace synchronous operations without manually
 * managing span lifecycle. It automatically handles span creation, error recording,
 * and cleanup in a try/finally block.
 *
 * @param name - Human-readable name for the span (e.g., 'encryption.encrypt', 'validation.check')
 * @param operationType - Type of operation ('http', 'db', 'cache', 'service', 'handler')
 * @param operation - The synchronous function to execute within the span
 * @param attributes - Optional attributes to attach to the span
 * @returns The result of the operation
 *
 * @example
 * ```typescript
 * const result = tracedSync('encryption.encrypt', 'service', (span) => {
 *   span.attributes['encryption.type'] = 'AES-256-GCM';
 *
 *   const encrypted = encryptData(data);
 *
 *   span.attributes['encryption.success'] = true;
 *   return encrypted;
 * });
 * ```
 */
export function tracedSync<T>(
  name: string,
  operationType: OperationType,
  operation: (span: Span) => T,
  attributes: Record<string, unknown> = {},
): T {
  const traceService = getTraceContext();
  const span = traceService.startSpan(name, operationType, attributes);

  return traceService.runWithSpan(span, () => {
    try {
      const result = operation(span);
      span.status = "ok";
      return result;
    } catch (error) {
      attachSpanError(span, error);
      traceService.recordException(error);
      throw error;
    } finally {
      traceService.finishSpan(span);
    }
  }) as T;
}
