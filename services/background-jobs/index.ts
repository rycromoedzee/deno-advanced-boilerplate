/**
 * @file services/background-jobs/index.ts
 * @description Background job system exports
 *
 * Scale-to-zero compatible background job processing system.
 * Uses DB as source of truth with cache as read-through layer.
 *
 * See README.md for detailed documentation.
 */

// Services (DB-backed)
export { closeTaskServices, getTaskCancelService, getTaskEnqueueService, getTaskStatusService } from "./singletons.ts";

export type { TaskCancelService, TaskEnqueueService, TaskStatusService } from "./singletons.ts";

// Base handler class
export { BaseTaskHandler, TaskCancelledError } from "./base-task-handler.ts";

// Handler registry
export { getHandler, getHandlerRegistry, getRegisteredTaskTypes, handlerDefinitions, hasHandler } from "./handlers/index.ts";

// Cancellation token
export { CancellationToken, createCancellationToken } from "./utils/cancellation-token.ts";

// Queue provider (cache-based)
export { CacheQueueProvider } from "./providers/cache-queue.provider.ts";

// Re-export types from interfaces
export type {
  BackgroundTask,
  CancellationResult,
  CancellationToken as ICancellationToken,
  ITaskHandlerDefinition,
  TaskContext,
  TaskEnqueueResult,
  TaskEvent,
  TaskHandler,
  TaskMeta,
  TaskOptions,
  TaskProcessorConfig,
  TaskQueueProvider,
  TaskState,
} from "@interfaces/background-task.ts";

export { TaskEventType, TaskResultType, TaskStatus } from "@interfaces/background-task.ts";
