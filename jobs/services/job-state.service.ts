/**
 * @file jobs/services/job-state.service.ts
 * @description Job State job service
 */
import { eq } from "@deps";
import { getGlobalDB, globalTables } from "@db/db.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Get the last run time for a job from the database
 */
export async function getLastRun(jobName: string): Promise<number | null> {
  try {
    const db = getGlobalDB();
    const result = await db
      .select({ lastRunAt: globalTables.cronJobExecutions.lastRunAt })
      .from(globalTables.cronJobExecutions)
      .where(eq(globalTables.cronJobExecutions.jobName, jobName))
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    return result[0].lastRunAt * 1000;
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: `Failed to get last run time for job: ${jobName}`,
      section: loggerAppSections.TRACING,
      messageKey: "JOB_STATE_GET_LAST_RUN_FAILED",
      details: { jobName, error: String(error) },
    });
    return null;
  }
}

/**
 * Update the last run time for a job in the database
 */
export async function updateLastRun(
  jobName: string,
  timestamp: Date,
  status: "success" | "error" = "success",
  error?: string,
): Promise<void> {
  try {
    const db = getGlobalDB();
    const lastRunAt = Math.floor(timestamp.getTime() / 1000);

    await db
      .insert(globalTables.cronJobExecutions)
      .values({
        jobName,
        lastRunAt,
        lastStatus: status,
        lastError: error,
        updatedAt: Math.floor(Date.now() / 1000),
      })
      .onConflictDoUpdate({
        target: globalTables.cronJobExecutions.jobName,
        set: {
          lastRunAt,
          lastStatus: status,
          lastError: error,
          updatedAt: Math.floor(Date.now() / 1000),
        },
      });
  } catch (dbError) {
    await useLogger(LoggerLevels.error, {
      message: `Failed to update last run time for job: ${jobName}`,
      section: loggerAppSections.TRACING,
      messageKey: "JOB_STATE_UPDATE_LAST_RUN_FAILED",
      details: { jobName, error: String(dbError) },
    });
  }
}

/**
 * Get all job execution states
 */
export async function getAllJobStates(): Promise<Map<string, number>> {
  try {
    const db = getGlobalDB();
    const results = await db
      .select({ jobName: globalTables.cronJobExecutions.jobName, lastRunAt: globalTables.cronJobExecutions.lastRunAt })
      .from(globalTables.cronJobExecutions);

    const states = new Map<string, number>();
    for (const row of results) {
      states.set(row.jobName, row.lastRunAt * 1000);
    }

    return states;
  } catch (error) {
    await useLogger(LoggerLevels.error, {
      message: "Failed to get all job states",
      section: loggerAppSections.TRACING,
      messageKey: "JOB_STATE_GET_ALL_FAILED",
      details: { error: String(error) },
    });
    return new Map();
  }
}
