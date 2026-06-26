/**
 * @file db/entities.ts
 * @description Database entity/table reference helpers
 */
import { customType, integer, text } from "drizzle-orm/sqlite-core";

export { blob, index, integer, primaryKey, sqliteTable as dbTable, text, unique } from "drizzle-orm/sqlite-core";

export const boolean = (name: string) => integer(name, { mode: "boolean" });

export const blobType = (name: string) =>
  customType<{
    data: Uint8Array;
    driverData: Uint8Array;
  }>({
    dataType() {
      return "blob";
    },
    // deno-lint-ignore no-explicit-any
    fromDriver(value: any): Uint8Array {
      return value instanceof Uint8Array ? value : new Uint8Array(value);
    },
    toDriver(value: Uint8Array): Uint8Array {
      return value;
    },
  })(name);

// For SQLite, we use integer for everything that was bigint in PG
export const bigint = (name: string, config?: { mode: "number" | "bigint" }) =>
  // deno-lint-ignore no-explicit-any
  integer(name, config as any);

export const bytea = (name: string) => blobType(name);

export const jsonb = (name: string) => text(name, { mode: "json" });

export const varchar = (name: string, _config?: { length: number }) => text(name);

export const jsonStringArray = (name: string) => text(name, { mode: "json" }).$type<string[]>();

export const unixSecondsTimestamp = (columnName: string) =>
  integer(columnName).notNull().$defaultFn(
    () => Math.floor(Date.now() / 1000),
  );

export const createdAtTimestamp = () => unixSecondsTimestamp("created_at");
export const updatedAtTimestamp = () => unixSecondsTimestamp("updated_at").$onUpdate(() => Math.floor(Date.now() / 1000));

// SQLite doesn't have native inet/cidr, use text
export const inet = (name: string) => text(name);
export const cidr = (name: string) => text(name);
