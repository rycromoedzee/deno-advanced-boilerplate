/**
 * @file services/db-backup/retention.ts
 * @description Retention service module (db backup)
 */
export interface RetentionConfig {
  dailyRetentionDays: number;
  weeklyRetentionWeeks: number;
  monthlyRetentionMonths: number;
}

export interface RetentionResult {
  keep: Date[];
  delete: Date[];
}

const MS_PER_DAY = 86_400_000;

function startOfUtcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/**
 * Returns `a - b` in whole UTC days. Positive when `a` is later than `b`.
 * Call sites are `daysBetween(now, d)` → "days old `d` is relative to `now`";
 * do not reverse the arguments or you will get a negative value silently.
 */
function daysBetween(a: Date, b: Date): number {
  return Math.floor((startOfUtcDay(a).getTime() - startOfUtcDay(b).getTime()) / MS_PER_DAY);
}

/** Monday of the ISO week containing d, as UTC midnight. */
function isoWeekStart(d: Date): Date {
  const day = startOfUtcDay(d);
  const dow = (day.getUTCDay() + 6) % 7; // Mon=0 ... Sun=6
  return new Date(day.getTime() - dow * MS_PER_DAY);
}

function isoWeekKey(d: Date): string {
  return isoWeekStart(d).toISOString();
}

export function computeRetention(
  existingDates: Date[],
  now: Date,
  config: RetentionConfig,
): RetentionResult {
  const nowDay = startOfUtcDay(now);
  const unique = Array.from(
    new Map(existingDates.map((d) => [startOfUtcDay(d).toISOString(), startOfUtcDay(d)])).values(),
  );

  const keep = new Set<string>();

  // Daily
  for (const d of unique) {
    if (daysBetween(nowDay, d) < config.dailyRetentionDays) {
      keep.add(d.toISOString());
    }
  }

  // Weekly — for each of the last `weeklyRetentionWeeks` ISO weeks BEFORE the
  // week of `now`, pick the Monday snapshot if present, else the earliest
  // snapshot in that ISO week. The current week is already covered by the
  // daily tier, so it is deliberately excluded here.
  const weekToDates = new Map<string, Date[]>();
  for (const d of unique) {
    const key = isoWeekKey(d);
    const arr = weekToDates.get(key) ?? [];
    arr.push(d);
    weekToDates.set(key, arr);
  }

  const nowWeekStart = isoWeekStart(nowDay);
  for (let w = 1; w <= config.weeklyRetentionWeeks; w++) {
    const weekStart = new Date(nowWeekStart.getTime() - w * 7 * MS_PER_DAY);
    const candidates = weekToDates.get(weekStart.toISOString());
    if (!candidates || candidates.length === 0) continue;
    const monday = candidates.find((d) => d.getTime() === weekStart.getTime());
    const pick = monday ?? candidates.slice().sort((a, b) => a.getTime() - b.getTime())[0];
    keep.add(pick.toISOString());
  }

  // Monthly — for each of the last `monthlyRetentionMonths` months (including
  // the month of `now`), pick the 1st-of-month snapshot if present, else the
  // earliest snapshot in that month.
  const monthToDates = new Map<string, Date[]>();
  for (const d of unique) {
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const arr = monthToDates.get(key) ?? [];
    arr.push(d);
    monthToDates.set(key, arr);
  }

  for (let m = 0; m < config.monthlyRetentionMonths; m++) {
    const year = nowDay.getUTCFullYear();
    const month = nowDay.getUTCMonth() - m;
    const d = new Date(Date.UTC(year, month, 1));
    const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    const candidates = monthToDates.get(key);
    if (!candidates || candidates.length === 0) continue;
    const first = candidates.find((c) => c.getUTCDate() === 1);
    const pick = first ?? candidates.slice().sort((a, b) => a.getTime() - b.getTime())[0];
    keep.add(pick.toISOString());
  }

  const keepDates = unique.filter((d) => keep.has(d.toISOString()));
  const deleteDates = unique.filter((d) => !keep.has(d.toISOString()));
  return { keep: keepDates, delete: deleteDates };
}
