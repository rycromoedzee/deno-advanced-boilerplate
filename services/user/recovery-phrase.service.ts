/**
 * @file services/user/recovery-phrase.service.ts
 * @description Recovery Phrase service (user)
 */
import { eq, generateMnemonic, randomBytes, validateMnemonic } from "@deps";
import { bytesToHex, hexToBytes } from "@deps";
import { throwHttpError } from "../../utils/http-exception.ts";
import { TextHashing } from "@utils/text/index.ts";
import { getTimeNowForStorage, safeEqual } from "@utils/shared/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

function createPhraseVerificationTestData(phrase: string): Uint8Array {
  const salt = randomBytes(16);
  const saltHex = bytesToHex(salt);
  const verificationHash = TextHashing.generateHashFromKeyForAuthRecoveryPhrase(phrase + saltHex);
  const hashBytes = hexToBytes(verificationHash);
  const combined = new Uint8Array(16 + hashBytes.length);
  combined.set(salt, 0);
  combined.set(hashBytes, 16);
  return combined;
}

function createRecoveryPhrase(): string {
  const phrase = generateMnemonic(128);
  if (!validateMnemonic(phrase)) throwHttpError("COMMON.INTERNAL_SERVER_ERROR");
  return phrase;
}

export function userRecoveryPhraseCreateHashFromPhrase(phrase: string): string {
  if (!validateMnemonic(phrase)) throwHttpError("VALIDATION.INVALID_FORMAT");
  return TextHashing.generateHashFromKeyForAuthRecoveryPhrase(phrase);
}

export class RecoveryPhraseCreateService {
  private async getContext(userId: string) {
    const globalDb = getGlobalDB();
    const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);
    if (!userRow) throwHttpError("USER.NOT_FOUND");
    const tenantDb = await getTenantDB(userRow.environmentId);
    return { tenantDb };
  }

  async hasRecoveryPhraseOrCreate(userId: string): Promise<string | null> {
    const { tenantDb } = await this.getContext(userId);
    const [userData] = await tenantDb.select({
      isRecoveryPhraseVerified: tenantTables.userEncryption.isRecoveryPhraseVerified,
    })
      .from(tenantTables.userEncryption)
      .where(eq(tenantTables.userEncryption.userId, userId))
      .limit(1);

    if (userData?.isRecoveryPhraseVerified) return null;
    return this.createNewRecoveryPhraseForUser(userId);
  }

  async createNewRecoveryPhraseForUser(userId: string): Promise<string> {
    const phrase = createRecoveryPhrase();
    await this.createAndStoreVerificationData(userId, phrase);
    return phrase;
  }

  async createAndStoreVerificationData(userId: string, phrase: string): Promise<void> {
    if (!validateMnemonic(phrase)) throwHttpError("VALIDATION.INVALID_FORMAT");
    const { tenantDb } = await this.getContext(userId);
    const verificationData = createPhraseVerificationTestData(phrase);
    await tenantDb.update(tenantTables.userEncryption)
      .set({
        userEncryptedRecoveryPhraseVerificationData: verificationData,
        isRecoveryPhraseVerified: false,
        recoveryPhraseVerifiedAt: null,
      })
      .where(eq(tenantTables.userEncryption.userId, userId));
  }

  /**
   * Reset recovery phrase - creates new phrase and clears verified status
   */
  async resetRecoveryPhrase(userId: string): Promise<string> {
    return await this.createNewRecoveryPhraseForUser(userId);
  }
}

export class RecoveryPhraseValidateService {
  private async getContext(userId: string) {
    const globalDb = getGlobalDB();
    const [userRow] = await globalDb.select({ environmentId: globalTables.users.environmentId })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);
    if (!userRow) throwHttpError("USER.NOT_FOUND");
    const tenantDb = await getTenantDB(userRow.environmentId);
    return { tenantDb };
  }

  async validatePhraseProvidedByUser(userId: string, phrase: string): Promise<boolean> {
    try {
      if (!validateMnemonic(phrase)) return false;
      const { tenantDb } = await this.getContext(userId);
      const [user] = await tenantDb.select({
        userEncryptedRecoveryPhraseVerificationData: tenantTables.userEncryption.userEncryptedRecoveryPhraseVerificationData,
        isRecoveryPhraseVerified: tenantTables.userEncryption.isRecoveryPhraseVerified,
      })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, userId))
        .limit(1);

      if (!user?.userEncryptedRecoveryPhraseVerificationData) return false;

      const isValid = this.validatePhrase(phrase, user.userEncryptedRecoveryPhraseVerificationData as Uint8Array);
      if (isValid && !user.isRecoveryPhraseVerified) {
        await this.markAsVerified(userId);
      }
      return isValid;
    } catch (_error) {
      return false;
    }
  }

  private validatePhrase(phrase: string, storedData: Uint8Array): boolean {
    if (storedData.length !== 48) return false;
    const salt = storedData.slice(0, 16);
    const storedHash = storedData.slice(16);
    const expectedHash = TextHashing.generateHashFromKeyForAuthRecoveryPhrase(phrase + bytesToHex(salt));
    return safeEqual(storedHash, hexToBytes(expectedHash));
  }

  async markAsVerified(userId: string): Promise<void> {
    try {
      const { tenantDb } = await this.getContext(userId);
      await tenantDb.update(tenantTables.userEncryption)
        .set({
          isRecoveryPhraseVerified: true,
          recoveryPhraseVerifiedAt: getTimeNowForStorage(),
          updatedAt: getTimeNowForStorage(),
        })
        .where(eq(tenantTables.userEncryption.userId, userId));
    } catch (_error) { /* intentionally empty - best effort update */ }
  }

  /**
   * Get recovery phrase metadata
   */
  async getRecoveryPhraseMetadata(
    userId: string,
  ): Promise<{ hasRecoveryPhrase: boolean; isVerified: boolean; verifiedAt?: number; createdAt?: number } | null> {
    const { tenantDb } = await this.getContext(userId);
    const [data] = await tenantDb.select({
      isRecoveryPhraseVerified: tenantTables.userEncryption.isRecoveryPhraseVerified,
      recoveryPhraseVerifiedAt: tenantTables.userEncryption.recoveryPhraseVerifiedAt,
      createdAt: tenantTables.userEncryption.createdAt,
    })
      .from(tenantTables.userEncryption)
      .where(eq(tenantTables.userEncryption.userId, userId))
      .limit(1);
    if (!data) return null;
    return {
      hasRecoveryPhrase: data.isRecoveryPhraseVerified ?? false,
      isVerified: data.isRecoveryPhraseVerified ?? false,
      verifiedAt: data.recoveryPhraseVerifiedAt ?? undefined,
      createdAt: data.createdAt,
    };
  }

  /**
   * Remove recovery phrase
   */
  async removePhrase(userId: string): Promise<void> {
    const { tenantDb } = await this.getContext(userId);
    await tenantDb.update(tenantTables.userEncryption)
      .set({
        userEncryptedRecoveryPhraseVerificationData: null,
        isRecoveryPhraseVerified: false,
        updatedAt: getTimeNowForStorage(),
      })
      .where(eq(tenantTables.userEncryption.userId, userId));
  }
}
