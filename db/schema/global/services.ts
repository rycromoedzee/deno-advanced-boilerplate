/**
 * @file db/schema/global/services.ts
 * @description Services table schema for the global database
 */
import { createdAtTimestamp, dbTable, index, integer, text, unixSecondsTimestamp, updatedAtTimestamp } from "../../entities.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";

export const jobs = dbTable("jobs", {
  id: text("id").primaryKey().notNull(),
  type: text("type").notNull(),
  data: text("data", { mode: "json" }).notNull(),
  status: text("status").notNull().default(DB_ENUM_JOB_STATUS.PENDING),
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
  lastError: text("last_error"),
  meta: text("meta", { mode: "json" }),
}, (table) => [
  index("idx_jobs_status_updated").on(table.status, table.updatedAt),
  index("idx_jobs_type_status").on(table.type, table.status),
]);

export const emails = dbTable("emails", {
  id: text("id").primaryKey().notNull(),
  emailId: text("email_id"),
  userId: text("user_id").notNull(),
  to: text("to").notNull(),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
  type: text("type").notNull(),
  emailTemplate: text("email_template").notNull(),
  status: text("status").notNull().default(DB_ENUM_JOB_STATUS.PENDING),
  lastEvent: text("last_event").default("email.sent"),
  data: text("data", { mode: "json" }),
  emailLanguage: text("email_language").notNull().default("en"),
});

export const traceLogs = dbTable("trace_logs", {
  id: text("id").primaryKey().notNull(),
  traceId: text("trace_id").notNull().unique(),
  instanceId: text("instance_id").notNull(),
  userId: text("user_id"),
  correlationId: text("correlation_id"),
  requestId: text("request_id"),
  sessionId: text("session_id"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  errorCount: integer("error_count").notNull().default(1),
  errorMessage: text("error_message"),
  duration: integer("duration").notNull(),
  spanCount: integer("span_count").notNull(),
  breadcrumbCount: integer("breadcrumb_count").notNull(),
  traceData: text("trace_data", { mode: "json" }).notNull(),
  createdAt: createdAtTimestamp(),
  expiresAt: integer("expires_at"),
}, (table) => [
  index("trace_logs_instance_id_idx").on(table.instanceId),
  index("trace_logs_user_id_idx").on(table.userId),
  index("trace_logs_correlation_id_idx").on(table.correlationId),
  index("trace_logs_created_at_idx").on(table.createdAt),
  index("trace_logs_expires_at_idx").on(table.expiresAt),
]);

export const cronJobExecutions = dbTable("cron_job_executions", {
  jobName: text("job_name").primaryKey().notNull(),
  lastRunAt: unixSecondsTimestamp("last_run_at").notNull(),
  lastStatus: text("last_status"),
  lastError: text("last_error"),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("cron_job_executions_last_run_at_idx").on(table.lastRunAt),
]);

export const jobLocks = dbTable("job_locks", {
  jobName: text("job_name").primaryKey().notNull(),
  instanceId: text("instance_id").notNull(),
  acquiredAt: unixSecondsTimestamp("acquired_at").notNull(),
  expiresAt: unixSecondsTimestamp("expires_at").notNull(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_job_locks_expires_at").on(table.expiresAt),
  index("idx_job_locks_instance_id").on(table.instanceId),
]);

/**
 * Whole-environment backup purge queue (DD8). Lives in the GLOBAL db so it
 * survives tenant-DB destruction. `destroyEnvironment` enqueues a row here
 * INSIDE its teardown transaction; Phase C of the object-storage-backup job
 * drains it after the grace window, deleting the tenant's entire backup
 * subtree by explicit key (never `deleteDirectory`, which silently truncates).
 */
export const environmentBackupPurgeQueue = dbTable("environment_backup_purge_queue", {
  environmentId: text("environment_id").primaryKey().notNull(),
  prefix: text("prefix").notNull(),
  deletedAt: integer("deleted_at").notNull(),
  deleteAfter: integer("delete_after").notNull(),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
}, (table) => [
  index("idx_environment_backup_purge_queue_delete_after").on(table.deleteAfter),
]);
