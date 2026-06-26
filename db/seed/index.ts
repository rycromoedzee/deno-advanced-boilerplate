import { type LibSQLDatabase } from "drizzle-orm/libsql";
import * as tenantSchema from "../schema/tenant/index.ts";
import { seedPermissions } from "./permissions.ts";
import { seedNotificationTypes } from "./seed-notification-types.ts";

type TenantDB = LibSQLDatabase<typeof tenantSchema>;

/**
 * Extensible seeder registry. Add new seeders here — they run in order.
 * Each seeder receives the tenant DB instance and must be idempotent.
 */
const seeders: Array<{ name: string; fn: (db: TenantDB) => Promise<void> }> = [
  { name: "permissions", fn: seedPermissions },
  { name: "notification-types", fn: seedNotificationTypes },
];

/**
 * Runs all registered seeders against the given tenant DB.
 * Used by bootstrap and future environment provisioning.
 */
export async function runSeeders(db: TenantDB): Promise<void> {
  for (const seeder of seeders) {
    console.log(`Running seeder: ${seeder.name}...`);
    await seeder.fn(db);
  }
  console.log("All seeders complete");
}

export { seedNotificationTypes, seedPermissions };
