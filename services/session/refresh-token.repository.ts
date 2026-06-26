/**
 * @file services/session/refresh-token.repository.ts
 * @description Refresh Token repository (session)
 */
import { eq, lt } from "@deps";
import { getGlobalDB, globalTables } from "@db/index.ts";
import { traced } from "@services/tracing/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import type { ITokensRefreshTokenData } from "@services/token/config.ts";

export class RefreshTokenRepository {
  async save(tokenHash: string, data: ITokensRefreshTokenData): Promise<void> {
    return await traced("RefreshTokenRepository.save", "db.query", async (span) => {
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";
      span.attributes["user_id"] = data.userId;

      const db = getGlobalDB();
      await db
        .insert(globalTables.refreshTokens)
        .values({
          tokenHash,
          sessionId: data.sessionId ?? "",
          userId: data.userId,
          fingerprint: data.fingerprint,
          ipAddress: data.ipAddress,
          maxAgeType: data.maxAgeType,
          encryptedPasswordDerivedKey: data.encryptedPasswordDerivedKey ?? null,
          encryptedPRFDerivedKey: data.encryptedPRFDerivedKey ?? null,
          prfCredentialId: data.prfCredentialId ?? null,
          expiresAt: Math.floor(data.expiresAt / 1000),
          createdAt: Math.floor(data.createdAt / 1000),
        })
        .onConflictDoUpdate({
          target: globalTables.refreshTokens.tokenHash,
          set: {
            sessionId: data.sessionId ?? "",
            userId: data.userId,
            fingerprint: data.fingerprint,
            ipAddress: data.ipAddress,
            maxAgeType: data.maxAgeType,
            encryptedPasswordDerivedKey: data.encryptedPasswordDerivedKey ?? null,
            encryptedPRFDerivedKey: data.encryptedPRFDerivedKey ?? null,
            prfCredentialId: data.prfCredentialId ?? null,
            expiresAt: Math.floor(data.expiresAt / 1000),
            createdAt: Math.floor(data.createdAt / 1000),
          },
        });

      span.attributes["success"] = true;
    });
  }

  async findByTokenHash(tokenHash: string): Promise<ITokensRefreshTokenData | null> {
    return await traced("RefreshTokenRepository.findByTokenHash", "db.query", async (span) => {
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

      const db = getGlobalDB();
      const rows = await db
        .select()
        .from(globalTables.refreshTokens)
        .where(eq(globalTables.refreshTokens.tokenHash, tokenHash))
        .limit(1);

      if (rows.length === 0) {
        span.attributes["found"] = false;
        return null;
      }

      const row = rows[0];
      span.attributes["found"] = true;
      span.attributes["user_id"] = row.userId;

      return {
        sessionId: row.sessionId,
        userId: row.userId,
        fingerprint: row.fingerprint,
        ipAddress: row.ipAddress,
        maxAgeType: row.maxAgeType,
        encryptedPasswordDerivedKey: row.encryptedPasswordDerivedKey ?? undefined,
        encryptedPRFDerivedKey: row.encryptedPRFDerivedKey ?? undefined,
        prfCredentialId: row.prfCredentialId ?? undefined,
        expiresAt: row.expiresAt * 1000,
        createdAt: row.createdAt * 1000,
      };
    });
  }

  async deleteByTokenHash(tokenHash: string): Promise<void> {
    return await traced("RefreshTokenRepository.deleteByTokenHash", "db.query", async (span) => {
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

      const db = getGlobalDB();
      await db
        .delete(globalTables.refreshTokens)
        .where(eq(globalTables.refreshTokens.tokenHash, tokenHash));

      span.attributes["success"] = true;
    });
  }

  async deleteByUserId(userId: string): Promise<void> {
    return await traced("RefreshTokenRepository.deleteByUserId", "db.query", async (span) => {
      span.attributes["user_id"] = userId;

      const db = getGlobalDB();
      await db
        .delete(globalTables.refreshTokens)
        .where(eq(globalTables.refreshTokens.userId, userId));

      span.attributes["success"] = true;
    });
  }

  async deleteExpired(): Promise<void> {
    return await traced("RefreshTokenRepository.deleteExpired", "db.query", async (span) => {
      const now = getTimeNowForStorage();
      span.attributes["cutoff_timestamp"] = now;

      const db = getGlobalDB();
      await db
        .delete(globalTables.refreshTokens)
        .where(lt(globalTables.refreshTokens.expiresAt, now));

      span.attributes["success"] = true;
    });
  }

  async updateEncryptionFields(
    tokenHash: string,
    fields: {
      encryptedPasswordDerivedKey?: string | null;
      encryptedPRFDerivedKey?: string | null;
      prfCredentialId?: string | null;
    },
  ): Promise<void> {
    return await traced("RefreshTokenRepository.updateEncryptionFields", "db.query", async (span) => {
      span.attributes["token_hash_prefix"] = tokenHash.substring(0, 8) + "...";

      const db = getGlobalDB();
      await db
        .update(globalTables.refreshTokens)
        .set(fields)
        .where(eq(globalTables.refreshTokens.tokenHash, tokenHash));

      span.attributes["success"] = true;
    });
  }
}
