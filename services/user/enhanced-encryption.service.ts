/**
 * @file services/user/enhanced-encryption.service.ts
 * @description Enhanced Encryption service (user)
 */
import { and, eq, hexToBytes, inArray, randomBytes, sql } from "@deps";
import type { TenantDB } from "@db/db.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";

/**
 * The drizzle transaction object passed to a `TenantDB.transaction` callback.
 * Derived from the actual method signature so it tracks the tenant schema.
 */
type TenantTransaction =
  // [0] of transaction() is the callback; [0] of that callback is the tx
  Parameters<NonNullable<Parameters<TenantDB["transaction"]>[0]>>[0];

import {
  RecoveryPhraseCreateService,
  RecoveryPhraseValidateService,
  userRecoveryPhraseCreateHashFromPhrase,
} from "./recovery-phrase.service.ts";
import {
  DataAccessService,
  EncryptionSystemUserService,
  KeySharingService,
  PasskeyPRFService,
  PerCredentialPRFService,
  RotationEscrowService,
} from "../encryption/index.ts";
import { getUserAsymmetricKeysService } from "./singletons.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { DB_ENUM_ENCRYPTION_MODE } from "@db/enums/index.ts";
import { envConfig } from "@config/env.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

export class UserEnhancedEncryptionSettingsService {
  private recoveryPhraseCreateService = new RecoveryPhraseCreateService();
  private recoveryPhraseValidateService = new RecoveryPhraseValidateService();
  private keySharingService = new KeySharingService();
  private asymmetricKeysService = getUserAsymmetricKeysService();

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

  async hasEnhancedEncryptionEnabled(userId: string): Promise<boolean> {
    const { tenantDb } = await this.getContext(userId);
    const userData = await tenantDb.select({
      isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
    })
      .from(tenantTables.userEncryption)
      .where(eq(tenantTables.userEncryption.userId, userId))
      .limit(1);

    return userData.length > 0 ? (userData[0].isEnhancedEncryptionEnabled ?? false) : false;
  }

