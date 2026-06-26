/**
 * @file models/tasks/task.model.ts
 * @description Zod schemas for task API requests and responses
 */

import { z } from "@deps";

/**
 * Task status values
 */
export const SchemaTaskStatus = z.enum([
  "pending",
  "processing",
  "completed",
  "failed",
  "cancelled",
]);

/**
 * Task result types
 */
export const SchemaTaskResultType = z.enum([
  "json",
  "download",
  "notification",
]);

/**
 * Task type params
 */
export const SchemaTaskTypeParams = z.object({
  taskType: z.string().trim().min(1).max(100).openapi({
    description: "Task type identifier",
    example: "pdf-export",
  }),
});

/**
 * Task ID params
 */
export const SchemaTaskParams = z.object({
  taskId: z.string().uuid().openapi({
    description: "Task ID",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
});

/**
 * Task trigger request body
 */
export const SchemaTaskTriggerRequest = z.object({
  input: z.record(z.string(), z.unknown()).openapi({
    description: "Task-specific input data",
    example: { documentId: "doc-123", format: "pdf" },
  }),
});

/**
 * Task trigger response
 */
export const SchemaTaskTriggerResponse = z.object({
  taskId: z.string().uuid().openapi({
    description: "Unique identifier for the task",
    example: "123e4567-e89b-12d3-a456-426614174000",
  }),
  statusUrl: z.string().openapi({
    description: "URL to get task status",
    example: "/api/jobs/123e4567-e89b-12d3-a456-426614174000/status",
  }),
  streamUrl: z.string().openapi({
    description: "URL to stream task updates via SSE",
    example: "/api/jobs/123e4567-e89b-12d3-a456-426614174000/stream",
  }),
});

/**
 * Task error object
 */
export const SchemaTaskError = z.object({
  message: z.string().openapi({
    description: "Error message",
    example: "Task execution failed",
  }),
  code: z.string().optional().openapi({
    description: "Error code",
    example: "EXECUTION_ERROR",
  }),
  details: z.unknown().optional().openapi({
    description: "Additional error details",
  }),
});

/**
 * Task status response
 */
export const SchemaTaskStatusResponse = z.object({
  status: SchemaTaskStatus.openapi({
    description: "Current status of the task",
    example: "processing",
  }),
  progress: z.number().min(0).max(100).openapi({
    description: "Progress percentage (0-100)",
    example: 50,
  }),
  message: z.string().optional().openapi({
    description: "Human-readable status message",
    example: "Processing document",
  }),
  result: z.unknown().optional().openapi({
    description: "Task result (when completed)",
    example: { downloadUrl: "/api/jobs/123/download" },
  }),
  error: SchemaTaskError.optional().openapi({
    description: "Error information (when failed)",
  }),
  createdAt: z.number().openapi({
    description: "Timestamp when task was created (milliseconds since epoch)",
    example: 1709000000000,
  }),
  updatedAt: z.number().openapi({
    description: "Timestamp when task was last updated (milliseconds since epoch)",
    example: 1709000050000,
  }),
  startedAt: z.number().optional().openapi({
    description: "Timestamp when processing started (milliseconds since epoch)",
    example: 1709000010000,
  }),
  finishedAt: z.number().optional().openapi({
    description: "Timestamp when task completed/failed (milliseconds since epoch)",
    example: 1709000100000,
  }),
  retryCount: z.number().optional().openapi({
    description: "Number of retry attempts",
    example: 0,
  }),
  maxRetries: z.number().optional().openapi({
    description: "Maximum retry attempts allowed",
    example: 3,
  }),
});

/**
 * Task cancel response
 */
export const SchemaTaskCancelResponse = z.object({
  success: z.boolean().openapi({
    description: "Whether cancellation was successful",
    example: true,
  }),
  reason: z.string().optional().openapi({
    description: "Reason for failure if success is false",
    example: "already_completed",
  }),
});

/**
 * Task not found error response
 */
export const SchemaTaskNotFoundResponse = z.object({
  error: z.string().openapi({
    description: "Error message",
    example: "Task not found",
  }),
});

// Type exports
export type ITaskStatus = z.infer<typeof SchemaTaskStatus>;
export type ITaskResultType = z.infer<typeof SchemaTaskResultType>;
export type ITaskTypeParams = z.infer<typeof SchemaTaskTypeParams>;
export type ITaskParams = z.infer<typeof SchemaTaskParams>;
export type ITaskTriggerRequest = z.infer<typeof SchemaTaskTriggerRequest>;
export type ITaskTriggerResponse = z.infer<typeof SchemaTaskTriggerResponse>;
export type ITaskError = z.infer<typeof SchemaTaskError>;
export type ITaskStatusResponse = z.infer<typeof SchemaTaskStatusResponse>;
export type ITaskCancelResponse = z.infer<typeof SchemaTaskCancelResponse>;
export type ITaskNotFoundResponse = z.infer<typeof SchemaTaskNotFoundResponse>;
