/**
 * @file services/background-tasks/singletons.ts
 * @description Singleton getters for background task services
 *
 * Provides centralized access to service instances following the project pattern.
 */

import { TaskEnqueueService } from "./task-enqueue.service.ts";
import { getTaskStatusService } from "./task-status.service.ts";
import { getTaskCancelService } from "./task-cancel.service.ts";
import { getHandlerRegistry } from "./handlers/index.ts";
import { CacheQueueProvider } from "./providers/cache-queue.provider.ts";
import type { BaseTaskHandler } from "./base-task-handler.ts";
import type { TaskQueueProvider } from "@interfaces/background-task.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

// Singleton instances
let taskEnqueueService: TaskEnqueueService | null = null;
let queueProvider: TaskQueueProvider | null = null;

/**
 * Get the queue provider singleton.
 * Uses CacheQueueProvider which leverages the existing cache infrastructure.
 */
function getQueueProvider(): TaskQueueProvider {
  if (!queueProvider) {
    queueProvider = new CacheQueueProvider();
    useLogger(LoggerLevels.info, {
      message: "Background tasks using cache-based queue provider",
      section: loggerAppSections.INTERNAL,
      messageKey: "background_tasks.queue_provider_initialized",
    });
  }
  return queueProvider;
}

/**
 * Get the handler from the registry by task type.
 */
function getHandler(taskType: string): BaseTaskHandler<unknown, unknown> | undefined {
  return getHandlerRegistry().get(taskType);
}

/**
 * Get the TaskEnqueueService singleton.
 */
export function getTaskEnqueueService(): TaskEnqueueService {
  if (!taskEnqueueService) {
    const provider = getQueueProvider();
    taskEnqueueService = new TaskEnqueueService(provider, getHandler);
  }
  return taskEnqueueService;
}

/**
 * Get the TaskStatusService singleton.
 */
export { getTaskStatusService };

/**
 * Get the TaskCancelService singleton.
 */
export { getTaskCancelService };

/**
 * Close all task services and cleanup resources.
 */
export async function closeTaskServices(): Promise<void> {
  if (queueProvider) {
    await queueProvider.close();
    queueProvider = null;
  }
  taskEnqueueService = null;
}

// Re-export types for convenience
export type { TaskEnqueueService } from "./task-enqueue.service.ts";
export type { TaskStatusService } from "./task-status.service.ts";
export type { TaskCancelService } from "./task-cancel.service.ts";
