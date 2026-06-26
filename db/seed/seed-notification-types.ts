import { type LibSQLDatabase } from "drizzle-orm/libsql";
import * as tenantSchema from "../schema/tenant/index.ts";
import { NOTIFICATION_SCOPES, NOTIFICATION_TYPES } from "@config/notification-catalog.ts";

type TenantDB = LibSQLDatabase<typeof tenantSchema>;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

/**
 * Seeds notification types and environment notification defaults into a tenant DB.
 * Idempotent — uses onConflictDoNothing.
 */
export async function seedNotificationTypes(db: TenantDB): Promise<void> {
  const values = Object.values(NOTIFICATION_TYPES).map((type) => ({
    id: type.id,
    category: type.category,
    scope: type.scope,
    label: type.label,
    description: type.description ?? null,
    defaultEmail: type.defaults.email,
    defaultInApp: type.defaults.inApp,
    defaultPush: type.defaults.push,
    availableChannels: type.availableChannels.join(","),
    isActive: true,
  }));

  if (values.length === 0) return;

  await db
    .insert(tenantSchema.notificationTypes)
    .values(values)
    .onConflictDoNothing();

  // Seed environment notification defaults for admin-scoped types
  const adminDefaults = values
    .filter((type) => type.scope === NOTIFICATION_SCOPES.ADMIN)
    .map((type) => ({
      notificationTypeId: type.id,
      emailEnabled: type.defaultEmail,
      inAppEnabled: type.defaultInApp,
      pushEnabled: type.defaultPush,
      createdAt: nowSeconds(),
      updatedAt: nowSeconds(),
    }));

  if (adminDefaults.length > 0) {
    await db
      .insert(tenantSchema.environmentNotificationDefaults)
      .values(adminDefaults)
      .onConflictDoNothing();
  }

  console.log(`Seeded notification types (${values.length})`);
}
