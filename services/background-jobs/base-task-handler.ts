/**
 * @file services/background-tasks/base-task-handler.ts
 * @description Abstract base class for background task handlers
 *
 * Provides a structured approach to implementing task handlers with:
 * - Input validation via Zod schemas
 * - Cancellation support via CancellationToken
 * - Progress reporting
 * - Type-safe input and result types
 */

import type { z } from "@deps";
import type { BackgroundTask, CancellationToken, TaskContext, TaskResultType } from "@interfaces/background-task.ts";

/**
 * Error thrown when a task is cancelled
 */
export class TaskCancelledError extends Error {
  constructor(public readonly taskType: string) {
    super(`Task cancelled: ${taskType}`);
    this.name = "TaskCancelledError";
  }
}

/**
 * Abstract base class for background task handlers
 *
 * Subclasses must implement:
 * - taskType: Unique identifier for this task type
 * - description: Human-readable description
 * - inputSchema: Zod schema for input validation
 * - resultType: Type of result (JSON, download, notification)
 * - execute: Core task logic
 *
 * @example
 * ```typescript
 * class PdfExportHandler extends BaseTaskHandler<PdfExportInput, PdfExportResult> {
 *   readonly taskType = "pdf-export";
 *   readonly description = "Export documents to PDF";
 *   readonly inputSchema = z.object({ documentId: z.string() });
 *   readonly resultType = TaskResultType.DOWNLOAD;
 *
 *   protected async execute(input: PdfExportInput, context: TaskContext): Promise<PdfExportResult> {
 *     await context.updateProgress(10, "Starting PDF export");
 *
 *     // Check for cancellation periodically
 *     await this.throwIfCancelled();
 *
 *     // Do work...
 *     await context.updateProgress(50, "Processing document");
 *
 *     // Check again before final steps
 *     await this.throwIfCancelled();
 *
 *     // Complete
 *     return { downloadUrl: "..." };
 *   }
 * }
 * ```
 */
export abstract class BaseTaskHandler<TInput, TResult> {
  /** Unique task type identifier (e.g., 'pdf-export', 'data-export') */
  abstract readonly taskType: string;

  /** Human-readable description for documentation */
  abstract readonly description: string;

  /** Zod schema for input validation */
  abstract readonly inputSchema: z.ZodSchema<TInput>;

  /** Result type for response shaping */
  abstract readonly resultType: TaskResultType;

  /** Maximum retry attempts (optional, defaults to 3) */
  readonly maxRetries?: number;

  /** Cancellation token - set by orchestration service before execution */
  protected cancellationToken!: CancellationToken;

  /**
   * Core execution method - must be implemented by subclasses.
   * Use checkCancelled() periodically for responsive cancellation.
   */
  protected abstract execute(
    input: TInput,
    context: TaskContext,
  ): Promise<TResult>;

  /**
   * Check if task has been cancelled.
   * Uses cached flag with periodic DB sync for efficiency.
   */
  protected checkCancelled(): Promise<boolean> {
    return this.cancellationToken.isCancelled();
  }

  /**
   * Throw if cancelled - for convenient early exits.
   */
  protected async throwIfCancelled(): Promise<void> {
    if (await this.cancellationToken.isCancelled()) {
      throw new TaskCancelledError(this.taskType);
    }
  }

  /**
   * Public method called by enqueue service.
   * Sets up cancellation token and delegates to execute().
   */
  run(
    task: BackgroundTask<TInput>,
    updateProgress: (progress: number, message?: string) => Promise<void>,
    cancellationToken: CancellationToken,
  ): Promise<TResult> {
    this.cancellationToken = cancellationToken;
    return this.execute(task.data, {
      taskId: task.id,
      userId: task.userId,
      environmentId: task.environmentId,
      updateProgress,
    });
  }

  /**
   * Validate input against the schema.
   * Called by the enqueue service before task execution.
   */
  validateInput(input: unknown): TInput {
    return this.inputSchema.parse(input);
  }
}
