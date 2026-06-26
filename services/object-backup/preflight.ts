/**
 * @file services/object-backup/preflight.ts
 * @description Boot-time independence guard for object-storage backup (DD7).
 *
 * Pure and fail-closed. Run at module load in `main.ts` and
 * `jobs/runners/standalone.ts` — the same shape as
 * `services/db-backup/preflight.ts`. It takes its input explicitly (not from
 * `envConfig`) so it is trivially unit-testable and so each caller assembles
 * the {source, destination, env} triple in one place.
 *
 * Order matters and is load-bearing:
 *  1. NODE_ENV must be explicitly set (it defaults to "development", which
 *     would otherwise bypass the dev/test exemptions below).
 *  2. Presence — fail-closed FIRST. Unset `BACKUP_STORAGE_*` leaves destination
 *     fields empty; an identity comparison against defined source strings is
 *     trivially "not equal", so without this check the guard would PASS garbage
 *     and the provider would only throw at first use (backup silently never
 *     runs).
 *  3. A `local` destination is DR theater outside dev/test.
 *  4. Independence is judged on CREDENTIALS, not names — same access key = same
 *     account = NOT off-site, even with a different bucket/zone. That is the
 *     textbook 3-2-1 failure (one leaked credential / one `deleteBucket`
 *     destroys both copies).
 */

export interface ObjectBackupPreflightDestination {
  type: string;
  region?: string;
  name?: string;
  key?: string;
  secretKey?: string;
  endpoint?: string;
}

export interface ObjectBackupPreflightInput {
  enabled: boolean;
  /** True only when NODE_ENV is explicitly "development" or "test". */
  isDevOrTest: boolean;
  /** True only when NODE_ENV was explicitly provided (not defaulted). */
  nodeEnvExplicit: boolean;
  /** Live provider account identity (for the credential comparison). */
  sourceType: string;
  sourceKey?: string;
  sourceSecretKey?: string;
  /** The backup destination (matches the `envConfig.backupStorage` shape). */
  destination: ObjectBackupPreflightDestination;
}

const KNOWN_TYPES = new Set(["bunny", "s3", "local"]);

export function assertObjectBackupStorageSafe(input: ObjectBackupPreflightInput): void {
  if (!input.enabled) return;

  // (1) NODE_ENV must be explicit. It defaults to "development" (env.ts), so a
  // misconfigured staging/prod box would otherwise read as dev and the
  // dev/test exemptions below would slip through.
  if (!input.nodeEnvExplicit) {
    throw new Error(
      "OBJECT_BACKUP_ENABLED=true but NODE_ENV is not explicitly set. " +
        'Set NODE_ENV explicitly (e.g. "production"/"staging") so the independence guard is not bypassed by its "development" default.',
    );
  }

  const dest = input.destination;

  // (2) Presence — fail-closed FIRST (see file header for why this must precede
  // the identity comparison).
  if (!KNOWN_TYPES.has(dest.type)) {
    throw new Error(
      `OBJECT_BACKUP_ENABLED=true but BACKUP_STORAGE_TYPE="${dest.type}" is missing or invalid. ` +
        "Set it to one of: bunny, s3, local.",
    );
  }
  const missing = requiredFields(dest);
  if (missing.length > 0) {
    throw new Error(
      `OBJECT_BACKUP_ENABLED=true but BACKUP_STORAGE_* is incomplete for type "${dest.type}". Missing: ${missing.join(", ")}.`,
    );
  }

  // (3) local destination is DR theater outside dev/test.
  if (dest.type === "local" && !input.isDevOrTest) {
    throw new Error(
      "OBJECT_BACKUP_ENABLED=true with BACKUP_STORAGE_TYPE=local in a non-development environment. " +
        "Local storage writes backups to the same host as the app — this is DR theater. " +
        "Use an independent bunny/s3 account, or only run object backup in development/test.",
    );
  }

  // (4) Independence judged on credentials. For local there are no credentials,
  // so independence is governed by the dev/test rule above.
  if (dest.type !== "local") {
    if (sameNonEmptyCredential(dest.key, input.sourceKey)) {
      throw new Error(
        "OBJECT_BACKUP_ENABLED=true but BACKUP_STORAGE_ACCESS_KEY equals STORAGE_ACCESS_KEY. " +
          "Same credentials = same account = NOT an off-site copy (3-2-1 violation). Use a different account's access key for the backup destination.",
      );
    }
    if (dest.type === "s3" && sameNonEmptyCredential(dest.secretKey, input.sourceSecretKey)) {
      throw new Error(
        "OBJECT_BACKUP_ENABLED=true but BACKUP_STORAGE_SECRET_KEY equals STORAGE_SECRET_KEY (S3). " +
          "Same credentials = same account = NOT an off-site copy (3-2-1 violation).",
      );
    }
  }
}

/** Required non-empty fields per backend type (local needs none). */
function requiredFields(dest: ObjectBackupPreflightDestination): string[] {
  const missing: string[] = [];
  if (dest.type === "bunny") {
    if (!dest.region) missing.push("BACKUP_STORAGE_REGION");
    if (!dest.name) missing.push("BACKUP_STORAGE_NAME");
    if (!dest.key) missing.push("BACKUP_STORAGE_ACCESS_KEY");
  } else if (dest.type === "s3") {
    if (!dest.region) missing.push("BACKUP_STORAGE_REGION");
    if (!dest.name) missing.push("BACKUP_STORAGE_NAME");
    if (!dest.key) missing.push("BACKUP_STORAGE_ACCESS_KEY");
    if (!dest.secretKey) missing.push("BACKUP_STORAGE_SECRET_KEY");
    if (!dest.endpoint) missing.push("BACKUP_STORAGE_ENDPOINT");
  }
  return missing;
}

/**
 * Two empty credentials are NOT "the same account" — they are just unset
 * (caught by the presence check for the destination). Only flag a real match of
 * two populated, trimmed values.
 */
function sameNonEmptyCredential(a?: string, b?: string): boolean {
  const ta = a?.trim();
  const tb = b?.trim();
  if (!ta || !tb) return false;
  return ta === tb;
}
