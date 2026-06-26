/**
 * @file db/schema/tenant/iam.ts
 * @description Iam table schema for the tenant database
 */
import { blobType, boolean, createdAtTimestamp, dbTable, index, integer, text, updatedAtTimestamp } from "../../entities.ts";
import { relations } from "drizzle-orm";

export const userProfiles = dbTable("user_profiles", {
  userId: text("user_id").primaryKey().notNull(),
  username: text("username").notNull().default(""),
  email: text("email").notNull().default(""),
  firstName: text("first_name").notNull().default(""),
  lastName: text("last_name").notNull().default(""),
  isAdmin: boolean("is_admin").notNull().default(false),
  avatarColor: text("avatar_color").default("#000000"),
  themeColor: text("theme_color").notNull().default("Blue"),
  darkThemeColor: text("dark_theme_color").notNull().default("Blue"),
  fontSize: text("font_size").notNull().default("Normal"),
  isDarkMode: text("is_dark_mode").default("#22262c"),
  language: text("language").notNull().default("en"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const userTwoFactorSecrets = dbTable("user_two_factor_secrets", {
  id: text("id").primaryKey().notNull(),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  name: text("name").notNull(),
  encryptedSecret: blobType("encrypted_secret").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  isPrimary: boolean("is_primary").notNull().default(false),
  lastUsedAt: integer("last_used_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_user_two_factor_secrets_user_id").on(table.userId),
]);

export const userBackupCodes = dbTable("user_backup_codes", {
  userId: text("user_id").primaryKey().notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  backupCodes: blobType("backup_codes"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const apiKeys = dbTable("api_keys", {
  id: text("id").primaryKey().notNull(),
  name: text("name").notNull(),
  keyHash: text("key_hash").notNull().unique(),
  apiKeyDerivedKey: blobType("api_key_derived_key"),
  keyEndingIn: text("key_ending_in").notNull(),
  userId: text("user_id").notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  expiresAt: integer("expires_at"),
  ipRestrictions: text("ip_restrictions", { mode: "json" }),
  domainRestrictions: text("domain_restrictions", { mode: "json" }),
  isActive: boolean("is_active").notNull().default(true),
  lastUsedAt: integer("last_used_at"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
}, (table) => [
  index("idx_api_keys_user_id").on(table.userId),
  index("idx_api_keys_user_id_active").on(table.userId, table.isActive),
]);

// Enhanced encryption fields moved to a separate table for cleaner separation
export const userEncryption = dbTable("user_encryption", {
  userId: text("user_id").primaryKey().notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  isEnhancedEncryptionEnabled: boolean("is_enhanced_encryption_enabled").notNull().default(false),
  encryptedMasterKeyByPassword: blobType("encrypted_master_key_by_password"),
  encryptedMasterKeyByRecoveryPhrase: blobType("encrypted_master_key_by_recovery_phrase"),
  enhancedEncryptionSalt: text("enhanced_encryption_salt"),
  /** Master key version - incremented on each rotation */
  masterKeyVersion: integer("master_key_version").notNull().default(1),

  // Asymmetric encryption fields for secure key sharing
  publicKey: text("public_key"),
  encryptedPrivateKey: blobType("encrypted_private_key"),

  isRecoveryPhraseVerified: boolean("is_recovery_phrase_verified").notNull().default(false),
  recoveryPhraseVerifiedAt: integer("recovery_phrase_verified_at"),
  userEncryptedRecoveryPhraseVerificationData: blobType("user_encrypted_recovery_phrase_verification_data"),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

export const masterKeyRotationEscrow = dbTable("master_key_rotation_escrow", {
  userId: text("user_id").primaryKey().notNull().references(() => userProfiles.userId, { onDelete: "cascade" }),
  encryptedNewMasterKey: blobType("encrypted_new_master_key").notNull(),
  keyDerivationNonce: text("key_derivation_nonce").notNull(),
  pendingCredentialIds: text("pending_credential_ids", { mode: "json" }).notNull(),
  masterKeyVersion: integer("master_key_version").notNull(),
  expiresAt: integer("expires_at").notNull(),
  createdAt: createdAtTimestamp(),
  updatedAt: updatedAtTimestamp(),
});

// Relations
export const userProfilesRelations = relations(userProfiles, ({ many: _many }) => ({
  // Note: relations to global users cannot be enforced at DB level
}));

export const apiKeysRelations = relations(apiKeys, ({ many: _many }) => ({
  // ...
}));
