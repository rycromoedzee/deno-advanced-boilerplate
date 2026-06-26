import { assertEquals, assertFalse } from "@std/assert";
import {
  convertToApiFormat,
  convertToStorageFormat,
  detectTimestampFormat,
  validateTimestamp,
} from "@utils/shared/timestamp-conversion.ts";

/**
 * Timestamp detection + conversion utilities.
 *
 * Threshold for seconds vs milliseconds is 1_000_000_000_000 (year 2001 in ms):
 *   - values ABOVE  the threshold → treated as milliseconds
 *   - values AT/BELOW the threshold → treated as seconds
 */

Deno.test("detectTimestampFormat: classifies seconds below the 1e12 threshold", () => {
  assertEquals(detectTimestampFormat(1_700_000_000), "seconds"); // ~2023
  assertEquals(detectTimestampFormat(0), "seconds");
  assertEquals(detectTimestampFormat(1_000_000_000_000), "seconds"); // boundary is NOT >
});

Deno.test("detectTimestampFormat: classifies milliseconds above the 1e12 threshold", () => {
  assertEquals(detectTimestampFormat(1_700_000_000_000), "milliseconds"); // ~2023 in ms
  assertEquals(detectTimestampFormat(1_000_000_000_001), "milliseconds"); // just over boundary
});

Deno.test("convertToStorageFormat: ms → seconds (floored), seconds pass through", () => {
  assertEquals(convertToStorageFormat(1_700_000_000_500), 1_700_000_000); // ms floored to s
  assertEquals(convertToStorageFormat(1_700_000_000), 1_700_000_000); // already seconds
});

Deno.test("convertToApiFormat: seconds → milliseconds, ms pass through", () => {
  assertEquals(convertToApiFormat(1_700_000_000), 1_700_000_000_000); // 1.7e12
  assertEquals(convertToApiFormat(1_700_000_000_000), 1_700_000_000_000); // already ms
});

Deno.test("round-trip: seconds → api(ms) → storage(s) is identity", () => {
  const seconds = 1_700_000_000;
  const asMs = convertToApiFormat(seconds);
  const backToSeconds = convertToStorageFormat(asMs);
  assertEquals(backToSeconds, seconds);
});

Deno.test("round-trip: milliseconds → storage(s) → api(ms) loses sub-second precision but keeps the second", () => {
  const ms = 1_700_000_000_999; // sub-second component present
  const asSeconds = convertToStorageFormat(ms); // 1_700_000_000
  const backToMs = convertToApiFormat(asSeconds); // 1_700_000_000_000
  assertEquals(asSeconds, 1_700_000_000);
  assertEquals(backToMs, 1_700_000_000_000);
});

Deno.test("validateTimestamp: returns true for future timestamps, false for past/now", () => {
  const futureSeconds = Math.floor(Date.now() / 1000) + 3600; // +1h
  const pastSeconds = Math.floor(Date.now() / 1000) - 3600; // -1h
  assertTrue(validateTimestamp(futureSeconds, "seconds"));
  assertFalse(validateTimestamp(pastSeconds, "seconds"));

  const futureMs = Date.now() + 3600_000;
  const pastMs = Date.now() - 3600_000;
  assertTrue(validateTimestamp(futureMs, "milliseconds"));
  assertFalse(validateTimestamp(pastMs, "milliseconds"));
});

Deno.test("validateTimestamp: rejects non-finite / non-number inputs", () => {
  // NaN is a valid `number` type but must be rejected at runtime by the isFinite guard.
  assertFalse(validateTimestamp(NaN, "seconds"));
  assertFalse(validateTimestamp(Infinity, "seconds"));
  assertFalse(validateTimestamp(-Infinity, "seconds"));
});

// Local assertTrue to pair with the @std/assert assertFalse import.
function assertTrue(value: unknown): void {
  if (!value) throw new Error(`expected truthy, got ${String(value)}`);
}
