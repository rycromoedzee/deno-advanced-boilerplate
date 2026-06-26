/**
 * @file scripts/verify-job-overlaps.ts
 * @description Check every job in the registry for cron firing-time collisions
 */
/**
 * Job Schedule Overlap Checker
 *
 * Reads jobs/registry.ts as text and extracts each job's name + schedule, then
 * reports any minute where two or more jobs fire together, plus the closest
 * approach between any two jobs. Schedules are listed earliest-in-day first with
 * an English translation. Exits non-zero if overlaps exist, so it can gate CI.
 *
 * Run:  deno task jobs:check-overlaps
 *
 * The registry binds each job's handler inline, so *importing* it loads the full
 * application graph (native libsql client + image-processing WASM) and blocks on
 * network I/O at startup. To stay instant and offline, this script parses the
 * schedule literals out of the source instead of importing the module — registry
 * stays the single source of truth, with no second copy of the data.
 *
 * The cron + parsing logic is pure and unit-tested in
 * tests/unit/jobs/schedule-overlaps.test.ts.
 */

/** Minimal schedule shape consumed by the detector. */
export interface CronSchedule {
  readonly name: string;
  readonly schedule: string;
}

/** A raw { name, schedule-value } pair pulled from the registry source. */
export interface ParsedSchedule {
  readonly name: string;
  /** The schedule token as written: a quoted literal or an expression. */
  readonly scheduleValue: string;
}

/** A minute where two or more jobs fire together. */
export interface ScheduleOverlap {
  /** The overlapping UTC instant, formatted "Mon HH:MM" */
  readonly utcTime: string;
  /** The overlapping instant as epoch milliseconds */
  readonly minuteUtc: number;
  /** Names of every job firing at this minute */
  readonly jobs: readonly string[];
}

/** Result of an overlap scan. */
export interface OverlapResult {
  /** Every minute where >= 2 jobs fire together (empty = no overlaps) */
  readonly overlaps: readonly ScheduleOverlap[];
  /** Smallest gap (minutes) between any two job firings, or null if none fire */
  readonly minGapMinutes: number | null;
  /** Number of schedules scanned */
  readonly checkedJobs: number;
  /** Window length in days */
  readonly windowDays: number;
}

/**
 * Fixed UTC anchor for scans (Mon 2024-01-01 00:00). Deterministic across runs
 * and machines — overlap results never depend on when the check is invoked.
 */
const SCAN_ANCHOR_MS = Date.UTC(2024, 0, 1, 0, 0, 0);
/** One representative UTC day, used to compute each schedule's first firing minute. */
const DAY_ANCHOR_MS = Date.UTC(2024, 0, 1, 0, 0, 0);

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * Extract { name, scheduleValue } pairs from registry source text.
 *
 * Matches each `name: "..."` followed (within the same entry) by its
 * `schedule:` token — either a quoted literal or an identifier expression.
 */
export function parseSchedulesFromSource(source: string): ParsedSchedule[] {
  const pattern = /name:\s*"([^"]+)",[\s\S]*?schedule:\s*("[^"]+"|[\w.$]+)/g;
  const results: ParsedSchedule[] = [];
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source)) !== null) {
    results.push({ name: match[1], scheduleValue: match[2] });
  }
  return results;
}

/**
 * Resolve a parsed schedule token to a concrete cron expression.
 *
 * Every registry entry writes its schedule as a quoted cron literal, so the
 * literal is returned as-is. Any non-literal expression is unresolvable here
 * (the registry is the single source of truth for schedules) and returns null.
 */
export function resolveScheduleValue(scheduleValue: string): string | null {
  const token = scheduleValue.trim();
  if (token.startsWith('"') && token.endsWith('"')) {
    return token.slice(1, -1);
  }
  return null;
}

/**
 * Test whether a single cron field matches a calendar value.
 *
 * Supports: wildcard, literal (e.g. 5), range (2-6), list (1,3,5), step
 * (wildcard-slash-N, e.g. every 15 minutes), and ranged step (2-10 every 2).
 */
export function matchesCronField(value: number, expr: string): boolean {
  if (expr === "*") return true;
  if (expr.includes(",")) {
    return expr.split(",").some((part) => matchesCronField(value, part));
  }
  if (expr.includes("/")) {
    const [base, stepStr] = expr.split("/");
    const step = parseInt(stepStr, 10);
    if (base === "*") return value % step === 0;
    if (base.includes("-")) {
      const [start, end] = base.split("-").map((n) => parseInt(n, 10));
      return value >= start && value <= end && (value - start) % step === 0;
    }
    return value === parseInt(base, 10);
  }
  if (expr.includes("-")) {
    const [start, end] = expr.split("-").map((n) => parseInt(n, 10));
    return value >= start && value <= end;
  }
  return parseInt(expr, 10) === value;
}

