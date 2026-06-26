/**
 * @file services/threat-intelligence/db-utils.ts
 * @description Db Utils service module (threat intelligence)
 */
/**
 * Database Utilities for Threat Intelligence
 *
 * Common database operations to reduce code duplication across services.
 * Uses generics for type safety while maintaining flexibility.
 */

import { AnySQLiteTable as AnyPgTable, count, eq, inArray, type InferInsertModel, type SQL, SQLiteColumn as PgColumn } from "@deps";
import { generateIdForStorage } from "@utils/database/id-generation/index.ts";
import { type GlobalDB, globalTables } from "@db/index.ts";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Result type for update operations
 */
export interface UpdateStats {
  added: number;
  updated: number;
  removed: number;
}

/**
 * Transaction type from Drizzle
 */
export type DrizzleTransaction = Parameters<Parameters<GlobalDB["transaction"]>[0]>[0];

// Infer types from schema
type ThreatIP = typeof globalTables.threatIPs;
type ThreatCIDR = typeof globalTables.threatCIDRs;
type ThreatSource = typeof globalTables.threatSources;

// ============================================================================
// CHUNKED LOADING
// ============================================================================

/**
 * Load records in chunks to avoid memory issues
 * Used for processing large datasets without OOM errors
 */
export async function loadRecordsInChunks<T>(
  db: GlobalDB | DrizzleTransaction,
  table: AnyPgTable & { $inferSelect: T },
  conditions: SQL | undefined,
  processor: (chunk: T[]) => Promise<void> | void,
  chunkSize = 10000,
): Promise<void> {
  let offset = 0;
  // Cast needed because Drizzle's `.from()` conditional type cannot be resolved
  // for generic table parameters — the runtime behavior is correct.
  const pgTable = table as AnyPgTable;

  while (true) {
    const query = (db as GlobalDB)
      .select()
      .from(pgTable)
      .limit(chunkSize)
      .offset(offset);

    const chunk = conditions ? await query.where(conditions) : await query;

    if (chunk.length === 0) break;

    await processor(chunk as T[]);
    offset += chunkSize;
  }
}

// ============================================================================
// BATCH OPERATIONS
// ============================================================================

/**
 * Insert records in batches for better performance
 */
export async function batchInsert<TTable extends AnyPgTable>(
  db: GlobalDB | DrizzleTransaction,
  table: TTable,
  records: InferInsertModel<TTable>[],
  batchSize = 1000,
): Promise<void> {
  if (records.length === 0) return;

  const batches = chunkArray(records, batchSize);
  // Cast needed because Drizzle's `.insert().values()` conditional overload cannot
  // resolve for a generic `TTable` parameter — the runtime behavior is correct.
  // (Same constraint documented above for `loadRecordsInChunks`.)
  const insertTable = table as AnyPgTable;
  for (const batch of batches) {
    await db.insert(insertTable).values(batch as InferInsertModel<AnyPgTable>[]);
  }
}

/**
 * Update records in batches
 */
export async function batchUpdate<
  TTable extends AnyPgTable & { id: PgColumn },
>(
  db: GlobalDB | DrizzleTransaction,
  table: TTable,
  updates: Partial<InferInsertModel<TTable>> & { id: string }[],
  batchSize = 1000,
): Promise<void> {
  if (updates.length === 0) return;

  const batches = chunkArray(updates, batchSize);
  for (const batch of batches) {
    const ids = batch.map((u) => u.id);
    await db
      .update(table)
      .set(batch[0])
      .where(inArray(table.id, ids));
  }
}

/**
 * Chunk array into smaller arrays
 */
export function chunkArray<T>(array: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    chunks.push(array.slice(i, i + chunkSize));
  }
  return chunks;
}

// ============================================================================
// COUNT QUERIES
// ============================================================================

/**
 * Get count of active records
 */
export async function getActiveCount(
  db: GlobalDB | DrizzleTransaction,
  table: AnyPgTable & { isActive: PgColumn },
): Promise<number> {
  const result = await db
    .select({ count: count() })
    .from(table)
    .where(eq(table.isActive, true));

  return result[0]?.count || 0;
}

// ============================================================================
// THREAT DATA PROCESSING
// ============================================================================

/**
 * Process IP updates with chunked loading
 * Compares new IPs with existing records and adds/updates/deactivates accordingly
 */
