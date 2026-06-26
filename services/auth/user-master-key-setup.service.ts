/**
 * @file services/auth/user-master-key-setup.service.ts
 * @description Centralized service for proactive user master key generation and encryption.
 * Called by auth flows at first auth method setup (password or passkey).
 */

import { eq, randomBytes } from "@deps";
import { EncryptionSystemUserService, PerCredentialPRFService } from "@services/encryption/index.ts";
import { useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

/**
 * UserMasterKeySetupService
 * ------------------------------------------------
 * Centralized service for proactive master key generation and encryption.
 * Ensures master key exists from the first auth method setup.
 */
export class UserMasterKeySetupService {
  /**
   * Generates a new 32-byte random master key
   */
  private generateMasterKey(): Uint8Array {
    const key = randomBytes(32);
    if (key.every((byte) => byte === 0)) {
      return this.generateMasterKey();
    }
    return key;
  }

  /**
   * Checks if user already has a master key (any encryption method)
   */
  async hasMasterKey(userId: string, environmentId?: string): Promise<boolean> {
    return await traced("UserMasterKeySetupService.hasMasterKey", "service", async (span) => {
      span.attributes["user_id"] = userId;
      try {
        let envId = environmentId;
        if (!envId) {
          const globalDb = getGlobalDB();
          const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
            .from(globalTables.users)
            .where(eq(globalTables.users.id, userId))
            .limit(1);

          if (!userRow) return false;
          envId = userRow.environmentId;
        }

        const tenantDb = await getTenantDB(envId);
        const [row] = await tenantDb.select({
          encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
        })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        const hasKey = !!(row?.encryptedMasterKeyByPassword);
        span.attributes["has_key"] = hasKey;
        return hasKey;
      } catch (_error) {
        return false;
      }
    });
  }

  /**
   * Gets existing master key using password-derived key
   * Returns null if no master key exists
   */
  async getExistingMasterKeyWithPassword(
    userId: string,
    password: string,
  ): Promise<Uint8Array | null> {
    return await traced("UserMasterKeySetupService.getExistingMasterKeyWithPassword", "service", async (span) => {
      span.attributes["user_id"] = userId;
      try {
        const passwordDerivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(
          password,
          userId,
        );
        return await EncryptionSystemUserService.getUserMasterKeyFromStorageWithPRF(
          userId,
          passwordDerivedKey,
        );
      } catch (_error) {
        span.attributes["not_found"] = true;
        return null;
      }
    });
  }

  /**
   * Setup master key for password registration.
   * If master key exists, adds password encryption.
   * If not, generates new master key and encrypts with password and stores it.
   */
  /**
   * Ensures a master key exists for the user, setting it up if missing.
   * Safe to call on login: only creates the master key if not already present.
   * @param userId - The user ID
   * @param password - The user's plaintext password
   */
  async ensureMasterKeyForPassword(
    userId: string,
    password: string,
    environmentId?: string,
  ): Promise<void> {
    const alreadyHasKey = await this.hasMasterKey(userId, environmentId);
    if (alreadyHasKey) return;
    await this.setupForPasswordRegistration(userId, password, environmentId);
  }

  async setupForPasswordRegistration(
    userId: string,
    password: string,
    environmentId?: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserMasterKeySetupService.setupForPasswordRegistration",
      {
        service: "UserMasterKeySetupService",
        method: "setupForPasswordRegistration",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        // Derive password key (also ensures the userEncryption salt row exists)
        const passwordDerivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(
          password,
          userId,
          environmentId,
        );

        // Generate new master key
        const masterKey = this.generateMasterKey();

        try {
          // Encrypt master key with password-derived key
          const encryptedMasterKey = await useSymmetricEncrypt({
            key: passwordDerivedKey,
            data: masterKey,
          });

          // Persist to tenantTables.userEncryption
          let envId = environmentId;
          if (!envId) {
            const globalDb = getGlobalDB();
            const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
              .from(globalTables.users)
              .where(eq(globalTables.users.id, userId))
              .limit(1);

            if (!userRow) {
              throw new Error("User not found when storing master key");
            }
            envId = userRow.environmentId;
          }

          const tenantDb = await getTenantDB(envId);

          // Upsert: update if row exists (salt row may have been created by generatePasswordDerivedKey), else insert
          const existing = await tenantDb.select({ userId: tenantTables.userEncryption.userId })
            .from(tenantTables.userEncryption)
            .where(eq(tenantTables.userEncryption.userId, userId))
            .limit(1);

          if (existing.length > 0) {
            await tenantDb.update(tenantTables.userEncryption)
              .set({
                encryptedMasterKeyByPassword: encryptedMasterKey,
                updatedAt: Math.floor(Date.now() / 1000),
              })
              .where(eq(tenantTables.userEncryption.userId, userId));
          } else {
            await tenantDb.insert(tenantTables.userEncryption).values({
              userId,
              encryptedMasterKeyByPassword: encryptedMasterKey,
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
            });
          }

          span.attributes["success"] = true;
          useLogger(LoggerLevels.info, {
            message: "Master key generated and stored for password registration",
            messageKey: "master_key.password_setup_complete",
            section: loggerAppSections.USER_ENCRYPTED,
            details: { userId },
          });
        } finally {
          // Zero the master key from memory
          masterKey.fill(0);
        }
      },
    );
  }

  /**
   * Setup master key for passkey registration.
   * If master key exists, adds PRF encryption for the credential.
   * If not, generates new master key and encrypts with PRF.
   * KNOWN LIMITATION: master-key setup with tenant DB context not yet implemented.
   */
  async setupForPasskeyRegistration(
    userId: string,
    credentialId: string,
    prfOutput: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserMasterKeySetupService.setupForPasskeyRegistration",
      {
        service: "UserMasterKeySetupService",
        method: "setupForPasskeyRegistration",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";
        span.attributes["status"] = "NOT_IMPLEMENTED: tenant_db_context";

        // Check if user has any master key
        const hasKey = await this.hasMasterKey(userId);

        if (hasKey) {
          span.attributes["has_existing_key"] = true;
          useLogger(LoggerLevels.info, {
            message: "User has existing master key, use addPasskeyEncryption to add PRF encryption",
            messageKey: "master_key.use_add_passkey",
            section: loggerAppSections.USER_ENCRYPTED,
            details: { userId, credentialIdPrefix: credentialId.substring(0, 8) },
          });
          return;
        }

        // Generate new master key
        const masterKey = this.generateMasterKey();
        span.attributes["master_key_generated"] = true;

        // Setup PRF encryption for this credential
        await PerCredentialPRFService.setupPRFForCredential(
          credentialId,
          masterKey,
          prfOutput,
          userId,
        );

        // Zero the master key from memory after PRF setup
        masterKey.fill(0);

        span.attributes["success"] = true;
        useLogger(LoggerLevels.info, {
          message: "Master key generated and encrypted with PRF",
          messageKey: "master_key.prf_setup",
          section: loggerAppSections.USER_ENCRYPTED,
          details: { userId, credentialIdPrefix: credentialId.substring(0, 8) },
        });
      },
    );
  }

  /**
   * Add password encryption for existing master key.
   * Used when user adds password to a passkey-only account.
   */
  async addPasswordEncryption(
    userId: string,
    password: string,
    existingMasterKey: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserMasterKeySetupService.addPasswordEncryption",
      {
        service: "UserMasterKeySetupService",
        method: "addPasswordEncryption",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const passwordDerivedKey = await EncryptionSystemUserService.generatePasswordDerivedKey(
          password,
          userId,
        );

        const encryptedMasterKey = await useSymmetricEncrypt({
          key: passwordDerivedKey,
          data: existingMasterKey,
        });

        const globalDb = getGlobalDB();
        const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!userRow) {
          throw new Error("User not found when storing password encryption");
        }

        const tenantDb = await getTenantDB(userRow.environmentId);
        const now = Math.floor(Date.now() / 1000);

        const existing = await tenantDb.select({ userId: tenantTables.userEncryption.userId })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        if (existing.length > 0) {
          await tenantDb.update(tenantTables.userEncryption)
            .set({
              encryptedMasterKeyByPassword: encryptedMasterKey,
              updatedAt: now,
            })
            .where(eq(tenantTables.userEncryption.userId, userId));
        } else {
          await tenantDb.insert(tenantTables.userEncryption).values({
            userId,
            encryptedMasterKeyByPassword: encryptedMasterKey,
            createdAt: now,
            updatedAt: now,
          });
        }

        span.attributes["success"] = true;
        useLogger(LoggerLevels.info, {
          message: "Password encryption added to existing master key",
          messageKey: "master_key.password_added",
          section: loggerAppSections.USER_ENCRYPTED,
          details: { userId },
        });
      },
    );
  }

  /**
   * Add PRF encryption for existing master key.
   * Used when user adds a new passkey to an account with existing master key.
   * KNOWN LIMITATION: master-key setup with tenant DB context not yet implemented.
   */
  async addPasskeyEncryption(
    userId: string,
    credentialId: string,
    prfOutput: string,
    existingMasterKey: Uint8Array,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserMasterKeySetupService.addPasskeyEncryption",
      {
        service: "UserMasterKeySetupService",
        method: "addPasskeyEncryption",
        section: loggerAppSections.USER_ENCRYPTED,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["credential_id_prefix"] = credentialId.substring(0, 8) + "...";

        await PerCredentialPRFService.setupPRFForCredential(
          credentialId,
          existingMasterKey,
          prfOutput,
          userId,
        );

        span.attributes["success"] = true;
        useLogger(LoggerLevels.info, {
          message: "PRF encryption added to existing master key",
          messageKey: "master_key.prf_added",
          section: loggerAppSections.USER_ENCRYPTED,
          details: { userId, credentialIdPrefix: credentialId.substring(0, 8) },
        });
      },
    );
  }
}
