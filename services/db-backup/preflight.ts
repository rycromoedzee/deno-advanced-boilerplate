/**
 * @file services/db-backup/preflight.ts
 * @description Preflight service module (db backup)
 */
// services/db-backup/preflight.ts
export interface PreflightInputs {
  enabled: boolean;
  storageType: string;
  env: string;
}

export function assertBackupStorageSafe(input: PreflightInputs): void {
  if (!input.enabled) return;
  if (input.env === "development" || input.env === "test") return;
  if (input.storageType === "local") {
    throw new Error(
      "BACKUP_ENABLED is true but STORAGE_TYPE=local in a non-development environment. " +
        "Local storage writes backups to the same host as the app — this is DR theater. " +
        "Set STORAGE_TYPE to bunny or s3, or disable backups with BACKUP_ENABLED=false.",
    );
  }
}