/**
 * Test whether a 5-field UTC cron expression fires at the given instant.
 *
 * Implements the Vixie cron day rule: when both day-of-month and day-of-week are
 * restricted, either matching is sufficient; otherwise both must match. Sunday
 * is accepted as either 0 or 7.
 */
export function cronJobFiresAt(schedule: string, date: Date): boolean {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) {
    throw new Error(`Invalid cron expression (expected 5 fields): "${schedule}"`);
  }
  const [minExpr, hourExpr, domExpr, monthExpr, dowExpr] = fields;

  const minuteMatch = matchesCronField(date.getUTCMinutes(), minExpr);
  const hourMatch = matchesCronField(date.getUTCHours(), hourExpr);
  const monthMatch = matchesCronField(date.getUTCMonth() + 1, monthExpr);
  const domMatch = matchesCronField(date.getUTCDate(), domExpr);

  const dow = date.getUTCDay();
  const dowMatch = matchesCronField(dow, dowExpr) || (dow === 0 && matchesCronField(7, dowExpr));

  const domRestricted = domExpr !== "*";
  const dowRestricted = dowExpr !== "*";
  const dayMatch = (domRestricted && dowRestricted) ? (domMatch || dowMatch) : (domMatch && dowMatch);

  return minuteMatch && hourMatch && monthMatch && dayMatch;
}

/**
 * The minute-of-day (0-1439, UTC) when a schedule first fires, used to sort the
 * schedule listing earliest-in-day first. Returns MAX_SAFE_INTEGER for an
 * expression that never fires on the anchor day (sorted last).
 */
export function firstFiringMinuteOfDay(schedule: string): number {
  for (let minute = 0; minute < 24 * 60; minute++) {
    if (cronJobFiresAt(schedule, new Date(DAY_ANCHOR_MS + minute * 60_000))) {
      return minute;
    }
  }
  return Number.MAX_SAFE_INTEGER;
}

/**
 * Return a copy of the schedules sorted by earliest firing minute-of-day.
 */
export function sortByFirstFiringTime<T extends CronSchedule>(schedules: readonly T[]): T[] {
  return [...schedules].sort((a, b) => firstFiringMinuteOfDay(a.schedule) - firstFiringMinuteOfDay(b.schedule));
}

