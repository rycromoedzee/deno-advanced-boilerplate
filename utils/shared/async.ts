/**
 * @file utils/shared/async.ts
 * @description Async helper utilities
 */
import { traced } from "@services/tracing/index.ts";
import { Span } from "@interfaces/tracing.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import { requestContext } from "@db/context.ts";

/**
 * Options controlling how a fire-and-forget background operation runs.
 */
export interface FireAndForgetOptions {
  /**
   * Logger app section used for error reporting. Defaults to INTERNAL.
   */
  section?: loggerAppSections;

  /**
   * Defer the operation to a macrotask (`setTimeout(0)`) so its **synchronous**
   * phase runs AFTER the caller's response has been flushed.
   *
   * Required for synchronous-driver DB writes (the local libSQL driver executes
   * writes synchronously; under SQLITE_BUSY write-lock contention this blocks
   * the event loop and stalls the response flush — observed as multi-hundred-ms
   * to ~1s TTFB even though the traced spans report only a few ms). Deferring
   * moves that synchronous execute past the flush.
   *
   * When deferred, the tenant `requestContext` (AsyncLocalStorage) is snapshotted
   * synchronously at the call site and re-established inside the macrotask — the
   * store is no longer active by the time the timer fires. The trace context is
   * intentionally NOT re-established, so a deferred operation's span does not
   * appear in the originating request trace (it is off the critical path — the
   * "honest" representation).
   *
   * Best-effort: a persistent server runs the macrotask; on a freeze-after-
   * response / scale-to-zero target it may be dropped. For guaranteed delivery,
   * use the durable background-jobs queue instead.
   *
   * Defaults to `false` (run inline, this tick). Inline is appropriate for
   * async network/IO side effects (e.g. sending email) that have no synchronous
   * blocking phase, and for work that runs outside any request/response scope.
   */
  defer?: boolean;
}

/**
 * Run the operation inside a background trace span, swallowing/logging any error
 * so it never propagates as an unhandled rejection. Shared by both the inline
 * and deferred execution paths.
 *
 * @internal
 */
function runInline<T>(
  spanName: string,
  operation: (span: Span) => Promise<T>,
  section: loggerAppSections,
): void {
  // Intentionally not awaited: trace the work, then swallow/log any error so the
  // caller's request path is never affected by a background-op failure.
  traced<T>(spanName, "background", (span) => operation(span))
    .then(() => undefined)
    .catch((error: unknown) => {
      // Record + log the failure without rethrowing. The logger itself is async and
      // must not introduce a new floating rejection, so guard it locally.
      try {
        useLogger(
          LoggerLevels.error,
          {
            message: `Background operation "${spanName}" failed`,
            section,
            messageKey: "common.background_operation.failed",
            details: {
              spanName,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        ).catch(() => undefined);
      } catch {
        /* logger failure must not mask the original error */
      }
    });
}

/**
 * Run an operation as fire-and-forget background work, without blocking or
 * rejecting the caller. The operation is traced; any error is logged and
 * recorded on the span instead of propagating. Callers never need to await or
 * catch the result.
 *
 * Choose the execution timing via {@link FireAndForgetOptions.defer}:
 *
 * - `defer: false` (default) — runs inline this tick. The synchronous portion
 *   executes during the caller's request. Use for async network/IO side effects
 *   with no synchronous blocking phase (e.g. sending email), or for work outside
 *   any request scope (startup, workers, cron).
 *
 * - `defer: true` — runs on the next macrotask, after the response flush, with
 *   the tenant `requestContext` snapshotted and re-established. **Use for
 *   synchronous-driver tenant DB writes on a response hot path** (view/download
 *   counters, access logs) so the synchronous execute cannot stall the flush.
 *
 * For guaranteed delivery, use the durable background-jobs queue instead.
 *
 * @param spanName - Trace span name for the background operation
 * @param operation - Async work to run inside the span
 * @param options - Execution + reporting options (see {@link FireAndForgetOptions})
 */
export function fireAndForgetOperation<T>(
  spanName: string,
  operation: (span: Span) => Promise<T>,
  options: FireAndForgetOptions = {},
): void {
  const { section = loggerAppSections.INTERNAL, defer = false } = options;

  if (!defer) {
    runInline(spanName, operation, section);
    return;
  }

  // Snapshot the tenant request store synchronously, before scheduling the
  // macrotask — the store is no longer active by the time the callback fires.
  const store = requestContext.getStore();

  setTimeout(() => {
    if (store) {
      // Re-establish the captured tenant scope so getTenantDB() resolves the
      // correct environmentId. Never inherit implicitly.
      requestContext.run(store, () => runInline(spanName, operation, section));
    } else {
      // No tenant scope at the call site. Run anyway: getTenantDB() will throw
      // (environmentId required) and runInline logs the failure — fails loudly,
      // does not silently cross tenants.
      runInline(spanName, operation, section);
    }
  }, 0);
}
