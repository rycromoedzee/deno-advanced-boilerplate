/**
 * @file tests/unit/jobs/schedule-overlaps.test.ts
 * @description Unit tests for the pure cron overlap/translation/sort + registry-source parsing logic
 *
 * The real JOB_REGISTRY is validated by parsing jobs/registry.ts as text (no app
 * import), so these stay fast and offline.
 */
import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  cronJobFiresAt,
  describeCronSchedule,
  findScheduleOverlaps,
  firstFiringMinuteOfDay,
  formatOverlapReport,
  matchesCronField,
  parseSchedulesFromSource,
  resolveScheduleValue,
  sortByFirstFiringTime,
} from "../../../scripts/verify-job-overlaps.ts";

// ---------------------------------------------------------------------------
// matchesCronField
// ---------------------------------------------------------------------------

Deno.test("matchesCronField: wildcard, literal, range, list, step", () => {
  assertEquals(matchesCronField(5, "*"), true);
  assertEquals(matchesCronField(5, "5"), true);
  assertEquals(matchesCronField(6, "5"), false);
  assertEquals(matchesCronField(3, "2-6"), true);
  assertEquals(matchesCronField(7, "2-6"), false);
  assertEquals(matchesCronField(3, "1,3,5"), true);
  assertEquals(matchesCronField(2, "1,3,5"), false);
  assertEquals(matchesCronField(30, "*/15"), true); // 30 % 15 === 0
  assertEquals(matchesCronField(7, "*/15"), false);
  assertEquals(matchesCronField(4, "2-10/2"), true); // stepped range
});

// ---------------------------------------------------------------------------
// cronJobFiresAt
// ---------------------------------------------------------------------------

Deno.test("cronJobFiresAt: daily job fires only on the matching minute", () => {
  // "0 2 * * *" -> daily at 02:00 UTC
  assertEquals(cronJobFiresAt("0 2 * * *", new Date(Date.UTC(2024, 0, 1, 2, 0))), true);
  assertEquals(cronJobFiresAt("0 2 * * *", new Date(Date.UTC(2024, 0, 1, 2, 1))), false);
  assertEquals(cronJobFiresAt("0 2 * * *", new Date(Date.UTC(2024, 0, 1, 3, 0))), false);
});

Deno.test("cronJobFiresAt: every-6h job fires at hours 0/6/12/18 only", () => {
  const schedule = "45 */6 * * *";
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 0, 45))), true);
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 6, 45))), true);
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 12, 45))), true);
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 18, 45))), true);
  // hour 3 is not a multiple of 6 -> never fires
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 3, 45))), false);
  // wrong minute
  assertEquals(cronJobFiresAt(schedule, new Date(Date.UTC(2024, 0, 1, 6, 0))), false);
});

Deno.test("cronJobFiresAt: rejects malformed expressions", () => {
  let threw = false;
  try {
    cronJobFiresAt("0 2 * *", new Date(Date.UTC(2024, 0, 1, 2, 0)));
  } catch {
    threw = true;
  }
  assertEquals(threw, true);
});

// ---------------------------------------------------------------------------
// findScheduleOverlaps
// ---------------------------------------------------------------------------

Deno.test("findScheduleOverlaps: detects a same-minute collision", () => {
  // Reproduces the original 3 AM backup-vs-bloom collision: two daily jobs on
  // the same minute collide once per day -> 7 overlaps across a 7-day window.
  const result = findScheduleOverlaps([
    { name: "db-backup", schedule: "0 3 * * *" },
    { name: "bloom-rebuild", schedule: "0 3 * * *" },
  ]);
  assertEquals(result.overlaps.length, 7);
  assertEquals(result.overlaps[0].utcTime, "Mon 03:00");
  assertEquals(result.overlaps[0].jobs.length, 2);
  // Every collision lands at 03:00 UTC.
  assertEquals(result.overlaps.every((o) => o.utcTime.endsWith("03:00")), true);
});

Deno.test("findScheduleOverlaps: returns no overlaps for staggered jobs", () => {
  const result = findScheduleOverlaps([
    { name: "a", schedule: "0 3 * * *" },
    { name: "b", schedule: "30 3 * * *" },
  ]);
  assertEquals(result.overlaps.length, 0);
  assertEquals(result.minGapMinutes, 30);
});

// ---------------------------------------------------------------------------
// firstFiringMinuteOfDay / sortByFirstFiringTime
// ---------------------------------------------------------------------------

Deno.test("firstFiringMinuteOfDay: daily and every-6h first firing minute", () => {
  assertEquals(firstFiringMinuteOfDay("0 2 * * *"), 2 * 60); // 02:00 -> 120
  assertEquals(firstFiringMinuteOfDay("30 4 * * *"), 4 * 60 + 30); // 04:30 -> 270
  assertEquals(firstFiringMinuteOfDay("15 */6 * * *"), 15); // 00:15 -> 15
  assertEquals(firstFiringMinuteOfDay("0 * * * *"), 0); // 00:00 -> 0
});