  async enableEnhancedEncryption(
    userId: string,
    password: string,
    providedRecoveryPhrase: string | null,
  ): Promise<{
    isEnhancedEncryptionEnabled: boolean;
    recoveryPhrase: string | null;
  }> {
    let recoveryPhrase: string | null = null;

    if (providedRecoveryPhrase) {
      const result = await this.recoveryPhraseValidateService
        .validatePhraseProvidedByUser(userId, providedRecoveryPhrase);
      if (!result) {
        throwHttpError("VALIDATION.INVALID_FORMAT");
      }
      recoveryPhrase = providedRecoveryPhrase;
    }

    try {
      const { tenantDb } = await this.getContext(userId);
      let userMasterKey: string = "";

      await this.cleanupInvalidSharedAccess(userId);

      await tenantDb.transaction(async (tx) => {
        if (!recoveryPhrase) {
          const result = await this.recoveryPhraseCreateService
            .hasRecoveryPhraseOrCreate(userId);
          if (result) {
            recoveryPhrase = result;
          } else {
            throwHttpError("VALIDATION.DUPLICATE_VALUE");
          }
        }

        const [userResult] = await tx
          .select({
            encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
          })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        if (!userResult?.encryptedMasterKeyByPassword) {
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        const passwordDerivedKey = await EncryptionSystemUserService
          .generatePasswordDerivedKey(password, userId);

        const decryptedMasterKey = await useSymmetricDecrypt({
          key: passwordDerivedKey,
          data: userResult.encryptedMasterKeyByPassword as Uint8Array,
        });
        userMasterKey = TextTransformations.fromBufferToBase64(decryptedMasterKey);

        const recoveryPhraseHash = userRecoveryPhraseCreateHashFromPhrase(recoveryPhrase);

        const encryptedMasterKeyWithRecoveryPhrase = await useSymmetricEncrypt({
          key: hexToBytes(recoveryPhraseHash),
          data: decryptedMasterKey,
        });

        await tx.update(tenantTables.userEncryption)
          .set({
            isEnhancedEncryptionEnabled: true,
            encryptedMasterKeyByRecoveryPhrase: encryptedMasterKeyWithRecoveryPhrase,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.userEncryption.userId, userId));

        await this.migrateDataKeysToUserControlled(userId, userMasterKey, tx as unknown as TenantDB);
      });

      return {
        isEnhancedEncryptionEnabled: true,
        recoveryPhrase: providedRecoveryPhrase ? null : recoveryPhrase,
      };
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async enableEnhancedEncryptionForPasskeyUser(
    userId: string,
    accessToken: string,
  ): Promise<{
    isEnhancedEncryptionEnabled: boolean;
    recoveryPhrase: string;
  }> {
    try {
      const { tenantDb } = await this.getContext(userId);
      const prfDerivedKeyBase64 = await PasskeyPRFService.fetchPRFDerivedKeyFromSession(accessToken);
      const credentialId = await PasskeyPRFService.fetchPRFCredentialIdFromSession(accessToken);

      if (!prfDerivedKeyBase64 || !credentialId) {
        throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
      }

      const prfDerivedKey = TextTransformations.base64ToBuffer(prfDerivedKeyBase64);
      const decryptedMasterKey = await PerCredentialPRFService.decryptWithDerivedKey(
        credentialId,
        prfDerivedKey,
        userId,
      );
      const userMasterKey = TextTransformations.fromBufferToBase64(decryptedMasterKey);

      await this.cleanupInvalidSharedAccess(userId);

      let recoveryPhrase: string | null = null;

      await tenantDb.transaction(async (tx) => {
        const result = await this.recoveryPhraseCreateService.hasRecoveryPhraseOrCreate(userId);
        if (!result) throwHttpError("VALIDATION.DUPLICATE_VALUE");
        recoveryPhrase = result;

        const recoveryPhraseHash = userRecoveryPhraseCreateHashFromPhrase(recoveryPhrase);
        const encryptedMasterKeyWithRecoveryPhrase = await useSymmetricEncrypt({
          key: hexToBytes(recoveryPhraseHash),
          data: decryptedMasterKey,
        });

        await tx.update(tenantTables.userEncryption)
          .set({
            isEnhancedEncryptionEnabled: true,
            encryptedMasterKeyByRecoveryPhrase: encryptedMasterKeyWithRecoveryPhrase,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.userEncryption.userId, userId));

        await this.migrateDataKeysToUserControlled(userId, userMasterKey, tx as unknown as TenantDB);
      });

      return {
        isEnhancedEncryptionEnabled: true,
        recoveryPhrase: recoveryPhrase!,
      };
    } catch (error) {
      if (error instanceof AppHttpException) throw error;
      throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
    }
  }

  async rotateMasterKey(
    userId: string,
    accessToken: string,
    recoveryPhrase: string,
    sessionKey?: string,
  ): Promise<{ success: boolean; pendingPasskeyRewraps: number }> {
    const { tenantDb, globalDb } = await this.getContext(userId);
    const oldMasterKey = await EncryptionSystemUserService.getUserMasterKeyForDataEncryptionWithPRF(
      userId,
      accessToken,
      undefined,
      undefined,
      sessionKey,
    );

    const newMasterKey = randomBytes(32);

    try {
      const passwordDerivedKey = await EncryptionSystemUserService.fetchPasswordDerivedKeyFromSession(
        accessToken,
        JWT_TOKEN_CONFIG.audiences.auth,
        JWT_TOKEN_TYPES.AUTH,
        sessionKey,
      );

      let prfCredentialId: string | undefined;
      if (!passwordDerivedKey) {
        prfCredentialId = (await PasskeyPRFService.fetchPRFCredentialIdFromSession(accessToken)) ?? undefined;
      }

      const { pendingCredentialIds } = await tenantDb.transaction(async (ttx) => {
        const [userEnc] = await ttx.select({ masterKeyVersion: tenantTables.userEncryption.masterKeyVersion })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        const expectedVersion = userEnc?.masterKeyVersion ?? 1;
        const newVersion = expectedVersion + 1;

        await this.reEncryptDataKeysWithNewMasterKey(userId, oldMasterKey, newMasterKey, ttx as unknown as TenantDB);

        const [userData] = await ttx.select({ encryptedPrivateKey: tenantTables.userEncryption.encryptedPrivateKey })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        if (userData?.encryptedPrivateKey) {
          const decryptedPrivateKey = await useSymmetricDecrypt({
            key: oldMasterKey,
            data: userData.encryptedPrivateKey as Uint8Array,
          });
          const reEncryptedPrivateKey = await useSymmetricEncrypt({
            key: newMasterKey,
            data: decryptedPrivateKey,
          });
          await ttx.update(tenantTables.userEncryption)
            .set({ encryptedPrivateKey: reEncryptedPrivateKey })
            .where(eq(tenantTables.userEncryption.userId, userId));
        }

        if (passwordDerivedKey) {
          const reEncryptedMasterKey = await useSymmetricEncrypt({
            key: TextTransformations.base64ToBuffer(passwordDerivedKey),
            data: newMasterKey,
          });
          await ttx.update(tenantTables.userEncryption)
            .set({ encryptedMasterKeyByPassword: reEncryptedMasterKey })
            .where(eq(tenantTables.userEncryption.userId, userId));
        }

        const recoveryPhraseHash = userRecoveryPhraseCreateHashFromPhrase(recoveryPhrase);
        const reEncryptedMasterKeyByRecovery = await useSymmetricEncrypt({
          key: hexToBytes(recoveryPhraseHash),
          data: newMasterKey,
        });
        await ttx.update(tenantTables.userEncryption)
          .set({
            encryptedMasterKeyByRecoveryPhrase: reEncryptedMasterKeyByRecovery,
            masterKeyVersion: newVersion,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.userEncryption.userId, userId));

        const stalePrfKeys = await globalDb.select({ credentialId: globalTables.passkeyPRFKeys.credentialId })
          .from(globalTables.passkeyPRFKeys)
          .innerJoin(globalTables.userPasskeys, eq(globalTables.userPasskeys.id, globalTables.passkeyPRFKeys.credentialId))
          .where(and(
            eq(globalTables.userPasskeys.userId, userId),
            sql`${globalTables.passkeyPRFKeys.masterKeyVersion} < ${newVersion}`,
          ));

        const pendingIds = stalePrfKeys.map((r) => r.credentialId).filter((id) => id !== prfCredentialId);

        if (pendingIds.length > 0) {
          await RotationEscrowService.createEscrow(userId, newMasterKey, pendingIds, newVersion, ttx);
        }

        return { pendingCredentialIds: pendingIds };
      });

      return { success: true, pendingPasskeyRewraps: pendingCredentialIds.length };
    } finally {
      oldMasterKey.fill(0);
      newMasterKey.fill(0);
    }
  }

  private async cleanupInvalidSharedAccess(userId: string) {
    const { tenantDb: _tenantDb } = await this.getContext(userId);
    const dataAccessService = new DataAccessService({
      tableName: tenantTables.documentsDataKeys,
      resourceIdColumn: "documentId",
    });
    await dataAccessService.revokeSharedAccessForRecipientsWithoutKeys(userId);
  }

  private async migrateDataKeysToUserControlled(
    userId: string,
    userMasterKey: string,
    db: TenantDB,
  ) {
    const appEncryptionKey = TextTransformations.base64ToBuffer(envConfig.storage.encryptionKey!);
    const userMasterKeyBuffer = TextTransformations.base64ToBuffer(userMasterKey);

    const appControlledKeys = await db
      .select({
        id: tenantTables.documentsDataKeys.id,
        encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
        thumbnailEncryptedMasterKey: tenantTables.documentsDataKeys.thumbnailEncryptedMasterKey,
        encryptionMode: tenantTables.documentsDataKeys.encryptionMode,
      })
      .from(tenantTables.documentsDataKeys)
      .where(
        and(
          eq(tenantTables.documentsDataKeys.userId, userId),
          eq(tenantTables.documentsDataKeys.isActive, true),
          eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED),
        ),
      );

    let successCount = 0;
    let errorCount = 0;

    for (const dataKey of appControlledKeys) {
      try {
        const decryptedMasterKey = await useSymmetricDecrypt({
          key: appEncryptionKey,
          data: dataKey.encryptedMasterKey as Uint8Array,
        });

        const reEncryptedMasterKey = await useSymmetricEncrypt({
          key: userMasterKeyBuffer,
          data: decryptedMasterKey,
        });

        let reEncryptedThumbnailMasterKey: Uint8Array | null = null;
        if (dataKey.thumbnailEncryptedMasterKey) {
          try {
            const decryptedThumbnailKey = await useSymmetricDecrypt({
              key: appEncryptionKey,
              data: dataKey.thumbnailEncryptedMasterKey as Uint8Array,
            });
            reEncryptedThumbnailMasterKey = await useSymmetricEncrypt({
              key: userMasterKeyBuffer,
              data: decryptedThumbnailKey,
            });
          } catch (_error) {
            useLogger(LoggerLevels.warn, {
              message: `Failed to migrate thumbnail key for document ${dataKey.id}`,
              section: loggerAppSections.ENCRYPTION,
              messageKey: "encryption.migration_thumbnail_failed",
              details: { documentId: dataKey.id, error: _error instanceof Error ? _error.message : String(_error) },
            });
          }
        }

        await db
          .update(tenantTables.documentsDataKeys)
          .set({
            encryptedMasterKey: reEncryptedMasterKey,
            thumbnailEncryptedMasterKey: reEncryptedThumbnailMasterKey ?? dataKey.thumbnailEncryptedMasterKey,
            encryptionMode: DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.documentsDataKeys.id, dataKey.id));

        successCount++;
      } catch (_error) {
        errorCount++;
        useLogger(LoggerLevels.warn, {
          message: `Failed to migrate data key for document ${dataKey.id}`,
          section: loggerAppSections.ENCRYPTION,
          messageKey: "encryption.migration_key_failed",
          details: { documentId: dataKey.id, error: _error instanceof Error ? _error.message : String(_error) },
        });
      }
    }
  }

  private async migrateDataKeysToAppControlled(
    userId: string,
    userMasterKey: Uint8Array,
    db: TenantTransaction,
  ): Promise<{ migratedKeys: number; sharedKeysConverted: number }> {
    const appEncryptionKey = TextTransformations.base64ToBuffer(envConfig.storage.encryptionKey!);

    // Count of keys that NEEDED migrating but failed. Any non-zero value makes
    // disable an all-or-nothing failure so the transaction rolls back and the
    // `isEnhancedEncryptionEnabled` flag never flips while keys remain wrapped
    // under the user master key (which would render those documents permanently
    // undecryptable once the master key is no longer obtainable).
    let migrationFailures = 0;

    const userControlledKeys = await db
      .select({
        id: tenantTables.documentsDataKeys.id,
        documentId: tenantTables.documentsDataKeys.documentId,
        encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
        thumbnailEncryptedMasterKey: tenantTables.documentsDataKeys.thumbnailEncryptedMasterKey,
      })
      .from(tenantTables.documentsDataKeys)
      .where(
        and(
          eq(tenantTables.documentsDataKeys.userId, userId),
          eq(tenantTables.documentsDataKeys.isActive, true),
          eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED),
        ),
      );

    let migratedKeys = 0;
    let sharedKeysConverted = 0;

    const decryptedMasterKeysByDocumentId = new Map<string, Uint8Array>();
    const decryptedThumbnailKeysByDocumentId = new Map<string, Uint8Array>();

    try {
      for (const dataKey of userControlledKeys) {
        try {
          const decryptedMasterKey = await useSymmetricDecrypt({
            key: userMasterKey,
            data: dataKey.encryptedMasterKey as Uint8Array,
          });

          const reEncryptedMasterKey = await useSymmetricEncrypt({
            key: appEncryptionKey,
            data: decryptedMasterKey,
          });

          decryptedMasterKeysByDocumentId.set(dataKey.documentId, decryptedMasterKey);

          let reEncryptedThumbnailMasterKey: Uint8Array | null = null;
          if (dataKey.thumbnailEncryptedMasterKey) {
            try {
              const decryptedThumbnailKey = await useSymmetricDecrypt({
                key: userMasterKey,
                data: dataKey.thumbnailEncryptedMasterKey as Uint8Array,
              });
              reEncryptedThumbnailMasterKey = await useSymmetricEncrypt({
                key: appEncryptionKey,
                data: decryptedThumbnailKey,
              });
              decryptedThumbnailKeysByDocumentId.set(dataKey.documentId, decryptedThumbnailKey);
            } catch (_error) {
              migrationFailures++;
              useLogger(LoggerLevels.warn, {
                message: `Failed to migrate thumbnail key for document ${dataKey.id}`,
                section: loggerAppSections.ENCRYPTION,
                messageKey: "encryption.migration_thumbnail_failed",
                details: { documentId: dataKey.id, error: _error instanceof Error ? _error.message : String(_error) },
              });
            }
          }

          await db
            .update(tenantTables.documentsDataKeys)
            .set({
              encryptedMasterKey: reEncryptedMasterKey,
              thumbnailEncryptedMasterKey: reEncryptedThumbnailMasterKey ?? dataKey.thumbnailEncryptedMasterKey,
              encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
              updatedAt: getTimeNowForStorage(),
            })
            .where(eq(tenantTables.documentsDataKeys.id, dataKey.id));

          migratedKeys++;
        } catch (_error) {
          migrationFailures++;
          useLogger(LoggerLevels.warn, {
            message: `Failed to migrate data key back to app-controlled for document ${dataKey.id}`,
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption.migration_key_failed",
            details: { documentId: dataKey.id, error: _error instanceof Error ? _error.message : String(_error) },
          });
        }
      }

      const sharedKeys = await db
        .select({
          id: tenantTables.documentsDataKeys.id,
          documentId: tenantTables.documentsDataKeys.documentId,
          encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
          thumbnailEncryptedMasterKey: tenantTables.documentsDataKeys.thumbnailEncryptedMasterKey,
        })
        .from(tenantTables.documentsDataKeys)
        .where(
          and(
            eq(tenantTables.documentsDataKeys.grantedBy, userId),
            eq(tenantTables.documentsDataKeys.isActive, true),
            eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC),
          ),
        );

      for (const sharedKey of sharedKeys) {
        const rawMasterKey = decryptedMasterKeysByDocumentId.get(sharedKey.documentId);

        if (!rawMasterKey) {
          migrationFailures++;
          useLogger(LoggerLevels.warn, {
            message: `No decrypted master key found for shared key ${sharedKey.id} (document ${sharedKey.documentId}), skipping`,
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption.migration_shared_key_skipped",
            details: { keyId: sharedKey.id, documentId: sharedKey.documentId },
          });
          continue;
        }

        try {
          const reEncryptedMasterKey = await useSymmetricEncrypt({
            key: appEncryptionKey,
            data: rawMasterKey,
          });

          let reEncryptedThumbnailMasterKey: Uint8Array | null = null;
          const rawThumbnailKey = decryptedThumbnailKeysByDocumentId.get(sharedKey.documentId);
          if (rawThumbnailKey && sharedKey.thumbnailEncryptedMasterKey) {
            reEncryptedThumbnailMasterKey = await useSymmetricEncrypt({
              key: appEncryptionKey,
              data: rawThumbnailKey,
            });
          }

          await db
            .update(tenantTables.documentsDataKeys)
            .set({
              encryptedMasterKey: reEncryptedMasterKey,
              thumbnailEncryptedMasterKey: reEncryptedThumbnailMasterKey ?? sharedKey.thumbnailEncryptedMasterKey,
              encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
              updatedAt: getTimeNowForStorage(),
            })
            .where(eq(tenantTables.documentsDataKeys.id, sharedKey.id));

          sharedKeysConverted++;
        } catch (_error) {
          migrationFailures++;
          useLogger(LoggerLevels.warn, {
            message: `Failed to convert shared key ${sharedKey.id} to app-controlled`,
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption.migration_shared_key_failed",
            details: { keyId: sharedKey.id, error: _error instanceof Error ? _error.message : String(_error) },
          });
        }
      }

      const asymmetricRecipientKeys = await db
        .select({
          id: tenantTables.documentsDataKeys.id,
          documentId: tenantTables.documentsDataKeys.documentId,
          encryptedMasterKey: tenantTables.documentsDataKeys.encryptedMasterKey,
          thumbnailEncryptedMasterKey: tenantTables.documentsDataKeys.thumbnailEncryptedMasterKey,
        })
        .from(tenantTables.documentsDataKeys)
        .where(
          and(
            eq(tenantTables.documentsDataKeys.userId, userId),
            eq(tenantTables.documentsDataKeys.isActive, true),
            eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.ASYMMETRIC),
          ),
        );

      if (asymmetricRecipientKeys.length > 0) {
        const encryptedPrivateKey = await this.asymmetricKeysService.getEncryptedPrivateKey(userId);

        if (encryptedPrivateKey) {
          for (const recipientKey of asymmetricRecipientKeys) {
            try {
              const decryptedMasterKey = await this.keySharingService.decryptSharedDataMasterKey(
                recipientKey.encryptedMasterKey,
                encryptedPrivateKey,
                userMasterKey,
              );

              const reEncryptedMasterKey = await useSymmetricEncrypt({
                key: appEncryptionKey,
                data: decryptedMasterKey,
              });

              let reEncryptedThumbnailMasterKey: Uint8Array | null = null;
              if (recipientKey.thumbnailEncryptedMasterKey) {
                try {
                  const decryptedThumbnailKey = await this.keySharingService.decryptSharedDataMasterKey(
                    recipientKey.thumbnailEncryptedMasterKey,
                    encryptedPrivateKey,
                    userMasterKey,
                  );
                  reEncryptedThumbnailMasterKey = await useSymmetricEncrypt({
                    key: appEncryptionKey,
                    data: decryptedThumbnailKey,
                  });
                } catch (_error) {
                  migrationFailures++;
                  useLogger(LoggerLevels.warn, {
                    message: `Failed to migrate recipient thumbnail key ${recipientKey.id}`,
                    section: loggerAppSections.ENCRYPTION,
                    messageKey: "encryption.migration_recipient_thumbnail_failed",
                    details: { keyId: recipientKey.id, error: _error instanceof Error ? _error.message : String(_error) },
                  });
                }
              }

              await db
                .update(tenantTables.documentsDataKeys)
                .set({
                  encryptedMasterKey: reEncryptedMasterKey,
                  thumbnailEncryptedMasterKey: reEncryptedThumbnailMasterKey ?? recipientKey.thumbnailEncryptedMasterKey,
                  encryptionMode: DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED,
                  updatedAt: getTimeNowForStorage(),
                })
                .where(eq(tenantTables.documentsDataKeys.id, recipientKey.id));

              sharedKeysConverted++;
            } catch (_error) {
              migrationFailures++;
              useLogger(LoggerLevels.warn, {
                message: `Failed to convert recipient asymmetric key ${recipientKey.id} to app-controlled`,
                section: loggerAppSections.ENCRYPTION,
                messageKey: "encryption.migration_recipient_key_failed",
                details: { keyId: recipientKey.id, error: _error instanceof Error ? _error.message : String(_error) },
              });
            }
          }
        } else {
          migrationFailures += asymmetricRecipientKeys.length;
          useLogger(LoggerLevels.warn, {
            message: `User ${userId} has asymmetric recipient keys but no encrypted private key, skipping migration`,
            section: loggerAppSections.ENCRYPTION,
            messageKey: "encryption.migration_no_private_key",
            details: { userId, skippedCount: asymmetricRecipientKeys.length },
          });
        }
      }
    } finally {
      for (const key of decryptedMasterKeysByDocumentId.values()) {
        key.fill(0);
      }
      for (const key of decryptedThumbnailKeysByDocumentId.values()) {
        key.fill(0);
      }
    }

