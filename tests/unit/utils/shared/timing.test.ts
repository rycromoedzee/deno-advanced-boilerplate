import { assert, assertEquals, assertExists, assertFalse, assertStringIncludes } from "@std/assert";
import { constantTimeMultiCompare, safeEqual, TIMING_PROFILES } from "@utils/shared/timing.ts";

// Source of the utilities under test, read for the structural constant-time
// assertions below. Behavioral timing is too noisy to *prove* constant-time, so
// we assert the implementation delegates to node:crypto.timingSafeEqual.
const timingSrc = () => Deno.readTextFileSync(new URL("../../../../utils/shared/timing.ts", import.meta.url));

/**
 * Security-critical constant-time comparison utilities.
 *
 * The constant-time guarantee CANNOT be proven by behavioral tests: a hand-rolled
 * byte loop that returns on the first mismatch yields identical booleans AND
 * defeats any probabilistic timing guard, while passing every "returns true/false"
 * assertion. So in addition to the boolean/edge-case tests below, we assert
 * STRUCTURALLY that:
 *   - `safeEqual` delegates its byte comparison to `node:crypto.timingSafeEqual`
 *     (the vetted primitive) and contains no hand-rolled numeric byte loop with an
 *     early return; and
 *   - `constantTimeMultiCompare` never returns early (it accumulates into
 *     `overallResult`), so it always runs every comparison.
 */

Deno.test("TIMING_PROFILES: exposes the documented operation profiles with minimumMs + jitterPercent", () => {
  for (const key of ["FAST", "STANDARD", "HEAVY", "AUTH", "PASSWORD"] as const) {
    const profile = TIMING_PROFILES[key];
    assertExists(profile, `expected a profile for ${key}`);
    assertEquals(typeof profile.minimumMs, "number", `${key}.minimumMs should be a number`);
    assertTrue(profile.minimumMs >= 0, `${key}.minimumMs should be non-negative`);
    assertEquals(typeof profile.jitterPercent, "number", `${key}.jitterPercent should be a number`);
    assertTrue(
      profile.jitterPercent >= 0 && profile.jitterPercent <= 100,
      `${key}.jitterPercent should be a percentage in [0,100]`,
    );
  }
});

Deno.test("safeEqual: returns true for equal strings", () => {
  assertTrue(safeEqual("secret-token", "secret-token"));
  assertTrue(safeEqual("abc123", "abc123"));
});

Deno.test("safeEqual: returns false for different strings of equal length", () => {
  assertFalse(safeEqual("secret-token", "secret-tokem"));
  assertFalse(safeEqual("abc123", "abc124"));
});

Deno.test("safeEqual: returns false when lengths differ (no length-leak short-circuit)", () => {
  assertFalse(safeEqual("secret", "secret-extra"));
  assertFalse(safeEqual("long-trusted-value", "short"));
  assertFalse(safeEqual("a", ""));
  assertFalse(safeEqual("", "a"));
});

Deno.test("safeEqual: handles empty strings (both empty → true, one empty → false)", () => {
  assertTrue(safeEqual("", ""));
  assertFalse(safeEqual("", "nonempty"));
  assertFalse(safeEqual("nonempty", ""));
});

Deno.test("safeEqual: returns true for equal Uint8Array values", () => {
  const a = new Uint8Array([1, 2, 3, 4]);
  const b = new Uint8Array([1, 2, 3, 4]);
  assertTrue(safeEqual(a, b));
});

Deno.test("safeEqual: returns false for unequal-length Uint8Array values", () => {
  const a = new Uint8Array([1, 2, 3]);
  const b = new Uint8Array([1, 2, 3, 4]);
  assertFalse(safeEqual(a, b));
});

Deno.test("safeEqual: is symmetric in its string arguments", () => {
  // The function pads to the TRUSTED (first) length, so result is symmetric for
  // equal-length strings and stays false for unequal lengths regardless of order.
  assertEquals(safeEqual("abc", "abc"), safeEqual("abc", "abc"));
  assertEquals(safeEqual("abc", "xyz"), safeEqual("xyz", "abc"));
  assertEquals(safeEqual("abc", "abcd"), safeEqual("abcd", "abc"));
});

