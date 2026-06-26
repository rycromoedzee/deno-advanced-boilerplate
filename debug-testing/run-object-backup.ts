import { runObjectStorageBackup } from "@jobs/object-storage-backup.job.ts";

await runObjectStorageBackup();

Deno.exit(0);
