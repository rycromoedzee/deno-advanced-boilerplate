/**
 * @file db/schema/global/auth.ts
 * @description Auth table schema for the global database
 */
import { blobType, boolean, createdAtTimestamp, dbTable, index, integer, text, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";

export const environments = dbTable("environments", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  customSubdomain: text("custom_subdomain"),
  customDomain: text("custom_domain"),
  description: text("description"),
  status: text("status").notNull().default("active"),
  timezone: text("timezone").notNull().default("UTC"),
  defaultLanguage: text("default_language").notNull().default("en"),
  internalNotes: text("internal_notes"),
  featureDocuments: boolean("feature_documents").notNull().default(true),
  featureEncryption: boolean("feature_encryption").notNull().default(true),
  featurePublicSharing: boolean("feature_public_sharing").notNull().default(true),
  featureNotes: boolean("feature_notes").notNull().default(true),
  featureKnowledgeBase: boolean("feature_knowledge_base").notNull().default(true),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_environments_custom_domain").on(table.customDomain),
  index("idx_environments_custom_subdomain").on(table.customSubdomain),
]);

export const environmentQuotas = dbTable("environment_quotas", {
  id: text("id").primaryKey().notNull(),
  maxUsers: integer("max_users"),
  maxStorageKb: integer("max_storage_kb"),
  maxFileSizeKb: integer("max_file_size_kb"),
  currentStorageKb: integer("current_storage_kb").notNull().default(0),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const environmentSqliteRegistry = dbTable("environment_sqlite_registry", {
  id: text("id").primaryKey().notNull(), // same as environment ID
  dbUrlEncrypted: blobType("db_url_encrypted").notNull(),
  dbTokenEncrypted: blobType("db_token_encrypted"), // nullable for local databases without tokens
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const users = dbTable("users", {
  id: text("id").primaryKey().notNull(),
  email: text("email").unique().notNull(),
  password: text("password"),
  username: text("username").unique(),
  firstName: text("first_name").notNull(),
  lastName: text("last_name").notNull(),
  environmentId: text("environment_id").references(() => environments.id).notNull(),
  isBanned: boolean("is_banned").notNull().default(false),
  emailAllowed: boolean("email_allowed").notNull().default(true),
  isTwoFactorEnabled: boolean("is_two_factor_enabled").notNull().default(false),
  isActive: boolean("is_active").notNull(),
  isSuperAdmin: boolean("is_super_admin").notNull().default(false),
  lastLoginAt: integer("last_login_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_users_email").on(table.email),
  index("idx_users_environment_id").on(table.environmentId),
]);

export const userPasskeys = dbTable("user_passkeys", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  publicKey: text("public_key").notNull(),
  counter: integer("counter").notNull(),
  backedUp: boolean("backed_up").notNull(),
  transports: text("transports", { mode: "json" }).notNull(),
  displayName: text("display_name"),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("idx_user_passkeys_user_id").on(table.userId),
]);

export const passkeyPRFKeys = dbTable("passkey_prf_keys", {
  credentialId: text("credential_id").primaryKey()
    .references(() => userPasskeys.id, { onDelete: "cascade" }),
  encryptedMasterKey: blobType("encrypted_master_key").notNull(),
  prfSalt: text("prf_salt").notNull(),
  masterKeyVersion: integer("master_key_version").notNull().default(1),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const userPasswordHistory = dbTable("user_password_history", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAtTimestamp(),
}, (table) => [
  index("idx_user_password_history_user_id").on(table.userId),
]);

export const refreshTokens = dbTable("refresh_tokens", {
  tokenHash: text("token_hash").primaryKey().notNull(),
  sessionId: text("session_id").notNull(),
  userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  fingerprint: text("fingerprint").notNull(),
  ipAddress: text("ip_address").notNull(),
  maxAgeType: integer("max_age_type").notNull(),
  encryptedPasswordDerivedKey: text("encrypted_password_derived_key"),
  encryptedPRFDerivedKey: text("encrypted_prf_derived_key"),
  prfCredentialId: text("prf_credential_id"),
  expiresAt: integer("expires_at").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  index("idx_refresh_tokens_user_id").on(table.userId),
  index("idx_refresh_tokens_expires_at").on(table.expiresAt),
]);

// Relations
export const usersRelations = relations(users, ({ one, many }) => ({
  environment: one(environments, {
    fields: [users.environmentId],
    references: [environments.id],
  }),
  passkeys: many(userPasskeys),
  passwordHistory: many(userPasswordHistory),
}));

export const environmentsRelations = relations(environments, ({ many }) => ({
  users: many(users),
}));

export const userPasskeysRelations = relations(userPasskeys, ({ one }) => ({
  user: one(users, {
    fields: [userPasskeys.userId],
    references: [users.id],
  }),
  prfKey: one(passkeyPRFKeys, {
    fields: [userPasskeys.id],
    references: [passkeyPRFKeys.credentialId],
  }),
}));
