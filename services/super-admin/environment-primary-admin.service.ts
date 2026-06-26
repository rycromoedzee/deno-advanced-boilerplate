/**
 * @file services/super-admin/environment-primary-admin.service.ts
 * @description Environment Primary Admin service (super admin)
 */
import { and, asc, eq } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { getPasswordResetService } from "@services/auth/index.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import { envConfig } from "@config/env.ts";
import type { IEnvironmentPrimaryAdminUpdateRequest } from "@models/super-admin/index.ts";

export class EnvironmentPrimaryAdminService {
  private async findPrimaryAdminId(environmentId: string) {
    const tenantDb = await getTenantDB(environmentId);
    const [tenantAdmin] = await tenantDb
      .select({
        id: tenantTables.userProfiles.userId,
      })
      .from(tenantTables.userProfiles)
      .where(eq(tenantTables.userProfiles.isAdmin, true))
      .orderBy(asc(tenantTables.userProfiles.createdAt))
      .limit(1);

    if (!tenantAdmin) {
      return null;
    }

    const globalDb = getGlobalDB();
    const [admin] = await globalDb
      .select({
        id: globalTables.users.id,
        isActive: globalTables.users.isActive,
        lastLoginAt: globalTables.users.lastLoginAt,
      })
      .from(globalTables.users)
      .where(
        and(
          eq(globalTables.users.id, tenantAdmin.id),
          eq(globalTables.users.environmentId, environmentId),
        ),
      )
      .limit(1);

    return admin ?? null;
  }

  private async getAdminProfile(userId: string, environmentId: string) {
    const tenantDb = await getTenantDB(environmentId);
    const [profile] = await tenantDb
      .select({
        firstName: tenantTables.userProfiles.firstName,
        lastName: tenantTables.userProfiles.lastName,
        email: tenantTables.userProfiles.email,
      })
      .from(tenantTables.userProfiles)
      .where(eq(tenantTables.userProfiles.userId, userId))
      .limit(1);
    return profile ?? null;
  }

  async getPrimaryAdmin(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentPrimaryAdminService.getPrimaryAdmin",
      {
        service: "EnvironmentPrimaryAdminService",
        method: "getPrimaryAdmin",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const globalDb = getGlobalDB();
        const [env] = await globalDb
          .select({ id: globalTables.environments.id })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, environmentId))
          .limit(1);

        if (!env) {
          throwHttpError("COMMON.NOT_FOUND");
        }

        const admin = await this.findPrimaryAdminId(environmentId);
        if (!admin) {
          throwHttpError("ENVIRONMENT.NO_PRIMARY_ADMIN");
        }

        const profile = await this.getAdminProfile(admin.id, environmentId);

        return {
          id: admin.id,
          firstName: profile?.firstName ?? "",
          lastName: profile?.lastName ?? "",
          email: profile?.email ?? "",
          isActive: admin.isActive,
          lastLoginAt: admin.lastLoginAt,
        };
      },
    );
  }

  async updatePrimaryAdmin(environmentId: string, data: IEnvironmentPrimaryAdminUpdateRequest) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentPrimaryAdminService.updatePrimaryAdmin",
      {
        service: "EnvironmentPrimaryAdminService",
        method: "updatePrimaryAdmin",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const admin = await this.findPrimaryAdminId(environmentId);
        if (!admin) {
          throwHttpError("ENVIRONMENT.NO_PRIMARY_ADMIN");
        }

        const hasUpdates = data.firstName !== undefined || data.lastName !== undefined || data.email !== undefined;
        if (!hasUpdates) {
          throwHttpError("COMMON.BAD_REQUEST");
        }

        const globalDb = getGlobalDB();
        const updateData: Record<string, unknown> = {
          updatedAt: Math.floor(Date.now() / 1000),
        };
        if (data.firstName !== undefined) updateData["firstName"] = data.firstName;
        if (data.lastName !== undefined) updateData["lastName"] = data.lastName;
        if (data.email !== undefined) updateData["email"] = data.email.toLowerCase().trim();

        span.attributes["admin_user_id"] = admin.id;

        await globalDb
          .update(globalTables.users)
          .set(updateData)
          .where(eq(globalTables.users.id, admin.id));

        const tenantUpdateData: Record<string, unknown> = {
          updatedAt: Math.floor(Date.now() / 1000),
        };
        if (data.firstName !== undefined) tenantUpdateData["firstName"] = data.firstName;
        if (data.lastName !== undefined) tenantUpdateData["lastName"] = data.lastName;
        if (data.email !== undefined) tenantUpdateData["email"] = data.email.toLowerCase().trim();

        const tenantDb = await getTenantDB(environmentId);
        await tenantDb
          .update(tenantTables.userProfiles)
          .set(tenantUpdateData)
          .where(eq(tenantTables.userProfiles.userId, admin.id));

        const profile = await this.getAdminProfile(admin.id, environmentId);

        return {
          id: admin.id,
          firstName: profile?.firstName ?? "",
          lastName: profile?.lastName ?? "",
          email: profile?.email ?? "",
          isActive: admin.isActive,
          lastLoginAt: admin.lastLoginAt,
        };
      },
    );
  }

  async resetPrimaryAdminPassword(environmentId: string) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentPrimaryAdminService.resetPrimaryAdminPassword",
      {
        service: "EnvironmentPrimaryAdminService",
        method: "resetPrimaryAdminPassword",
        section: loggerAppSections.INTERNAL,
        details: { environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["environment_id"] = environmentId;

        const admin = await this.findPrimaryAdminId(environmentId);
        if (!admin) {
          throwHttpError("ENVIRONMENT.NO_PRIMARY_ADMIN");
        }

        span.attributes["admin_user_id"] = admin.id;

        const tenantDb = await getTenantDB(environmentId);
        const [encryption, userProfile] = await Promise.all([
          tenantDb
            .select({
              isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
            })
            .from(tenantTables.userEncryption)
            .where(eq(tenantTables.userEncryption.userId, admin.id))
            .limit(1)
            .then((result) => result[0]),
          tenantDb
            .select({
              language: tenantTables.userProfiles.language,
              firstName: tenantTables.userProfiles.firstName,
              lastName: tenantTables.userProfiles.lastName,
              email: tenantTables.userProfiles.email,
            })
            .from(tenantTables.userProfiles)
            .where(eq(tenantTables.userProfiles.userId, admin.id))
            .limit(1)
            .then((result) => result[0]),
        ]);

        const recoveryPhraseRequired = encryption?.isEnhancedEncryptionEnabled ?? false;
        const language = userProfile?.language ?? "en";
        const adminEmail = userProfile?.email ?? "";
        const _adminFirstName = userProfile?.firstName ?? "";

        const passwordResetService = getPasswordResetService();
        const { token } = await passwordResetService.generatePasswordResetToken(admin.id);

        const resetUrl = `https://${envConfig.public.frontURL}/auth/forget-password/${encodeURIComponent(token)}`;

        fireAndForgetOperation("send-admin-password-reset-email", async () => {
          const emailSenderService = getEmailSenderService();
          await emailSenderService.useSendEmail(
            admin.id,
            adminEmail,
            {
              email: adminEmail,
              resetURL: resetUrl,
              recoveryPhraseRequired,
            } as unknown as JSON,
            "password-reset",
            language,
          );
        });

        return { message: "Password reset email sent" };
      },
    );
  }
}
