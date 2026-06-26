/**
 * @file tests/unit/services/object-backup/preflight.test.ts
 * @description Unit tests for the object-storage-backup boot guard (DD7).
 *
 * The guard is pure — it takes an explicit input (not envConfig) — so every
 * fail-closed branch is testable in isolation with no env vars or network.
 */
import { assertThrows } from "@std/assert";
import { assertObjectBackupStorageSafe } from "@services/object-backup/preflight.ts";
import type { ObjectBackupPreflightDestination, ObjectBackupPreflightInput } from "@services/object-backup/preflight.ts";

// A destination that is fully populated and uses credentials DIFFERENT from the
// source — the "everything is fine" baseline.
const INDEPENDENT_BUNNY_DEST: ObjectBackupPreflightDestination = {
  type: "bunny",
  region: "NewYork",
  name: "backup-zone",
  key: "backup-access-key-zzzzzzzzzzzz",
};

function mk(
  opts: {
    enabled?: boolean;
    isDevOrTest?: boolean;
    nodeEnvExplicit?: boolean;
    sourceType?: string;
    sourceKey?: string;
    sourceSecretKey?: string;
    destination?: Partial<ObjectBackupPreflightDestination>;
  } = {},
): ObjectBackupPreflightInput {
  return {
    enabled: opts.enabled ?? true,
    isDevOrTest: opts.isDevOrTest ?? false,
    nodeEnvExplicit: opts.nodeEnvExplicit ?? true,
    sourceType: opts.sourceType ?? "bunny",
    sourceKey: opts.sourceKey ?? "live-access-key-aaaaaaaaaa",
    sourceSecretKey: opts.sourceSecretKey,
    destination: { ...INDEPENDENT_BUNNY_DEST, ...opts.destination },
  };
}

function expectThrow(input: ObjectBackupPreflightInput, msgSub: string): void {
  assertThrows(
    () => assertObjectBackupStorageSafe(input),
    Error,
    msgSub,
  );
}

// ---------------------------------------------------------------------------
// disabled → no-op
// ---------------------------------------------------------------------------

Deno.test("preflight: disabled is a no-op regardless of (bad) destination config", () => {
  // Even a totally empty/garbage destination must not throw when disabled.
  assertObjectBackupStorageSafe(mk({ enabled: false, destination: { type: "", key: "" } }));
});

// ---------------------------------------------------------------------------
// (1) NODE_ENV must be explicit
// ---------------------------------------------------------------------------

Deno.test("preflight: enabled with an implicit (defaulted) NODE_ENV fails closed", () => {
  expectThrow(mk({ nodeEnvExplicit: false }), "NODE_ENV is not explicitly set");
});

// ---------------------------------------------------------------------------
// (2) presence — fail-closed first
// ---------------------------------------------------------------------------

Deno.test("preflight: enabled with an unset/invalid BACKUP_STORAGE_TYPE fails closed", () => {
  expectThrow(mk({ destination: { type: "" } }), "missing or invalid");
  expectThrow(mk({ destination: { type: "ftp" } }), "missing or invalid");
});

Deno.test("preflight: enabled with an incomplete bunny destination fails closed", () => {
  expectThrow(
    mk({ destination: { type: "bunny", region: "", name: "z", key: "k" } }),
    "incomplete",
  );
  expectThrow(
    mk({ destination: { type: "bunny", region: "NewYork", name: "", key: "k" } }),
    "BACKUP_STORAGE_NAME",
  );
});

Deno.test("preflight: enabled with an incomplete s3 destination fails closed", () => {
  expectThrow(
    mk({
      sourceType: "s3",
      sourceKey: "live-ak",
      sourceSecretKey: "live-sk",
      destination: { type: "s3", region: "us-east-1", name: "b", key: "ak", secretKey: "", endpoint: "https://s3" },
    }),
    "BACKUP_STORAGE_SECRET_KEY",
  );
});

// ---------------------------------------------------------------------------
// (3) local is DR theater outside dev/test
// ---------------------------------------------------------------------------

Deno.test("preflight: local destination is allowed in dev/test", () => {
  // No throw.
  assertObjectBackupStorageSafe(mk({ isDevOrTest: true, destination: { type: "local" } }));
});

Deno.test("preflight: local destination is rejected in production", () => {
  expectThrow(mk({ isDevOrTest: false, destination: { type: "local" } }), "DR theater");
});

Deno.test("preflight: local destination is rejected in staging (not just production)", () => {
  // env "staging" is neither development nor test.
  expectThrow(mk({ isDevOrTest: false, destination: { type: "local" } }), "DR theater");
});

// ---------------------------------------------------------------------------
// (4) independence judged on credentials, not names
// ---------------------------------------------------------------------------

Deno.test("preflight: independent bunny destination (different access key) passes", () => {
  // No throw.
  assertObjectBackupStorageSafe(mk({}));
});

Deno.test("preflight: bunny destination sharing the source access key is rejected", () => {
  expectThrow(
    mk({ destination: { type: "bunny", region: "NewYork", name: "different-zone", key: "live-access-key-aaaaaaaaaa" } }),
    "equals STORAGE_ACCESS_KEY",
  );
});

Deno.test("preflight: s3 destination sharing the source secret key is rejected", () => {
  expectThrow(
    mk({
      sourceType: "s3",
      sourceKey: "live-ak",
      sourceSecretKey: "live-sk-shared",
      destination: {
        type: "s3",
        region: "us-east-1",
        name: "backup-bucket",
        key: "different-ak",
        secretKey: "live-sk-shared", // same account, different bucket — still rejected
        endpoint: "https://s3.example.com",
      },
    }),
    "equals STORAGE_SECRET_KEY",
  );
});

Deno.test("preflight: same bucket NAME but different credentials is allowed (cross-account)", () => {
  // name/endpoint identical to a hypothetical source, but credentials differ —
  // that is a legitimately independent (cross-account) destination.
  assertObjectBackupStorageSafe(
    mk({
      sourceType: "s3",
      sourceKey: "account-a-key",
      sourceSecretKey: "account-a-secret",
      destination: {
        type: "s3",
        region: "us-east-1",
        name: "app-bucket", // same name as source
        key: "account-b-key", // different account
        secretKey: "account-b-secret",
        endpoint: "https://s3.example.com",
      },
    }),
  );
});

Deno.test("preflight: an empty source credential does not false-positive against a set destination key", () => {
  // Source unset (e.g. live=local) + a real backup key must NOT be treated as
  // "same account" — only a real match of two populated values is.
  assertObjectBackupStorageSafe(
    mk({ sourceKey: undefined, destination: { type: "bunny", region: "NewYork", name: "z", key: "real-backup-key" } }),
  );
});
