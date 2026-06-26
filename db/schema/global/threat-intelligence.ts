/**
 * @file db/schema/global/threat-intelligence.ts
 * @description Threat Intelligence table schema for the global database
 */
import { boolean, cidr, createdAtTimestamp, dbTable, index, inet, integer, text, unique, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";

export const threatSources = dbTable("threat_sources", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull().unique(),
  description: text("description"),
  url: text("url"),
  isActive: boolean("is_active").default(true).notNull(),
  updateFrequency: integer("update_frequency_hours").default(24),
  totalEntries: integer("total_entries").default(0),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("threat_sources_name_idx").on(table.name),
  index("threat_sources_active_idx").on(table.isActive),
]);

export const threatIPs = dbTable("threat_ips", {
  id: text("id").primaryKey().notNull(),
  ipAddress: inet("ip_address").notNull(),
  sourceId: text("source_id").notNull().references(() => threatSources.id, {
    onDelete: "cascade",
  }),
  riskScore: integer("risk_score").default(50),
  category: text("category").default("malicious"),
  metadata: text("metadata", { mode: "json" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("threat_ips_ip_idx").on(table.ipAddress),
  index("threat_ips_source_idx").on(table.sourceId),
  index("threat_ips_active_idx").on(table.isActive),
  index("threat_ips_category_idx").on(table.category),
  index("threat_ips_risk_score_idx").on(table.riskScore),
  index("threat_ips_ip_active_idx").on(table.ipAddress, table.isActive),
  // Cursor-pagination index for bloom-filter load: WHERE is_active=? AND id > ?
  // ORDER BY id. Without (is_active, id) SQLite picks the low-selectivity
  // is_active index and builds a TEMP B-TREE to sort by id on EVERY batch,
  // making the ~310-batch startup load O(n) per batch (~32s). This composite
  // lets each batch range-scan in PK order (~0.45s total).
  index("threat_ips_active_id_idx").on(table.isActive, table.id),
  unique("threat_ips_unique_ip_source").on(table.ipAddress, table.sourceId),
]);

export const threatCIDRs = dbTable("threat_cidrs", {
  id: text("id").primaryKey().notNull(),
  cidrBlock: cidr("cidr_block").notNull(),
  sourceId: text("source_id").notNull().references(() => threatSources.id, {
    onDelete: "cascade",
  }),
  riskScore: integer("risk_score").default(50),
  category: text("category").default("malicious"),
  metadata: text("metadata", { mode: "json" }),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("threat_cidrs_cidr_idx").on(table.cidrBlock),
  index("threat_cidrs_source_idx").on(table.sourceId),
  index("threat_cidrs_active_idx").on(table.isActive),
  index("threat_cidrs_category_idx").on(table.category),
  index("threat_cidrs_cidr_active_idx").on(table.cidrBlock, table.isActive),
  // Cursor-pagination index for bloom-filter load (mirrors threat_ips). See
  // the threat_ips_active_id_idx note above for the temp-b-tree problem this
  // avoids on the WHERE is_active=? AND id > ? ORDER BY id batch query.
  index("threat_cidrs_active_id_idx").on(table.isActive, table.id),
  unique("threat_cidrs_unique_cidr_source").on(table.cidrBlock, table.sourceId),
]);

export const whitelistedIPs = dbTable("whitelisted_ips", {
  id: text("id").primaryKey().notNull(),
  ipAddress: inet("ip_address").notNull(),
  reason: text("reason"),
  addedBy: text("added_by"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: text("metadata", { mode: "json" }),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("whitelisted_ips_ip_idx").on(table.ipAddress),
  index("whitelisted_ips_active_idx").on(table.isActive),
  index("whitelisted_ips_ip_active_idx").on(table.ipAddress, table.isActive),
  unique("whitelisted_ips_unique_active_ip").on(table.ipAddress, table.isActive),
]);

export const whitelistedCIDRs = dbTable("whitelisted_cidrs", {
  id: text("id").primaryKey().notNull(),
  cidrBlock: cidr("cidr_block").notNull(),
  reason: text("reason"),
  addedBy: text("added_by"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: text("metadata", { mode: "json" }),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("whitelisted_cidrs_cidr_idx").on(table.cidrBlock),
  index("whitelisted_cidrs_active_idx").on(table.isActive),
  index("whitelisted_cidrs_cidr_active_idx").on(table.cidrBlock, table.isActive),
  unique("whitelisted_cidrs_unique_active_cidr").on(table.cidrBlock, table.isActive),
]);

export const threatUpdateLog = dbTable("threat_update_log", {
  id: text("id").primaryKey().notNull(),
  sourceId: text("source_id").references(() => threatSources.id, {
    onDelete: "cascade",
  }),
  updateType: text("update_type").notNull(),
  status: text("status").notNull().default("pending"),
  entriesAdded: integer("entries_added").default(0),
  entriesUpdated: integer("entries_updated").default(0),
  entriesRemoved: integer("entries_removed").default(0),
  errorMessage: text("error_message"),
  duration: integer("duration_ms"),
  metadata: text("metadata", { mode: "json" }),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("threat_update_log_source_idx").on(table.sourceId),
  index("threat_update_log_status_idx").on(table.status),
  index("threat_update_log_type_idx").on(table.updateType),
]);

export const threatSourcesRelations = relations(threatSources, ({ many }) => ({
  threatIPs: many(threatIPs),
  threatCIDRs: many(threatCIDRs),
  updateLogs: many(threatUpdateLog),
}));

export const threatIPsRelations = relations(threatIPs, ({ one }) => ({
  source: one(threatSources, {
    fields: [threatIPs.sourceId],
    references: [threatSources.id],
  }),
}));

export const threatCIDRsRelations = relations(threatCIDRs, ({ one }) => ({
  source: one(threatSources, {
    fields: [threatCIDRs.sourceId],
    references: [threatSources.id],
  }),
}));

export const threatUpdateLogRelations = relations(threatUpdateLog, ({ one }) => ({
  source: one(threatSources, {
    fields: [threatUpdateLog.sourceId],
    references: [threatSources.id],
  }),
}));
