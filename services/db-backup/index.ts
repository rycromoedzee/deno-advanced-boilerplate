/**
 * @file db-backup/index.ts
 * @description Barrel re-exports for the db-backup module.
 *
 * This is an intentional **script-style** backup module: it is a collection of
 * pure functions and interfaces (dump streaming, preflight safety checks,
 * retention computation) driven by the backup job — there is no service class
 * and therefore no `singletons.ts`, by design. Do not wrap these in a fake
 * service class.
 */

// Functions
export { createDumpStream } from "./dump.ts";
export { assertBackupStorageSafe } from "./preflight.ts";
export { computeRetention } from "./retention.ts";

// Types
export type { PreflightInputs } from "./preflight.ts";
export type { RetentionConfig, RetentionResult } from "./retention.ts";
