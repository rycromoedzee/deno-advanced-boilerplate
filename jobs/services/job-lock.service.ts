/**
 * @file jobs/services/job-lock.service.ts
 * @description Job Lock job service
 */
import { getGlobalDB, globalTables } from "@db/db.ts";
import { eq, lt } from "@deps";
import { envConfig } from "@config/env.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { getInstanceId } from "@utils/instance-id.ts";

const LOCK_EXPIRATION_SECONDS = 30 * 60;

export async function acquireJobLock(jobName: string): Promise<boolean> {
  const db = getGlobalDB();
  const now = getTimeNowForStorage();
  const expiresAt = now + LOCK_EXPIRATION_SECONDS;
  const instanceId = getInstanceId();

  try {
    const existingLock = await db
      .select()
      .from(globalTables.jobLocks)
      .where(eq(globalTables.jobLocks.jobName, jobName))
      .limit(1);

    const lock = existingLock.length > 0 ? existingLock[0] : null;

    if (lock !== null) {
      const isExpired = lock.expiresAt < now;
      if (!isExpired && lock.instanceId !== instanceId) {
        return false;
      }
    }

    await db
      .insert(globalTables.jobLocks)
      .values({
        jobName,
        instanceId,
        acquiredAt: now,
        expiresAt,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: globalTables.jobLocks.jobName,
        set: {
          instanceId,
          acquiredAt: now,
          expiresAt,
          updatedAt: now,
        },
      });

    return true;
  } catch {
    return false;
  }
}

export async function releaseJobLock(jobName: string): Promise<void> {
  const db = getGlobalDB();
  try {
    await db
      .delete(globalTables.jobLocks)
      .where(eq(globalTables.jobLocks.jobName, jobName));
  } catch (_error) { /* ignore lock release failures */ }
}

export async function refreshJobLock(jobName: string): Promise<boolean> {
  const db = getGlobalDB();
  const now = getTimeNowForStorage();
  const expiresAt = now + LOCK_EXPIRATION_SECONDS;
  const instanceId = getInstanceId();

  try {
    const existingLock = await db
      .select()
      .from(globalTables.jobLocks)
      .where(eq(globalTables.jobLocks.jobName, jobName))
      .limit(1);

    if (existingLock.length === 0 || existingLock[0].instanceId !== instanceId) {
      return false;
    }

    await db
      .update(globalTables.jobLocks)
      .set({
        expiresAt,
        updatedAt: now,
      })
      .where(eq(globalTables.jobLocks.jobName, jobName));

    return true;
  } catch (_error) {
    return false;
  }
}

export async function cleanupExpiredLocks(): Promise<number> {
  const db = getGlobalDB();
  const now = getTimeNowForStorage();

  try {
    await db
      .delete(globalTables.jobLocks)
      .where(lt(globalTables.jobLocks.expiresAt, now));

    return 0; // LibSQL returning() might be needed for count
  } catch (_error) {
    return 0;
  }
}

export async function getJobLockStatus(jobName: string) {
  const db = getGlobalDB();
  const now = getTimeNowForStorage();

  try {
    const locks = await db
      .select()
      .from(globalTables.jobLocks)
      .where(eq(globalTables.jobLocks.jobName, jobName))
      .limit(1);

    if (locks.length === 0) {
      return { isLocked: false, instanceId: null, isExpired: false };
    }

    const lock = locks[0];
    const isExpired = lock.expiresAt < now;

    return {
      isLocked: !isExpired,
      instanceId: lock.instanceId,
      acquiredAt: lock.acquiredAt,
      expiresAt: lock.expiresAt,
      isExpired,
    };
  } catch (_error) {
    return { isLocked: false, instanceId: null, isExpired: false };
  }
}

export async function acquireCacheCleanupLock(jobName: string): Promise<boolean> {
  if (!envConfig.cache.isRedisEnabled) return true;
  return await acquireJobLock(jobName);
}

export async function releaseCacheCleanupLock(jobName: string): Promise<void> {
  if (!envConfig.cache.isRedisEnabled) return;
  await releaseJobLock(jobName);
}
