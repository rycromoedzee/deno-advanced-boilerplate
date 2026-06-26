/**
 * @file jobs/types/worker-messages.ts
 * @description Worker Messages job type definitions
 */
/**
 * Worker Message Types
 *
 * Defines the communication protocol between the main thread and job worker.
 * Uses a type-safe message passing interface for worker communication.
 */

// =====================================
// Message Types from Main Thread to Worker
// =====================================

export type MainToWorkerMessage =
  | { type: "INIT"; payload: { instanceId: string; mode: "cron" | "inline"; maxConcurrent: number } }
  | { type: "SHUTDOWN" }
  | { type: "TRIGGER_JOB"; payload: { jobName: string } }
  | { type: "GET_STATUS" };

// =====================================
// Message Types from Worker to Main Thread
// =====================================

export type WorkerToMainMessage =
  | { type: "READY" }
  | { type: "INITIALIZED"; payload: { jobCount: number } }
  | { type: "SHUTDOWN_COMPLETE" }
  | { type: "JOB_STARTED"; payload: { jobName: string; timestamp: number } }
  | { type: "JOB_COMPLETED"; payload: { jobName: string; duration: number; success: boolean } }
  | { type: "JOB_ERROR"; payload: { jobName: string; error: string; stack?: string } }
  | { type: "STATUS"; payload: WorkerStatus }
  | { type: "ERROR"; payload: { error: string } };

// =====================================
// Worker Status
// =====================================

export interface JobStatus {
  name: string;
  schedule: string;
  lastRun?: number;
  isRunning: boolean;
  lastError?: string;
}

export interface WorkerStatus {
  instanceId: string;
  isRunning: boolean;
  jobs: JobStatus[];
  startedAt: number;
  lastActivity?: number;
}

// =====================================
// Type Guards
// =====================================

export function isMainToWorkerMessage(msg: unknown): msg is MainToWorkerMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: string };
  return ["INIT", "SHUTDOWN", "TRIGGER_JOB", "GET_STATUS"].includes(m.type ?? "");
}

export function isWorkerToMainMessage(msg: unknown): msg is WorkerToMainMessage {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg as { type?: string };
  return [
    "READY",
    "INITIALIZED",
    "SHUTDOWN_COMPLETE",
    "JOB_STARTED",
    "JOB_COMPLETED",
    "JOB_ERROR",
    "STATUS",
    "ERROR",
  ].includes(m.type ?? "");
}