function formatUtcInstant(ms: number): string {
  const d = new Date(ms);
  const day = WEEKDAY_LABELS[d.getUTCDay()];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${day} ${hh}:${mm}`;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function plural(count: number): string {
  return count === 1 ? "" : "s";
}

/**
 * Render a 5-field UTC cron expression as a human-readable English phrase.
 *
 * Translates the patterns the registry uses — daily at a fixed time, every N
 * hours at a fixed minute, hourly, every N minutes — and falls back to the raw
 * expression for anything more exotic (restricted day-of-month/day-of-week,
 * lists, ranges).
 */
export function describeCronSchedule(schedule: string): string {
  const fields = schedule.trim().split(/\s+/);
  if (fields.length !== 5) return schedule;
  const [minExpr, hourExpr, domExpr, _monthExpr, dowExpr] = fields;

  // Only every-day patterns are translated; anything day-restricted falls back.
  if (domExpr !== "*" || dowExpr !== "*") return schedule;

  // Every N minutes (minute step, any hour).
  if (minExpr.startsWith("*/")) {
    const n = parseInt(minExpr.slice(2), 10);
    if (hourExpr === "*") return `Every ${n} minute${plural(n)}`;
    return schedule;
  }

  // Minute is literal from here.
  const minute = parseInt(minExpr, 10);

  // Every N hours at a fixed minute.
  if (hourExpr.startsWith("*/")) {
    const n = parseInt(hourExpr.slice(2), 10);
    const times: string[] = [];
    for (let h = 0; h < 24; h += n) {
      times.push(`${pad2(h)}:${pad2(minute)}`);
    }
    return `Every ${n} hour${plural(n)} at ${times.join(", ")} UTC`;
  }

  // Hourly at a fixed minute.
  if (hourExpr === "*") {
    return `Hourly at :${pad2(minute)} past the hour`;
  }

  // Daily at a fixed time.
  if (/^\d+$/.test(hourExpr)) {
    return `Daily at ${pad2(parseInt(hourExpr, 10))}:${pad2(minute)} UTC`;
  }

  return schedule;
}

/**
 * Scan a set of cron schedules over a window and find every minute where two or
 * more jobs fire together. Also reports the smallest gap between any two job
 * firings (informational — near-collisions the human may want to spread out).
 *
 * @param schedules Jobs to scan (name + cron expression).
 * @param windowDays Window length in days (default 7 covers weekly patterns).
 */
export function findScheduleOverlaps(
  schedules: readonly CronSchedule[],
  windowDays = 7,
): OverlapResult {
  const totalMinutes = windowDays * 24 * 60;
  const overlaps: ScheduleOverlap[] = [];
  const firingInstants: number[] = [];

  for (let i = 0; i < totalMinutes; i++) {
    const ms = SCAN_ANCHOR_MS + i * 60_000;
    const date = new Date(ms);
    const firing = schedules
      .filter((entry) => cronJobFiresAt(entry.schedule, date))
      .map((entry) => entry.name);

    if (firing.length > 0) {
      firingInstants.push(ms);
      if (firing.length > 1) {
        overlaps.push({ minuteUtc: ms, utcTime: formatUtcInstant(ms), jobs: firing });
      }
    }
  }

  let minGapMinutes: number | null = null;
  for (let i = 1; i < firingInstants.length; i++) {
    const gap = Math.round((firingInstants[i] - firingInstants[i - 1]) / 60_000);
    if (minGapMinutes === null || gap < minGapMinutes) {
      minGapMinutes = gap;
    }
  }

  return { overlaps, minGapMinutes, checkedJobs: schedules.length, windowDays };
}

/**
 * Render an {@link OverlapResult} as a human-readable report string.
 *
 * @param result Output of {@link findScheduleOverlaps}.
 * @param schedules Optional schedule list (already sorted) to echo each job's expression.
 */
export function formatOverlapReport(
  result: OverlapResult,
  schedules?: readonly CronSchedule[],
): string {
  const lines: string[] = [];
  lines.push(`Job schedule overlap check — ${result.checkedJobs} jobs over a ${result.windowDays}-day window (UTC)`);

  if (schedules && schedules.length > 0) {
    lines.push("");
    lines.push("Schedules (earliest-in-day first):");
    const nameWidth = Math.max(...schedules.map((s) => s.name.length));
    const scheduleWidth = Math.max(...schedules.map((s) => s.schedule.length));
    for (const entry of schedules) {
      lines.push(`  ${entry.name.padEnd(nameWidth)}  ${entry.schedule.padEnd(scheduleWidth)}  ${describeCronSchedule(entry.schedule)}`);
    }
  }

  lines.push("");
  if (result.minGapMinutes !== null) {
    lines.push(`Closest approach between any two jobs: ${result.minGapMinutes} minute(s)`);
  } else {
    lines.push("No jobs fire within the window.");
  }

  lines.push("");
  if (result.overlaps.length === 0) {
    lines.push("No overlaps found — no two jobs share a firing minute.");
  } else {
    lines.push(`OVERLAPS (${result.overlaps.length}):`);
    for (const overlap of result.overlaps) {
      lines.push(`  ${overlap.utcTime}  ->  ${overlap.jobs.join(", ")}`);
    }
  }

  return lines.join("\n");
}

async function main(): Promise<void> {
  // Read the registry source (not import it) to avoid loading the app graph.
  const registryUrl = new URL("../jobs/registry.ts", import.meta.url);
  const source = await Deno.readTextFile(registryUrl);

  const schedules: CronSchedule[] = [];
  for (const parsed of parseSchedulesFromSource(source)) {
    const schedule = resolveScheduleValue(parsed.scheduleValue);
    if (schedule) {
      schedules.push({ name: parsed.name, schedule });
    } else {
      console.error(`warning: could not resolve schedule for "${parsed.name}" (${parsed.scheduleValue})`);
    }
  }

  const sorted = sortByFirstFiringTime(schedules);
  const result = findScheduleOverlaps(sorted, 7);
  console.log(formatOverlapReport(result, sorted));

  if (result.overlaps.length > 0) {
    console.error(`\n✗ ${result.overlaps.length} overlap(s) found.`);
    Deno.exit(1);
  }
  console.log("\n✓ No schedule overlaps detected.");
}

if (import.meta.main) {
  await main();
}
