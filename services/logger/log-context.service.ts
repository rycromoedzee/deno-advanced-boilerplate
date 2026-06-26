/**
 * @file services/logger/log-context.service.ts
 * @description Log Context service (logger)
 */
// log-context.ts
import type { HonoContext, HonoNext } from "@deps";
import { AsyncLocalStorage, bytesToHex, randomBytes } from "@deps";
import { IPLookupUtils } from "@utils/network/index.ts";
import type { LogContext } from "@logger/types.ts";

/**
 * The global AsyncLocalStorage instance for context
 */
const storage = new AsyncLocalStorage<LogContext>();

/**
 * Context management service using AsyncLocalStorage
 */
export class LogContextService {
  private instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /**
   * Get the current instance ID
   */
  getInstanceId(): string {
    return this.instanceId;
  }

  /**
   * Generate an 8-byte correlation ID
   */
  generateCorrelationId(): string {
    return bytesToHex(randomBytes(8));
  }

  /**
   * Generate a 12-byte request ID
   */
  generateRequestId(): string {
    return bytesToHex(randomBytes(12));
  }

  /**
   * Extract context from Hono request
   */
  extractContextFromRequest(c: HonoContext): LogContext {
    const correlationId = c.req.header("Correlation-ID") ||
      this.generateCorrelationId();
    const requestId = this.generateRequestId();
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";
    const userId = c.get("internalUsageAuthUserIdDetails") ||
      c.get("internalUsageAuthApiKeyDetails");

    return {
      correlationId,
      requestId,
      ipAddress,
      userAgent,
      userId,
      instanceId: this.instanceId,
    };
  }

  /**
   * Get the current active log context (if any)
   */
  getContext(): LogContext | undefined {
    return storage.getStore();
  }

  /**
   * Async middleware that stores context in ALS
   */
  createMiddleware() {
    return (c: HonoContext, next: HonoNext) => {
      const context = this.extractContextFromRequest(c);

      return storage.run(context, () => {
        c.set("logContext", context);
        c.set("correlationId", context.correlationId);
        c.set("requestId", context.requestId);

        c.header("Correlation-ID", context.correlationId);
        c.header("Request-ID", context.requestId);

        return next();
      });
    };
  }

  /**
   * Get context directly from Hono context object
   */
  getContextFromHono(c: HonoContext): LogContext | undefined {
    return c.get("logContext");
  }

  /**
   * For non-HTTP tasks like background jobs.
   * Partially inherits properties from given input; fills in defaults.
   */
  runWithBackgroundContext<R>(
    input: Partial<LogContext>,
    callback: () => Promise<R> | R,
  ): Promise<R> | R {
    const context: LogContext = {
      correlationId: input.correlationId || this.generateCorrelationId(),
      requestId: input.requestId || this.generateRequestId(),
      ipAddress: input.ipAddress || "system",
      userAgent: input.userAgent || "background-task",
      userId: input.userId,
      instanceId: this.instanceId,
    };

    return storage.run(context, callback);
  }

  resetContextWithParent(input: Partial<LogContext> = {}): LogContext {
    const parent = this.getContext();

    const newContext: LogContext = {
      correlationId: this.generateCorrelationId(),
      requestId: this.generateRequestId(),
      ipAddress: input.ipAddress || "",
      userAgent: input.userAgent || "",
      userId: input.userId || parent?.userId || "",
      parentCorrelationId: parent?.correlationId,
      instanceId: this.instanceId,
    };

    storage.enterWith(newContext);
    return newContext;
  }

  /**
   * Update userId in the current context
   * Used by auth middleware to set userId after authentication
   */
  updateUserId(userId: string): void {
    const current = this.getContext();
    if (current) {
      current.userId = userId;
    }
  }

  /**
   * Reset only the correlationId within the current context scope
   */
  resetCorrelationId<R>(callback: () => Promise<R> | R): Promise<R> | R {
    const current = this.getContext();
    return storage.run(
      {
        ...current,
        correlationId: this.generateCorrelationId(),
      },
      callback,
    );
  }
}

// Singleton instance - will be initialized from main.ts
let instance: LogContextService | null = null;

/**
 * Initialize the LogContextService singleton
 * MUST be called once at application startup with the instance ID
 *
 * @param instanceId - The unique instance identifier for this application instance
 */
export function initializeLogContext(instanceId: string): void {
  if (instance) {
    throw new Error("LogContextService has already been initialized");
  }
  instance = new LogContextService(instanceId);
}

/**
 * External getter
 */
export function useLogContext(): LogContextService {
  if (!instance) {
    throw new Error("LogContextService not initialized. Call initializeLogContext() first.");
  }
  return instance;
}

/**
 * Middleware factory
 */
export function createLogContextMiddleware() {
  if (!instance) {
    throw new Error("LogContextService not initialized. Call initializeLogContext() first.");
  }
  return instance.createMiddleware();
}
