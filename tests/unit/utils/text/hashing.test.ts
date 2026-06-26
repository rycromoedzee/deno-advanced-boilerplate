import { assert, assertEquals } from "@std/assert";
import { BloomFilter, CommonPasswordFilter } from "@utils/text/hashing.ts";

/**
 * CommonPasswordFilter — backed by a self-contained Bloom filter.
 *
 * Uses the `withDataSource(loader)` seam (Phase 9h) to inject an in-memory
 * fixture so the test NEVER touches the real `libs/passwords.json`. The filter
 * is built lazily on first use and cached for the process lifetime, so we must
 * inject the fixture BEFORE the first `isCommon` call.
 *
 * Bloom-filter semantics matter for the assertions: false positives are
 * POSSIBLE (a safe password may be flagged), but false negatives are NOT
 * (a known-common password is ALWAYS flagged). So we only assert that the
 * fixture entries are flagged, and that a clearly-strong, dissimilar password
 * is accepted (which holds deterministically for a tiny fixture).
 */

// Small fixture of well-known common passwords.
const FIXTURE = ["password", "123456", "qwerty", "letmein", "admin", "welcome"];

async function withFixture<T>(fn: () => Promise<T>): Promise<T> {
  // Inject a fresh fixture source before each test so cached state never leaks
  // between tests. The loader returns raw JSON text, matching the production
  // data-source contract (Deno.readTextFile of the JSON array).
  CommonPasswordFilter.withDataSource(async () => JSON.stringify(FIXTURE));
  return await fn();
}

Deno.test("CommonPasswordFilter.isCommon: flags passwords present in the fixture (lowercased)", async () => {
  await withFixture(async () => {
    for (const pw of FIXTURE) {
      assertTrue(await CommonPasswordFilter.isCommon(pw), `expected '${pw}' to be common`);
      assertTrue(await CommonPasswordFilter.isCommon(pw.toUpperCase()), `expected case-insensitive match for '${pw}'`);
    }
  });
});

Deno.test("CommonPasswordFilter.isCommon: accepts a strong, dissimilar password", async () => {
  await withFixture(async () => {
    // A long, high-entropy password with no overlap to any fixture entry.
    // For a 6-entry fixture this is a deterministic true (not a false positive).
    const strong = "xQ7!vN2#kL9$mP4&rT8";
    assertFalse(await CommonPasswordFilter.isCommon(strong), "strong password should not be flagged as common");
  });
});

Deno.test("CommonPasswordFilter.warmUp: builds the filter eagerly without error", async () => {
  await withFixture(async () => {
    await CommonPasswordFilter.warmUp();
    // After warmUp, isCommon still works.
    assertTrue(await CommonPasswordFilter.isCommon("password"));
  });
});

Deno.test("CommonPasswordFilter: a fixture containing a non-string entry is tolerated", async () => {
  // build() skips entries that aren't strings; the valid entries still load.
  CommonPasswordFilter.withDataSource(async () => JSON.stringify(["password", 12345, null, { not: "a string" }, "qwerty"]));
  assertTrue(await CommonPasswordFilter.isCommon("password"));
  assertTrue(await CommonPasswordFilter.isCommon("qwerty"));
  assertFalse(await CommonPasswordFilter.isCommon("xQ7!vN2#kL9$mP4&rT8"));
});

Deno.test("CommonPasswordFilter: a non-array data source fails open (isCommon → false)", async () => {
  // build() throws on non-array; getFilter swallows that and caches null.
  // isCommon then fail-opens to false so a load failure never blocks auth.
  CommonPasswordFilter.withDataSource(async () => JSON.stringify({ not: "an array" }));
  assertFalse(await CommonPasswordFilter.isCommon("password"), "should fail-open to false on bad data");
  assertFalse(await CommonPasswordFilter.isCommon("anything"));
});

/* ----------------------------- BloomFilter (direct) ----------------------- */
// Exercise the underlying filter class directly for deterministic semantics.

Deno.test("BloomFilter: has() returns true for added items (no false negatives)", () => {
  const bf = new BloomFilter(1000, 0.001);
  bf.add("alpha");
  bf.add("beta");
  bf.add("gamma");
  assertTrue(bf.has("alpha"));
  assertTrue(bf.has("beta"));
  assertTrue(bf.has("gamma"));
});

Deno.test("BloomFilter: has() returns false for items definitely not added", () => {
  const bf = new BloomFilter(1000, 0.001);
  bf.add("alpha");
  // A clearly-absent short string — with 1000 capacity and 0.1% FPR the chance
  // of a false positive on a handful of probes is negligible; we probe several
  // to make a flake vanishingly unlikely.
  for (const absent of ["zzz-not-there-1", "zzz-not-there-2", "zzz-not-there-3", "zzz-not-there-4"]) {
    assertFalse(bf.has(absent), `unexpected false positive for '${absent}'`);
  }
});

Deno.test("BloomFilter: is case-sensitive (add() does not lowercase; that's the caller's job)", () => {
  const bf = new BloomFilter(100, 0.01);
  bf.add("Password");
  assertTrue(bf.has("Password"));
  assertFalse(bf.has("password")); // different string — not present
});

Deno.test("BloomFilter: memoryKB is a positive number", () => {
  const bf = new BloomFilter(1000, 0.001);
  assertEquals(typeof bf.memoryKB, "number");
  assertTrue(bf.memoryKB > 0);
});

function assertTrue<T>(value: T, message?: string): void {
  assert(value, message ?? `expected truthy, got ${String(value)}`);
}

function assertFalse(value: unknown, message?: string): void {
  assert(!value, message ?? `expected falsy, got ${String(value)}`);
}
