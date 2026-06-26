/**
 * @file tests/unit/services/auth/magic-link-context.helper.test.ts
 * @description Pure-logic tests for the magic-link context-hash + mismatch helpers.
 *
 * No DB / no network — these are pure in-process utilities (repo seam discipline).
 */
import { assertEquals, assertNotEquals } from "@std/assert";
import { detectContextMismatch, hashUserAgent, normalizeUserAgent } from "@services/auth/magic-link-context.helper.ts";

Deno.test("normalizeUserAgent strips volatile version numbers", () => {
  assertEquals(
    normalizeUserAgent("Mozilla/5.0 (Macintosh) Chrome/124.0.6367.91"),
    normalizeUserAgent("Mozilla/5.0 (Macintosh) Chrome/125.0.6422.60"),
  );
});

Deno.test("normalizeUserAgent lowercases and trims", () => {
  // The regex strips any "/<digits.digits>" token, so both "Mozilla/5.0" and
  // "Safari/17.4" collapse to "/?" — only the stable token stem survives.
  assertEquals(
    normalizeUserAgent("  Mozilla/5.0 Safari/17.4  "),
    "mozilla/? safari/?",
  );
});

Deno.test("normalizeUserAgent handles empty input safely", () => {
  assertEquals(normalizeUserAgent(""), "");
  assertEquals(normalizeUserAgent(undefined as unknown as string), "");
});

Deno.test("hashUserAgent is deterministic and does not equal the raw UA", () => {
  const h1 = hashUserAgent("Mozilla/5.0 Chrome/124");
  const h2 = hashUserAgent("Mozilla/5.0 Chrome/124");
  assertEquals(h1, h2);
  assertNotEquals(h1, "Mozilla/5.0 Chrome/124");
  // Minor version drift must hash identically (no false "device changed").
  assertEquals(hashUserAgent("Mozilla/5.0 Chrome/124.0.1"), h1);
});

Deno.test("detectContextMismatch flags an IP change when both sides present", () => {
  assertEquals(
    detectContextMismatch(
      { creatorIP: "1.2.3.4", creatorUAHash: "x" },
      { creatorIP: "9.9.9.9", creatorUAHash: "x" },
    ),
    { ipMismatch: true, uaMismatch: false },
  );
});

Deno.test("detectContextMismatch flags a UA-hash change when both sides present", () => {
  assertEquals(
    detectContextMismatch(
      { creatorIP: "1.2.3.4", creatorUAHash: "aaa" },
      { creatorIP: "1.2.3.4", creatorUAHash: "bbb" },
    ),
    { ipMismatch: false, uaMismatch: true },
  );
});

Deno.test("detectContextMismatch ignores missing creator context (no false alarms)", () => {
  assertEquals(
    detectContextMismatch(
      { creatorIP: "", creatorUAHash: "" },
      { creatorIP: "9.9.9.9", creatorUAHash: "y" },
    ),
    { ipMismatch: false, uaMismatch: false },
  );
});

Deno.test("detectContextMismatch ignores missing consumer context", () => {
  assertEquals(
    detectContextMismatch(
      { creatorIP: "1.2.3.4", creatorUAHash: "x" },
      { creatorIP: "", creatorUAHash: "" },
    ),
    { ipMismatch: false, uaMismatch: false },
  );
});
