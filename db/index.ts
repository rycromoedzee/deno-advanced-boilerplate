/**
 * @file db/index.ts
 * @description Barrel exports for the database layer
 */
export {
  evictTenantDB,
  getDecryptedTenantCredentials,
  getGlobalDB,
  getTenantDB,
  globalTables,
  tables,
  tenantDbPath,
  tenantTables,
} from "./db.ts";
export type { GlobalDB, TenantDB } from "./db.ts";
export { requestContext } from "./context.ts";

// For backward compatibility during migration
export { getGlobalDB as getDB, getGlobalDB as getWorkerDB } from "./db.ts";

// Export JSON operations API
export { arrayContains, extractText, json, type JsonOperations, jsonPath, typedJson } from "./json-operations.ts";