export async function processIPUpdates(
  tx: DrizzleTransaction,
  table: ThreatIP,
  sourceId: string,
  newIPs: Set<string>,
  riskScore: number,
  category: string,
  chunkSize = 10000,
): Promise<UpdateStats> {
  let added = 0;
  let updated = 0;
  let removed = 0;
  const processedIPs = new Set<string>();

  // Process existing IPs in chunks
  let offset = 0;
  while (true) {
    const existingChunk = await tx
      .select({
        id: table.id,
        ipAddress: table.ipAddress,
        riskScore: table.riskScore,
        category: table.category,
        isActive: table.isActive,
      })
      .from(table)
      .where(eq(table.sourceId, sourceId))
      .limit(chunkSize)
      .offset(offset);

    if (existingChunk.length === 0) break;

    const ipIdsToReactivate: string[] = [];
    const ipIdsToDeactivate: string[] = [];

    for (const existing of existingChunk) {
      const ipAddress = existing.ipAddress;
      processedIPs.add(ipAddress);

      if (newIPs.has(ipAddress)) {
        // IP still exists in new data - check if needs update
        if (!existing.isActive || existing.riskScore !== riskScore || existing.category !== category) {
          ipIdsToReactivate.push(existing.id);
          updated++;
        }
      } else {
        // IP removed from new data - soft delete
        if (existing.isActive) {
          ipIdsToDeactivate.push(existing.id);
          removed++;
        }
      }
    }

    // Execute batch updates for this chunk
    if (ipIdsToReactivate.length > 0) {
      await tx
        .update(table)
        .set({ isActive: true, riskScore, category, updatedAt: Math.floor(Date.now() / 1000) })
        .where(inArray(table.id, ipIdsToReactivate));
    }

    if (ipIdsToDeactivate.length > 0) {
      await tx
        .update(table)
        .set({ isActive: false, updatedAt: Math.floor(Date.now() / 1000) })
        .where(inArray(table.id, ipIdsToDeactivate));
    }

    offset += chunkSize;
  }

  // Insert new IPs (ones not in processedIPs) using upsert
  // The unique constraint on (ipAddress, sourceId) enables atomic reactivation
  const ipsToAdd = Array.from(newIPs).filter((ip) => !processedIPs.has(ip));
  if (ipsToAdd.length > 0) {
    const ipRecords = ipsToAdd.map((ipAddr) => ({
      id: generateIdForStorage(),
      ipAddress: ipAddr,
      sourceId,
      riskScore,
      category,
      isActive: true,
      metadata: { importedAt: new Date().toISOString() },
    }));

    // Use upsert to handle reactivation of soft-deleted entries atomically
    const batches = chunkArray(ipRecords, 1000);
    for (const batch of batches) {
      await tx
        .insert(table)
        .values(batch)
        .onConflictDoUpdate({
          target: [table.ipAddress, table.sourceId],
          set: {
            isActive: true,
            riskScore,
            category,
            updatedAt: Math.floor(Date.now() / 1000),
          },
        });
    }
    added += ipsToAdd.length;
  }

  return { added, updated, removed };
}

/**
 * Process CIDR updates with chunked loading
 * Compares new CIDRs with existing records and adds/updates/deactivates accordingly
 */
export async function processCIDRUpdates(
  tx: DrizzleTransaction,
  table: ThreatCIDR,
  sourceId: string,
  newCIDRs: Set<string>,
  riskScore: number,
  category: string,
  chunkSize = 10000,
): Promise<UpdateStats> {
  let added = 0;
  let updated = 0;
  let removed = 0;
  const processedCIDRs = new Set<string>();

  // Process existing CIDRs in chunks
  let offset = 0;
  while (true) {
    const existingChunk = await tx
      .select({
        id: table.id,
        cidrBlock: table.cidrBlock,
        riskScore: table.riskScore,
        category: table.category,
        isActive: table.isActive,
      })
      .from(table)
      .where(eq(table.sourceId, sourceId))
      .limit(chunkSize)
      .offset(offset);

    if (existingChunk.length === 0) break;

    const cidrIdsToReactivate: string[] = [];
    const cidrIdsToDeactivate: string[] = [];

    for (const existing of existingChunk) {
      const cidrBlock = existing.cidrBlock;
      processedCIDRs.add(cidrBlock);

      if (newCIDRs.has(cidrBlock)) {
        // CIDR still exists in new data - check if needs update
        if (!existing.isActive || existing.riskScore !== riskScore || existing.category !== category) {
          cidrIdsToReactivate.push(existing.id);
          updated++;
        }
      } else {
        // CIDR removed from new data - soft delete
        if (existing.isActive) {
          cidrIdsToDeactivate.push(existing.id);
          removed++;
        }
      }
    }

    // Execute batch updates for this chunk
    if (cidrIdsToReactivate.length > 0) {
      await tx
        .update(table)
        .set({ isActive: true, riskScore, category, updatedAt: Math.floor(Date.now() / 1000) })
        .where(inArray(table.id, cidrIdsToReactivate));
    }

    if (cidrIdsToDeactivate.length > 0) {
      await tx
        .update(table)
        .set({ isActive: false, updatedAt: Math.floor(Date.now() / 1000) })
        .where(inArray(table.id, cidrIdsToDeactivate));
    }

    offset += chunkSize;
  }

  // Insert new CIDRs (ones not in processedCIDRs) using upsert
  // The unique constraint on (cidrBlock, sourceId) enables atomic reactivation
  const cidrsToAdd = Array.from(newCIDRs).filter((cidr) => !processedCIDRs.has(cidr));
  if (cidrsToAdd.length > 0) {
    const cidrRecords = cidrsToAdd.map((cidrBlock) => ({
      id: generateIdForStorage(),
      cidrBlock,
      sourceId,
      riskScore,
      category,
      isActive: true,
      metadata: { importedAt: new Date().toISOString() },
    }));

    // Use upsert to handle reactivation of soft-deleted entries atomically
    const batches = chunkArray(cidrRecords, 1000);
    for (const batch of batches) {
      await tx
        .insert(table)
        .values(batch)
        .onConflictDoUpdate({
          target: [table.cidrBlock, table.sourceId],
          set: {
            isActive: true,
            riskScore,
            category,
            updatedAt: Math.floor(Date.now() / 1000),
          },
        });
    }
    added += cidrsToAdd.length;
  }

  return { added, updated, removed };
}
