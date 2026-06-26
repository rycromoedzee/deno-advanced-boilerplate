/**
 * @file services/encryption/sharing.service.ts
 * @description Sharing service (encryption)
 */
import { and, eq } from "@deps";
import { loggerAppSections } from "@logger/index.ts";
import { getTimeNowForStorage } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";
import { getTenantDB } from "@db/index.ts";

/**
 * Generic Sharing Service
 */
export class SharingService {
  constructor(private readonly tableConfig: IEncryptionTableConfig) {}

  private async getDB() {
    return await getTenantDB();
  }

  async revokeAccess(
    resourceId: string,
    userId: string,
  ): Promise<{ id: string } | null> {
    return await tracedWithServiceErrorHandling(
      "SharingService.revokeAccess",
      {
        service: "SharingService",
        method: "revokeAccess",
        section: loggerAppSections.ENCRYPTION,
        details: { resourceId, userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const db = await this.getDB();
        const now = getTimeNowForStorage();
        const result = await db
          .update(this.tableConfig.tableName)
          .set({
            isActive: false,
            revokedAt: now,
            updatedAt: now,
          })
          .where(
            and(
              eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
              eq(this.tableConfig.tableName.userId, userId),
              eq(this.tableConfig.tableName.isActive, true),
            ),
          )
          .returning({ id: this.tableConfig.tableName.id });

        return result.length > 0 ? { id: result[0].id } : null;
      },
    );
  }

  async updatePermission(
    resourceId: string,
    userId: string,
    newPermissionLevel: string | number,
  ): Promise<{ id: string; updatedAt: number } | null> {
    const db = await this.getDB();
    const now = getTimeNowForStorage();
    const result = await db
      .update(this.tableConfig.tableName)
      .set({
        permissionLevel: newPermissionLevel,
        updatedAt: now,
      })
      .where(
        and(
          eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
          eq(this.tableConfig.tableName.userId, userId),
          eq(this.tableConfig.tableName.isActive, true),
        ),
      )
      .returning({ id: this.tableConfig.tableName.id });

    return result.length > 0 ? { id: result[0].id, updatedAt: now } : null;
  }

  async listSharedUsers(resourceId: string) {
    const db = await this.getDB();
    const results = await db
      .select({
        userId: this.tableConfig.tableName.userId,
        permissionLevel: this.tableConfig.tableName.permissionLevel,
        grantedAt: this.tableConfig.tableName.grantedAt,
        grantedBy: this.tableConfig.tableName.grantedBy,
      })
      .from(this.tableConfig.tableName)
      .where(
        and(
          eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
          eq(this.tableConfig.tableName.isActive, true),
          eq(this.tableConfig.tableName.isPublicShare, false),
        ),
      );

    return results
      .filter((r) => r.userId !== null)
      .map((r) => ({
        userId: r.userId as string,
        permissionLevel: r.permissionLevel,
        grantedAt: r.grantedAt,
        grantedBy: r.grantedBy,
      }));
  }

  async listPublicShares(resourceId: string) {
    const db = await this.getDB();
    const results = await db
      .select({
        id: this.tableConfig.tableName.id,
        shareToken: this.tableConfig.tableName.publicShareToken,
        permissionLevel: this.tableConfig.tableName.permissionLevel,
        isPasswordProtected: this.tableConfig.tableName.isPasswordProtected,
        expiresAt: this.tableConfig.tableName.publicShareExpiresAt,
        recipientEmail: this.tableConfig.tableName.recipientEmail,
        createdAt: this.tableConfig.tableName.createdAt,
        sharerEncryptedShareKey: this.tableConfig.tableName.sharerEncryptedShareKey,
      })
      .from(this.tableConfig.tableName)
      .where(
        and(
          eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
          eq(this.tableConfig.tableName.isActive, true),
          eq(this.tableConfig.tableName.isPublicShare, true),
        ),
      );

    return results
      .filter((r) => r.shareToken !== null)
      .map((r) => ({
        id: r.id,
        shareToken: r.shareToken as string,
        permissionLevel: r.permissionLevel,
        isPasswordProtected: r.isPasswordProtected,
        expiresAt: r.expiresAt,
        recipientEmail: r.recipientEmail,
        createdAt: r.createdAt,
        sharerEncryptedShareKey: r.sharerEncryptedShareKey as Uint8Array | null,
      }));
  }

  async disablePublicShares(resourceId: string, shareToken?: string): Promise<number> {
    const db = await this.getDB();
    const now = getTimeNowForStorage();
    const whereClause = shareToken
      ? and(
        eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
        eq(this.tableConfig.tableName.isPublicShare, true),
        eq(this.tableConfig.tableName.isActive, true),
        eq(this.tableConfig.tableName.publicShareToken, shareToken),
      )
      : and(
        eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
        eq(this.tableConfig.tableName.isPublicShare, true),
        eq(this.tableConfig.tableName.isActive, true),
      );

    const result = await db
      .update(this.tableConfig.tableName)
      .set({
        isActive: false,
        revokedAt: now,
        updatedAt: now,
      })
      .where(whereClause)
      .returning({ id: this.tableConfig.tableName.id });

    return result.length;
  }

  async incrementAccessCount(dataKeyId: string, currentCount: number) {
    const db = await this.getDB();
    db.update(this.tableConfig.tableName)
      .set({
        accessCount: currentCount + 1,
        lastAccessedAt: Math.floor(Date.now() / 1000),
      })
      .where(eq(this.tableConfig.tableName.id, dataKeyId))
      .catch(() => {});
  }

  async getEncryptionMode(resourceId: string): Promise<number> {
    const db = await this.getDB();
    const [dataKey] = await db
      .select({
        encryptionMode: this.tableConfig.tableName.encryptionMode,
      })
      .from(this.tableConfig.tableName)
      .where(
        and(
          eq(this.tableConfig.tableName[this.tableConfig.resourceIdColumn], resourceId),
          eq(this.tableConfig.tableName.isActive, true),
        ),
      )
      .limit(1);

    if (!dataKey) throwHttpError("COMMON.NOT_FOUND");
    return dataKey.encryptionMode;
  }

  async getPublicShareByToken(token: string) {
    const db = await this.getDB();
    const results = await db
      .select({
        id: this.tableConfig.tableName.id,
        resourceId: this.tableConfig.tableName[this.tableConfig.resourceIdColumn],
        encryptedMasterKey: this.tableConfig.tableName.encryptedMasterKey,
        permissionLevel: this.tableConfig.tableName.permissionLevel,
        isPasswordProtected: this.tableConfig.tableName.isPasswordProtected,
        publicShareExpiresAt: this.tableConfig.tableName.publicShareExpiresAt,
        accessCount: this.tableConfig.tableName.accessCount,
        encryptionMode: this.tableConfig.tableName.encryptionMode,
      })
      .from(this.tableConfig.tableName)
      .where(
        and(
          eq(this.tableConfig.tableName.publicShareToken, token),
          eq(this.tableConfig.tableName.isPublicShare, true),
          eq(this.tableConfig.tableName.isActive, true),
        ),
      )
      .limit(1);

    if (results.length === 0) return null;

    const r = results[0];
    return {
      id: r.id,
      resourceId: r.resourceId as string,
      encryptedMasterKey: r.encryptedMasterKey as Uint8Array,
      permissionLevel: r.permissionLevel,
      isPasswordProtected: r.isPasswordProtected,
      publicShareExpiresAt: r.publicShareExpiresAt,
      accessCount: r.accessCount,
      encryptionMode: r.encryptionMode,
    };
  }
}