Deno.test("safeEqual: byte comparison delegates to node:crypto.timingSafeEqual (constant-time guarantee)", () => {
  // The constant-time property comes ENTIRELY from delegating to the vetted
  // node:crypto primitive. Replacing the timingSafeEqual call with `===` or a
  // hand-rolled `for (i…) { if (a[i] !== b[i]) return false; }` would pass every
  // boolean test above (and any probabilistic timing guard) — this structural
  // check is what catches it.
  const src = timingSrc();
  // safeEqual has three comparison branches (string / Uint8Array / other-buffer);
  // each must go through timingSafeEqual.
  const callSites = (src.match(/timingSafeEqual\(/g) ?? []).length;
  assertTrue(
    callSites >= 3,
    `safeEqual must delegate every comparison to node:crypto.timingSafeEqual (found ${callSites} call sites)`,
  );
  // And there must be no hand-rolled numeric byte loop with an early return — the
  // textbook per-byte timing leak. (`for…of` over comparisons in
  // constantTimeMultiCompare is `for (const`, not matched here.)
  assertFalse(
    /for\s*\(\s*(?:let|var)\s+\w+\s*=\s*\d[\s\S]{0,400}?\breturn\b/.test(src),
    "timing.ts must not contain a numeric for-loop with an early return (per-byte timing leak)",
  );
});

Deno.test("constantTimeMultiCompare: returns true when ALL pairs are equal", () => {
  assertTrue(constantTimeMultiCompare([
    { a: "x", b: "x" },
    { a: "y", b: "y" },
    { a: "z", b: "z" },
  ]));
});

Deno.test("constantTimeMultiCompare: returns false when any pair differs", () => {
  assertFalse(constantTimeMultiCompare([
    { a: "x", b: "x" },
    { a: "y", b: "DIFFERENT" },
    { a: "z", b: "z" },
  ]));
});

Deno.test("constantTimeMultiCompare: returns false on a single unequal pair", () => {
  assertFalse(constantTimeMultiCompare([{ a: "needle", b: "haystack" }]));
  assertTrue(constantTimeMultiCompare([{ a: "needle", b: "needle" }]));
});

Deno.test("constantTimeMultiCompare: empty comparisons array is vacuously true", () => {
  // `overallResult` starts true and no pair flips it — matches "all of nothing".
  assertTrue(constantTimeMultiCompare([]));
});

Deno.test("constantTimeMultiCompare: handles empty strings within pairs", () => {
  assertTrue(constantTimeMultiCompare([{ a: "", b: "" }]));
  assertFalse(constantTimeMultiCompare([{ a: "", b: "x" }]));
});

Deno.test("constantTimeMultiCompare: never short-circuits — runs ALL comparisons (structural)", () => {
  // Its headline guarantee ("always performs all comparisons regardless of early
  // failures") is invisible in the boolean return. A regression to
  // `if (!safeEqual(a, b)) return false;` would pass every test above. So assert
  // structurally: the body accumulates into `overallResult` and the only `return`
  // is the final `return overallResult` (no early exit inside the loop).
  const match = timingSrc().match(/export function constantTimeMultiCompare[\s\S]*?\n\}/);
  assert(match !== null, "constantTimeMultiCompare function not found in timing.ts source");
  const body = match[0];
  assertStringIncludes(body, "overallResult", "must accumulate comparison results (no short-circuit)");
  assertFalse(
    /\breturn\b(?! overallResult)/.test(body),
    "constantTimeMultiCompare must not return early — only `return overallResult` is allowed; an early return leaks which field mismatched first",
  );
});

// Local assertTrue helper to avoid pulling a second assert name.
function assertTrue(value: unknown, message?: string): void {
  assert(value, message ?? `expected truthy value, got ${String(value)}`);
}
