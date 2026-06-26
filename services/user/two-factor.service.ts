/**
 * @file services/user/two-factor.service.ts
 * @description Two Factor service (user)
 */
import { and, eq, nodeRandomBytes as randomBytes } from "@deps";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "../../db/db.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { AuthTOTPGenerationService } from "../auth/mfa-totp.service.ts";
import { envConfig } from "@config/env.ts";
import { AuthPasswordService } from "../auth/password-auth.service.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@services/logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";

/**
 * User-focused two-factor authentication management service
 * Handles user-level operations for managing 2FA devices and settings
 */
export class UserTwoFactorService {
  private async getContext(userId: string) {
    const globalDb = getGlobalDB();
    const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);

    if (!userRow) {
      throwHttpError("USER.NOT_FOUND");
    }

    const tenantDb = await getTenantDB(userRow.environmentId);
    return { environmentId: userRow.environmentId, tenantDb, globalDb };
  }

  /**
   * Creates a new 2FA secret for a user
   */
  async createTwoFactorSecret(
    userId: string,
    name: string,
    isPrimary: boolean = false,
    password?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    secretId: string;
    encryptedSecret: Uint8Array;
    uri: string;
    backupCodes?: string[];
  }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.createTwoFactorSecret",
      {
        service: "TwoFactorService",
        method: "createTwoFactorSecret",
        section: loggerAppSections.AUTH,
        details: { userId, name },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["secret_name"] = name;
        span.attributes["is_primary"] = isPrimary;

        const { tenantDb, globalDb } = await this.getContext(userId);
        const secretId = generateIdRandom();
        const currentTimestamp = Math.floor(Date.now() / 1000);

        // Generate the secret
        const secret = randomBytes(20);
        const encryptedSecret = await AuthTOTPGenerationService.encryptSecret(secret);

        let backupCodes: string[] | undefined;

        // Step 1: If setting as primary, clear other primaries first
        if (isPrimary) {
          await tenantDb.update(tenantTables.userTwoFactorSecrets)
            .set({ isPrimary: false, updatedAt: currentTimestamp })
            .where(eq(tenantTables.userTwoFactorSecrets.userId, userId));
        }

        // Step 2: Insert the new 2FA secret
        await tenantDb.insert(tenantTables.userTwoFactorSecrets).values({
          id: secretId,
          userId,
          name,
          encryptedSecret,
          isActive: true,
          isPrimary,
        });

        // Step 3: Check if this is the first active secret
        const existingSecrets = await tenantDb.select()
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ));

        if (existingSecrets.length === 1) { // This is the first secret
          try {
            const result = await this.ensureBackupCodesExistAndNotExhausted(
              userId,
              password,
              ipAddress,
              userAgent,
            );
            backupCodes = result.backupCodes;
          } catch (backupCodeError) {
            // Rollback: delete the 2FA secret we just created
            await tenantDb.delete(tenantTables.userTwoFactorSecrets)
              .where(eq(tenantTables.userTwoFactorSecrets.id, secretId));

            // Re-throw the error
            throw backupCodeError;
          }
        }

        // Step 4: Mark user as 2FA enabled
        await globalDb.update(globalTables.users)
          .set({
            isTwoFactorEnabled: true,
            updatedAt: currentTimestamp,
          })
          .where(eq(globalTables.users.id, userId));

        // Generate URI for QR code
        const uri = this.generateTOTPKeyURI(
          `${envConfig.public.appName}`,
          `${name}`,
          secret,
        );

        return {
          secretId,
          encryptedSecret,
          uri,
          backupCodes,
        };
      },
    );
  }

  /**
   * Gets all 2FA secrets for a user
   */
  async getUserTwoFactorSecrets(userId: string) {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.getUserTwoFactorSecrets",
      {
        service: "TwoFactorService",
        method: "getUserTwoFactorSecrets",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const { tenantDb } = await this.getContext(userId);
        return await tenantDb.select({
          id: tenantTables.userTwoFactorSecrets.id,
          name: tenantTables.userTwoFactorSecrets.name,
          isActive: tenantTables.userTwoFactorSecrets.isActive,
          isPrimary: tenantTables.userTwoFactorSecrets.isPrimary,
          lastUsedAt: tenantTables.userTwoFactorSecrets.lastUsedAt,
          createdAt: tenantTables.userTwoFactorSecrets.createdAt,
        })
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ))
          .orderBy(tenantTables.userTwoFactorSecrets.isPrimary, tenantTables.userTwoFactorSecrets.createdAt);
      },
    );
  }

  /**
   * Removes a 2FA secret with security verification
   * Requires password validation and a 2FA code from the device being removed
   */
  async removeTwoFactorSecret(
    userId: string,
    secretId: string,
    password: string,
    twoFactorCode: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{ success: boolean; wasLastDevice: boolean }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.removeTwoFactorSecret",
      {
        service: "TwoFactorService",
        method: "removeTwoFactorSecret",
        section: loggerAppSections.AUTH,
        details: { userId, secretId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["secret_id"] = secretId;

        const { tenantDb, globalDb } = await this.getContext(userId);

        // First, verify the secret exists and belongs to the user
        const secretToDelete = await tenantDb.select({
          id: tenantTables.userTwoFactorSecrets.id,
          name: tenantTables.userTwoFactorSecrets.name,
        })
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.id, secretId),
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ))
          .limit(1);

        if (secretToDelete.length === 0) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Validate password
        const [userPassword] = await globalDb.select({
          passwordHash: globalTables.users.password,
        }).from(globalTables.users)
          .where(eq(globalTables.users.id, userId)).limit(1);

        if (!userPassword?.passwordHash) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const { valid } = await AuthPasswordService.validatePassword(
          userPassword.passwordHash,
          password,
          userId,
          ipAddress,
          userAgent,
        );

        if (!valid) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Validate 2FA code against the secret being deleted
        const { AuthTOTPValidationService } = await import("../auth/mfa-totp.service.ts");
        const validation = await AuthTOTPValidationService.validateTwoFactorCode(
          userId,
          twoFactorCode,
          secretId,
        );

        if (!validation.isValid) {
          throwHttpError("AUTH.INVALID_2FA_CODE");
        }

        // All validations passed, proceed with deletion
        const result = await tenantDb.update(tenantTables.userTwoFactorSecrets)
          .set({
            isActive: false,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.id, secretId),
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
          ))
          .returning({ id: tenantTables.userTwoFactorSecrets.id });

        // Check if user has any remaining active 2FA secrets
        const remainingSecrets = await tenantDb.select()
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ));

        const wasLastDevice = remainingSecrets.length === 0;

        // If no remaining secrets, disable 2FA for user and deactivate backup codes
        if (wasLastDevice) {
          await globalDb.update(globalTables.users)
            .set({
              isTwoFactorEnabled: false,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(globalTables.users.id, userId));

          await tenantDb.update(tenantTables.userBackupCodes)
            .set({ isActive: false, updatedAt: Math.floor(Date.now() / 1000) })
            .where(eq(tenantTables.userBackupCodes.userId, userId));
        }

        return { success: result.length > 0, wasLastDevice };
      },
    );
  }

  /**
   * Ensures backup codes exist for a user, creates them if they don't
   */
  async ensureBackupCodesExistAndNotExhausted(
    userId: string,
    password?: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    backupCodes: string[];
  }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.ensureBackupCodesExistAndNotExhausted",
      {
        service: "TwoFactorService",
        method: "ensureBackupCodesExistAndNotExhausted",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        if (!password) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const { tenantDb, globalDb } = await this.getContext(userId);

        // Check if user already has active backup codes
        const existingBackupCodes = await tenantDb.select()
          .from(tenantTables.userBackupCodes)
          .where(and(
            eq(tenantTables.userBackupCodes.userId, userId),
            eq(tenantTables.userBackupCodes.isActive, true),
          ))
          .limit(1);

        if (
          existingBackupCodes.length > 0 &&
          existingBackupCodes[0]!.backupCodes !== null
        ) {
          return {
            backupCodes: [],
          };
        }

        // No more backup codes exist, we should generate new ones along with revalidating user password
        const [userPassword] = await globalDb.select({
          passwordHash: globalTables.users.password,
        }).from(globalTables.users)
          .where(eq(globalTables.users.id, userId)).limit(1);

        if (!userPassword?.passwordHash) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const { valid } = await AuthPasswordService.validatePassword(
          userPassword.passwordHash,
          password,
          userId,
          ipAddress,
          userAgent,
        );
        if (!valid) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        return await this.createBackupCodesForUser(userId);
      },
    );
  }

  private async createBackupCodesForUser(userId: string): Promise<{
    backupCodes: string[];
  }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.createBackupCodesForUser",
      {
        service: "TwoFactorService",
        method: "createBackupCodesForUser",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const { tenantDb } = await this.getContext(userId);
        const currentTimestamp = Math.floor(Date.now() / 1000);

        const { backupCodes, serializedHashedBackupCodes } = await AuthTOTPGenerationService.generateTOTPBackupCodes();

        const encryptedCodes = await serializedHashedBackupCodes;

        // Check if a backup codes record already exists for this user
        const existingRecord = await tenantDb.select({ userId: tenantTables.userBackupCodes.userId })
          .from(tenantTables.userBackupCodes)
          .where(eq(tenantTables.userBackupCodes.userId, userId))
          .limit(1);

        if (existingRecord.length > 0) {
          await tenantDb.update(tenantTables.userBackupCodes)
            .set({
              backupCodes: encryptedCodes,
              isActive: true,
              updatedAt: currentTimestamp,
            })
            .where(eq(tenantTables.userBackupCodes.userId, userId));
        } else {
          await tenantDb.insert(tenantTables.userBackupCodes).values({
            userId,
            backupCodes: encryptedCodes,
            isActive: true,
          });
        }

        return { backupCodes };
      },
    );
  }

  /**
   * Regenerates backup codes with security verification
   * Requires password validation and a current backup code (which will be consumed)
   */
  async regenerateBackupCodes(
    userId: string,
    password: string,
    backupCode: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    backupCodes: string[];
  }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.regenerateBackupCodes",
      {
        service: "TwoFactorService",
        method: "regenerateBackupCodes",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const { globalDb } = await this.getContext(userId);

        // Validate password first
        const [userPassword] = await globalDb.select({
          passwordHash: globalTables.users.password,
        }).from(globalTables.users)
          .where(eq(globalTables.users.id, userId)).limit(1);

        if (!userPassword?.passwordHash) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const { valid } = await AuthPasswordService.validatePassword(
          userPassword.passwordHash,
          password,
          userId,
          ipAddress,
          userAgent,
        );

        if (!valid) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Validate and consume the backup code
        const { AuthTOTPValidationService } = await import("../auth/mfa-totp.service.ts");
        const validation = await AuthTOTPValidationService.validateBackupCode(
          userId,
          backupCode,
        );

        if (!validation.isValid) {
          throwHttpError("AUTH.TWO_FACTOR_INVALID");
        }

        return await this.createBackupCodesForUser(userId);
      },
    );
  }

  /**
   * Reveals an existing 2FA secret with security verification
   * Requires password validation
   */
  async revealTwoFactorSecret(
    userId: string,
    secretId: string,
    password: string,
    ipAddress?: string,
    userAgent?: string,
  ): Promise<{
    secretId: string;
    name: string;
    uri: string;
    secret: string;
  }> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.revealTwoFactorSecret",
      {
        service: "TwoFactorService",
        method: "revealTwoFactorSecret",
        section: loggerAppSections.AUTH,
        details: { userId, secretId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["secret_id"] = secretId;

        const { tenantDb, globalDb } = await this.getContext(userId);

        // First, verify the secret exists and belongs to the user
        const secretRecord = await tenantDb.select({
          id: tenantTables.userTwoFactorSecrets.id,
          name: tenantTables.userTwoFactorSecrets.name,
          encryptedSecret: tenantTables.userTwoFactorSecrets.encryptedSecret,
          isActive: tenantTables.userTwoFactorSecrets.isActive,
        })
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.id, secretId),
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ))
          .limit(1);

        if (secretRecord.length === 0) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Validate password
        const [userPassword] = await globalDb.select({
          passwordHash: globalTables.users.password,
        }).from(globalTables.users)
          .where(eq(globalTables.users.id, userId)).limit(1);

        if (!userPassword?.passwordHash) {
          throwHttpError("COMMON.INVALID_INPUT");
        }

        const { valid } = await AuthPasswordService.validatePassword(
          userPassword.passwordHash,
          password,
          userId,
          ipAddress,
          userAgent,
        );

        if (!valid) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Decrypt the secret
        const decryptedSecret = await AuthTOTPGenerationService.decryptSecret(
          secretRecord[0]!.encryptedSecret as Uint8Array,
        );

        // Generate URI for QR code
        const uri = this.generateTOTPKeyURI(
          `${envConfig.public.appName}`,
          `${secretRecord[0]!.name}`,
          decryptedSecret,
        );

        // Encode secret as Base32 for manual entry
        const secretBase32 = encodeBase32NoPadding(decryptedSecret);

        return {
          secretId: secretRecord[0]!.id,
          name: secretRecord[0]!.name,
          uri,
          secret: secretBase32,
        };
      },
    );
  }

  /**
   * Gets the count of active 2FA devices for a user
   */
  async getActiveTwoFactorCount(userId: string): Promise<number> {
    return await tracedWithServiceErrorHandling(
      "TwoFactorService.getActiveTwoFactorCount",
      {
        service: "TwoFactorService",
        method: "getActiveTwoFactorCount",
        section: loggerAppSections.AUTH,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;

        const { tenantDb } = await this.getContext(userId);
        const secrets = await tenantDb.select({ id: tenantTables.userTwoFactorSecrets.id })
          .from(tenantTables.userTwoFactorSecrets)
          .where(and(
            eq(tenantTables.userTwoFactorSecrets.userId, userId),
            eq(tenantTables.userTwoFactorSecrets.isActive, true),
          ));

        return secrets.length;
      },
    );
  }

  /**
   * Checks if a user has 2FA enabled and active devices
   */
  async isTwoFactorActive(userId: string): Promise<boolean> {
    const count = await this.getActiveTwoFactorCount(userId);
    return count > 0;
  }

  generateTOTPKeyURI(
    issuer: string,
    accountName: string,
    key: Uint8Array,
  ): string {
    const encodedIssuer = encodeURIComponent(issuer);
    const encodedAccountName = encodeURIComponent(accountName);
    const base = `otpauth://totp/${encodedIssuer}:${encodedAccountName}`;
    const params = new URLSearchParams();
    params.set("issuer", issuer);
    params.set("algorithm", "SHA1");
    params.set("secret", encodeBase32NoPadding(key));
    params.set("period", "30");
    params.set("digits", "6");
    return base + "?" + params.toString();
  }
}

function encodeBase32NoPadding(data: Uint8Array): string {
  if (!data || data.length === 0) return "";
  let bits = 0;
  let value = 0;
  let output = "";

  for (let i = 0; i < data.length; i++) {
    value = (value << 8) | data[i]!;
    bits += 8;

    while (bits >= 5) {
      output += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".charAt(
        (value >>> (bits - 5)) & 31,
      );
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".charAt((value << (5 - bits)) & 31);
  }

  return output;
}