    // All-or-nothing: if any key that needed migrating could not be re-wrapped
    // under the app key, fail loudly so the surrounding transaction rolls back
    // and the `isEnhancedEncryptionEnabled` flag is NOT flipped. Flipping it
    // while keys remain wrapped under the user master key would leave those
    // documents permanently undecryptable.
    if (migrationFailures > 0) {
      throwHttpError("ENCRYPTION.DISABLE_MIGRATION_INCOMPLETE");
    }

    return { migratedKeys, sharedKeysConverted };
  }

  private async reEncryptDataKeysWithNewMasterKey(
    userId: string,
    oldMasterKey: Uint8Array,
    newMasterKey: Uint8Array,
    db: TenantDB,
  ) {
    const keys = await db.select()
      .from(tenantTables.documentsDataKeys)
      .where(and(
        eq(tenantTables.documentsDataKeys.userId, userId),
        eq(tenantTables.documentsDataKeys.isActive, true),
        eq(tenantTables.documentsDataKeys.encryptionMode, DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED),
      ));

    for (const dk of keys) {
      try {
        const plain = await useSymmetricDecrypt({ key: oldMasterKey, data: dk.encryptedMasterKey as Uint8Array });
        const wrapped = await useSymmetricEncrypt({ key: newMasterKey, data: plain });

        let wrappedThumbnail: Uint8Array | null = null;
        if (dk.thumbnailEncryptedMasterKey) {
          const tPlain = await useSymmetricDecrypt({ key: oldMasterKey, data: dk.thumbnailEncryptedMasterKey as Uint8Array });
          wrappedThumbnail = await useSymmetricEncrypt({ key: newMasterKey, data: tPlain });
        }

        await db.update(tenantTables.documentsDataKeys)
          .set({
            encryptedMasterKey: wrapped,
            thumbnailEncryptedMasterKey: wrappedThumbnail,
            updatedAt: Math.floor(Date.now() / 1000),
          })
          .where(eq(tenantTables.documentsDataKeys.id, dk.id));
      } catch (_error) {
        useLogger(LoggerLevels.warn, {
          message: `Best-effort re-encryption of data key failed, skipping document ${dk.id}`,
          section: loggerAppSections.ENCRYPTION,
          messageKey: "encryption.rotation_data_key_skipped",
          details: { userId, documentId: dk.id, error: _error instanceof Error ? _error.message : String(_error) },
        });
      }
    }
  }

  async hasPassword(userId: string): Promise<boolean> {
    const globalDb = getGlobalDB();
    const [user] = await globalDb.select({ password: globalTables.users.password })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);
    return !!user?.password;
  }

  async disableEnhancedEncryption(
    userId: string,
    accessToken: string,
    sessionKey?: string,
  ): Promise<{ success: boolean; migratedKeys: number; sharedKeysConverted: number }> {
    const { tenantDb, environmentId } = await this.getContext(userId);

    const userMasterKey = await EncryptionSystemUserService.getUserMasterKeyForDataEncryptionWithPRF(
      userId,
      accessToken,
      undefined,
      undefined,
      sessionKey,
      environmentId,
    );

    let migratedKeys = 0;
    let sharedKeysConverted = 0;

    try {
      await tenantDb.transaction(async (tx) => {
        const result = await this.migrateDataKeysToAppControlled(
          userId,
          userMasterKey,
          tx,
        );
        migratedKeys = result.migratedKeys;
        sharedKeysConverted = result.sharedKeysConverted;

        // Only reached if every key that needed migrating succeeded;
        // migrateDataKeysToAppControlled throws otherwise, rolling back this tx.
        await tx.update(tenantTables.userEncryption)
          .set({
            isEnhancedEncryptionEnabled: false,
            updatedAt: getTimeNowForStorage(),
          })
          .where(eq(tenantTables.userEncryption.userId, userId));
      });
    } finally {
      userMasterKey.fill(0);
    }

    // success is now meaningful: a partial migration throws and never reaches here.
    return { success: true, migratedKeys, sharedKeysConverted };
  }

  async canEnableEnhancedEncryption(userId: string): Promise<{
    canEnable: boolean;
    hasPassword: boolean;
    hasPasskeys: boolean;
    hasPRF: boolean;
    needsPRFSetup: boolean;
    recommendedMethod: "password" | "passkey" | "none";
  }> {
    const globalDb = getGlobalDB();
    const [hasPassword, passkeys] = await Promise.all([
      this.hasPassword(userId),
      globalDb.select({ id: globalTables.userPasskeys.id })
        .from(globalTables.userPasskeys)
        .where(eq(globalTables.userPasskeys.userId, userId)),
    ]);

    const hasPasskeys = passkeys.length > 0;

    let hasPRF = false;
    if (hasPasskeys) {
      const prfKeys = await globalDb.select({ credentialId: globalTables.passkeyPRFKeys.credentialId })
        .from(globalTables.passkeyPRFKeys)
        .where(inArray(globalTables.passkeyPRFKeys.credentialId, passkeys.map((p) => p.id)));
      hasPRF = prfKeys.length > 0;
    }

    const needsPRFSetup = hasPasskeys && !hasPRF;

    let recommendedMethod: "password" | "passkey" | "none" = "none";
    if (hasPassword) {
      recommendedMethod = "password";
    } else if (hasPRF || hasPasskeys) {
      recommendedMethod = "passkey";
    }

    return {
      canEnable: hasPassword || hasPRF || hasPasskeys,
      hasPassword,
      hasPasskeys,
      hasPRF,
      needsPRFSetup,
      recommendedMethod,
    };
  }

  // deno-lint-ignore require-await
  async initiatePRFSetup(
    _userId: string,
  ): Promise<{ success: boolean }> {
    // Placeholder implementation
    return { success: true };
  }

  // deno-lint-ignore require-await
  async verifyAndCachePRFSetup(
    _userId: string,
    _credentialId: string,
    _prfOutput: string,
  ): Promise<{ success: boolean }> {
    // Placeholder implementation
    return { success: true };
  }

  // deno-lint-ignore require-await
  async rewrapStalePasskeyWithRecoveryPhrase(
    _userId: string,
    _credentialId: string,
    _recoveryPhrase: string,
  ): Promise<{ success: boolean }> {
    // Placeholder implementation
    return { success: true };
  }
}
