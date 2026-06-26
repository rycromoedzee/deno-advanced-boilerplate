/**
 * @file db/enums/jobs.enum.ts
 * @description Jobs DB enum definitions
 */
export enum DB_ENUM_JOB_STATUS {
  PENDING = "pending",
  PROCESSING = "processing",
  COMPLETED = "completed",
  FAILED = "failed",
  CANCELLED = "cancelled",
}
