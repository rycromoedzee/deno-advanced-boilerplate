/**
 * @file services/background-tasks/handlers/index.ts
 * @description Handler registry for background task handlers
 *
 * Centralized registration following the jobs/registry.ts pattern.
 * All task handlers must be registered here.
 */

import type { BaseTaskHandler } from "../base-task-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

// Registry singleton
let handlerRegistry: Map<string, BaseTaskHandler<unknown, unknown>> | null = null;

/**
 * All task handlers must be registered here.
 * This provides central visibility of all background task types.
 *
 * To add a new handler:
 * 1. Create a class extending BaseTaskHandler in this directory
 * 2. Import and add to handlerDefinitions array below
 */
export const handlerDefinitions: BaseTaskHandler<unknown, unknown>[] = [
  // Import and add handlers here, e.g.:
  // new PdfExportHandler(),
  // new DataExportHandler(),
];

/**
 * Get the handler registry singleton.
 * Initializes the registry from handlerDefinitions on first call.
 */
export function getHandlerRegistry(): Map<string, BaseTaskHandler<unknown, unknown>> {
  if (!handlerRegistry) {
    handlerRegistry = new Map();
    for (const handler of handlerDefinitions) {
      if (handlerRegistry.has(handler.taskType)) {
        throw new Error(`Duplicate handler registration for task type: ${handler.taskType}`);
      }
      handlerRegistry.set(handler.taskType, handler);
    }

    useLogger(LoggerLevels.info, {
      message: "Registered background task handlers",
      section: loggerAppSections.INTERNAL,
      messageKey: "background_tasks.handlers_registered",
      details: {
        count: handlerRegistry.size,
        taskTypes: Array.from(handlerRegistry.keys()).join(", ") || "(none)",
      },
    });
  }
  return handlerRegistry;
}

/**
 * Get a handler by task type.
 */
export function getHandler<TInput, TResult>(
  taskType: string,
): BaseTaskHandler<TInput, TResult> | undefined {
  return getHandlerRegistry().get(taskType) as BaseTaskHandler<TInput, TResult> | undefined;
}

/**
 * Check if a handler exists for a task type.
 */
export function hasHandler(taskType: string): boolean {
  return getHandlerRegistry().has(taskType);
}

/**
 * Get all registered task types.
 */
export function getRegisteredTaskTypes(): string[] {
  return Array.from(getHandlerRegistry().keys());
}

/**
 * Register a handler programmatically (for dynamic handlers).
 * Prefer using handlerDefinitions array for static handlers.
 */
export function registerHandler(handler: BaseTaskHandler<unknown, unknown>): void {
  const registry = getHandlerRegistry();
  if (registry.has(handler.taskType)) {
    throw new Error(`Duplicate handler registration for task type: ${handler.taskType}`);
  }
  registry.set(handler.taskType, handler);
}
