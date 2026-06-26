/**
 * @file services/user/password.service.ts
 * @description Password service (user)
 */
import { eq } from "@deps";
import { AuthPasswordService } from "@services/auth/password-auth.service.ts";
import { SecureReauthTokenService } from "@services/auth/passkey-reauth-token.service.ts";
import { UserMasterKeySetupService } from "@services/auth/user-master-key-setup.service.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

export class UserPasswordService {
  private masterKeySetupService = new UserMasterKeySetupService();

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

  async setPasswordWithReauthToken(params: {
    userId: string;
    reauthToken: string;
    newPassword: string;
    sessionId: string;
    ipAddress: string;
  }): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserPasswordService.setPasswordWithReauthToken",
      {
        service: "UserPasswordService",
        method: "setPasswordWithReauthToken",
        section: loggerAppSections.AUTH,
        details: { userId: params.userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const { globalDb } = await this.getContext(params.userId);

        const newPasswordHash = await AuthPasswordService.generatePassword(
          params.newPassword,
        );

        const masterKey = await SecureReauthTokenService.consumeToken({
          token: params.reauthToken,
          userId: params.userId,
          sessionId: params.sessionId,
          purpose: "password_set",
          ipAddress: params.ipAddress,
        });

        try {
          await globalDb
            .update(globalTables.users)
            .set({
              password: newPasswordHash,
              updatedAt: Math.floor(Date.now() / 1000),
            })
            .where(eq(globalTables.users.id, params.userId));

          await AuthPasswordService.storePasswordHistory(
            params.userId,
            newPasswordHash,
          );

          await this.masterKeySetupService.addPasswordEncryption(
            params.userId,
            params.newPassword,
            masterKey,
          );

          useLogger(LoggerLevels.info, {
            message: "Password set via passkey reauth",
            messageKey: "user.password.set_with_passkey",
            section: loggerAppSections.AUTH,
            details: { userId: params.userId },
          });
        } finally {
          masterKey.fill(0);
        }
      },
    );
  }

  /**
   * Changes password for an authenticated user
   */
  async changePassword(params: {
    userId: string;
    currentPassword: string;
    newPassword: string;
    accessToken: string;
    refreshToken: string;
  }): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "UserPasswordService.changePassword",
      {
        service: "UserPasswordService",
        method: "changePassword",
        section: loggerAppSections.AUTH,
        details: { userId: params.userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = params.userId;

        const { globalDb, tenantDb } = await this.getContext(params.userId);
        const [userData] = await globalDb.select({
          password: globalTables.users.password,
        })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, params.userId))
          .limit(1);

        if (!userData?.password) {
          throwHttpError("AUTH.PASSWORD_NOT_SET");
        }

        const [currentPasswordValidation, newPasswordHash, newPasswordDerivedKey] = await Promise.all([
          AuthPasswordService.validatePassword(
            userData.password,
            params.currentPassword,
            params.userId,
          ),
          AuthPasswordService.generatePassword(params.newPassword),
          EncryptionSystemUserService.generatePasswordDerivedKey(
            params.newPassword,
            params.userId,
          ),
        ]);

        if (!currentPasswordValidation.valid) {
          span.attributes["current_password_invalid"] = true;
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        const [encryptionData] = await tenantDb.select({
          encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
        })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, params.userId))
          .limit(1);

        const hasEnhancedEncryption = !!encryptionData?.encryptedMasterKeyByPassword;
        span.attributes["has_enhanced_encryption"] = hasEnhancedEncryption;

        const [isPasswordInHistory, masterKey] = await Promise.all([
          AuthPasswordService.checkPasswordHistory(
            params.newPassword,
            params.userId,
            5,
          ),
          hasEnhancedEncryption
            ? this.masterKeySetupService.getExistingMasterKeyWithPassword(
              params.userId,
              params.currentPassword,
            )
            : Promise.resolve(null),
        ]);

        if (isPasswordInHistory) {
          span.attributes["password_in_history"] = true;
          throwHttpError("AUTH.PASSWORD_PREVIOUSLY_USED");
        }

        const newPasswordDerivedKeyBase64 = TextTransformations.fromBufferToBase64(newPasswordDerivedKey);

        try {
          let newEncryptedMasterKey: Uint8Array | undefined;
          if (hasEnhancedEncryption) {
            if (!masterKey) {
              throwHttpError("ENCRYPTION.DECRYPTION_FAILED");
            }

            const { useSymmetricEncrypt } = await import("@services/encryption/encryption.helper.ts");
            newEncryptedMasterKey = await useSymmetricEncrypt({
              key: newPasswordDerivedKey,
              data: masterKey,
            });
          }

          const now = Math.floor(Date.now() / 1000);

          if (hasEnhancedEncryption) {
            await tenantDb.transaction(async (tx) => {
              await tx
                .update(tenantTables.userEncryption)
                .set({
                  encryptedMasterKeyByPassword: newEncryptedMasterKey!,
                  updatedAt: now,
                })
                .where(eq(tenantTables.userEncryption.userId, params.userId));

              await globalDb
                .update(globalTables.users)
                .set({ password: newPasswordHash, updatedAt: now })
                .where(eq(globalTables.users.id, params.userId));
            });
          } else {
            await globalDb
              .update(globalTables.users)
              .set({ password: newPasswordHash, updatedAt: now })
              .where(eq(globalTables.users.id, params.userId));
          }

          await Promise.all([
            AuthPasswordService.storePasswordHistory(
              params.userId,
              newPasswordHash,
            ),
            EncryptionSystemUserService.storePasswordDerivedKeyInCache(
              params.accessToken,
              JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
              newPasswordDerivedKeyBase64,
            ),
            EncryptionSystemUserService.storePasswordDerivedKeyWithRefreshToken(
              params.refreshToken,
              JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
              newPasswordDerivedKeyBase64,
            ),
          ]);

          span.attributes["master_key_re_encrypted"] = hasEnhancedEncryption;
          span.attributes["session_cache_updated"] = true;
        } finally {
          if (masterKey) {
            masterKey.fill(0);
          }
        }
      },
    );
  }
}