Deno.test("sortByFirstFiringTime: orders schedules earliest-in-day first", () => {
  const sorted = sortByFirstFiringTime([
    { name: "late", schedule: "0 5 * * *" }, // 05:00
    { name: "early", schedule: "15 */6 * * *" }, // 00:15
    { name: "mid", schedule: "0 3 * * *" }, // 03:00
  ]);
  assertEquals(sorted.map((s) => s.name), ["early", "mid", "late"]);
});

// ---------------------------------------------------------------------------
// describeCronSchedule
// ---------------------------------------------------------------------------

Deno.test("describeCronSchedule: daily at a fixed time", () => {
  assertEquals(describeCronSchedule("0 2 * * *"), "Daily at 02:00 UTC");
  assertEquals(describeCronSchedule("30 4 * * *"), "Daily at 04:30 UTC");
  assertEquals(describeCronSchedule("0 5 * * *"), "Daily at 05:00 UTC");
});

Deno.test("describeCronSchedule: every N hours at a fixed minute", () => {
  assertEquals(describeCronSchedule("15 */6 * * *"), "Every 6 hours at 00:15, 06:15, 12:15, 18:15 UTC");
  assertEquals(describeCronSchedule("45 */6 * * *"), "Every 6 hours at 00:45, 06:45, 12:45, 18:45 UTC");
});

Deno.test("describeCronSchedule: hourly and every-N-minutes", () => {
  assertEquals(describeCronSchedule("0 * * * *"), "Hourly at :00 past the hour");
  assertEquals(describeCronSchedule("*/15 * * * *"), "Every 15 minutes");
});

Deno.test("describeCronSchedule: falls back to raw expression for unsupported patterns", () => {
  // restricted day-of-week, lists, and malformed input are returned unchanged
  assertEquals(describeCronSchedule("0 2 * * 1"), "0 2 * * 1");
  assertEquals(describeCronSchedule("0 2,14 * * *"), "0 2,14 * * *");
  assertEquals(describeCronSchedule("not a cron"), "not a cron");
});

// ---------------------------------------------------------------------------
// parseSchedulesFromSource / resolveScheduleValue
// ---------------------------------------------------------------------------

Deno.test("parseSchedulesFromSource: extracts name + schedule tokens", () => {
  const source = `
    export const JOB_REGISTRY = [
      { name: "db-backup", schedule: envConfig.backup.scheduleCron, handler: runDbBackup },
      { name: "cleanup-traces", schedule: "0 2 * * *", handler: cleanupExpiredTraces },
    ];
  `;
  assertEquals(parseSchedulesFromSource(source), [
    { name: "db-backup", scheduleValue: "envConfig.backup.scheduleCron" },
    { name: "cleanup-traces", scheduleValue: '"0 2 * * *"' },
  ]);
});

Deno.test("resolveScheduleValue: quoted literal and unknown expression", () => {
  // Registry schedules are always quoted cron literals -> returned as-is.
  assertEquals(resolveScheduleValue('"0 2 * * *"'), "0 2 * * *");
  assertEquals(resolveScheduleValue('"15 1-23/2 * * *"'), "15 1-23/2 * * *");
  // Any non-literal expression is unresolvable -> null.
  assertEquals(resolveScheduleValue("envConfig.backup.scheduleCron"), null);
  assertEquals(resolveScheduleValue("someOther.expr"), null);
});

// ---------------------------------------------------------------------------
// formatOverlapReport
// ---------------------------------------------------------------------------

Deno.test("formatOverlapReport: lists each job and any overlap", () => {
  const result = findScheduleOverlaps([
    { name: "db-backup", schedule: "0 3 * * *" },
    { name: "bloom-rebuild", schedule: "0 3 * * *" },
  ]);
  const schedules = [
    { name: "db-backup", schedule: "0 3 * * *" },
    { name: "bloom-rebuild", schedule: "0 3 * * *" },
  ];
  const report = formatOverlapReport(result, schedules);
  assertStringIncludes(report, "db-backup");
  assertStringIncludes(report, "bloom-rebuild");
  assertStringIncludes(report, "03:00");
});

// ---------------------------------------------------------------------------
// Real registry guard (parses jobs/registry.ts as text — no app import)
// ---------------------------------------------------------------------------

Deno.test("registry: real JOB_REGISTRY parses to collision-free schedules", async () => {
  const registryUrl = new URL("../../../jobs/registry.ts", import.meta.url);
  const source = await Deno.readTextFile(registryUrl);
  const parsed = parseSchedulesFromSource(source);
  const schedules = parsed
    .map((p) => ({ name: p.name, schedule: resolveScheduleValue(p.scheduleValue) }))
    .filter((s): s is { name: string; schedule: string } => s.schedule !== null);

  // Every registry entry must resolve to a concrete schedule.
  assertEquals(schedules.length, parsed.length);
  // And none of them share a firing minute.
  const result = findScheduleOverlaps(schedules);
  assertEquals(result.overlaps.length, 0);
  // Policy guard: no two jobs should fire within 15 minutes of each other.
  assertEquals(result.minGapMinutes !== null && result.minGapMinutes >= 15, true);
});
