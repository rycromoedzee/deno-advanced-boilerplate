/**
 * @file services/environment-config-user/environment-config-user-create.service.ts
 * @description Environment Config User Create service (environment config user)
 */
import { and, eq, sql } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { AuthPasswordService, getPasswordResetService } from "@services/auth/index.ts";
import { hasPermission, PermissionAssignmentService } from "@services/permissions/index.ts";
import { generateIdForUser } from "@utils/database/id-generation/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { IEnvironmentConfigUserCreateRequest } from "@models/environment-config-user/index.ts";
import { EnvironmentConfigUserCrudHelpers } from "./environment-config-user-crud.helpers.ts";
import { getEnvironmentConfigUserReadService } from "./singletons.ts";
import { canonicalizeUsername, isReservedUsername } from "@utils/auth/index.ts";
import { fireAndForgetOperation } from "@utils/shared/index.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { envConfig } from "@config/env.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { EMAIL_SIGN_UP_FEATURES } from "@constants/mail.ts";
import { databaseCreateWithRetry } from "@utils/database/collision-create.ts";

/**
 * Payload shape rendered into the "sign-up" email template. The email sender
 * accepts this as `JSON` (the global namespace type), so it is JSON-serializable.
 */
interface SignUpEmailData {
  fullName: string;
  inviteeName: string;
  email: string;
  environmentName: string;
  registerURL: string;
  features: typeof EMAIL_SIGN_UP_FEATURES;
}

/** Service for creating environment config users. */
export class EnvironmentConfigUserCreateService {
  private helperService = new EnvironmentConfigUserCrudHelpers();
  private permissionAssignmentService = new PermissionAssignmentService();

  /**
   * Create a new user with identity and permissions
   */
  async createUser(
    creatorId: string,
    creatorFullName: string,
    isAdmin: boolean,
    environmentId: string,
    data: IEnvironmentConfigUserCreateRequest,
  ) {
    return await tracedWithServiceErrorHandling(
      "EnvironmentConfigUserCreateService.createUser",
      {
        service: "EnvironmentConfigUserCreateService",
        method: "createUser",
        section: loggerAppSections.ENV_CONFIG_USER,
        details: { creatorId, environmentId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["creator_id"] = creatorId;
        span.attributes["environment_id"] = environmentId;

        const creatorHasPermission = await hasPermission(isAdmin, creatorId, "users.create");
        if (!creatorHasPermission) {
          throwHttpError("USER_API_KEY.NO_PERMISSION");
        }

        await this.helperService.validatePermissionAssignment(
          creatorId,
          data.permissionGroupId,
          data.permissions,
        );

        const globalDb = getGlobalDB();
        const tenantDb = await getTenantDB(environmentId);

        const [quotas] = await globalDb
          .select({
            maxUsers: globalTables.environmentQuotas.maxUsers,
          })
          .from(globalTables.environmentQuotas)
          .where(eq(globalTables.environmentQuotas.id, environmentId))
          .limit(1);

        if (quotas?.maxUsers && quotas.maxUsers > 0) {
          const [{ count }] = await globalDb
            .select({ count: sql<number>`count(*)` })
            .from(globalTables.users)
            .where(
              and(
                eq(globalTables.users.environmentId, environmentId),
                eq(globalTables.users.isActive, true),
              ),
            );

          if (count >= quotas.maxUsers) {
            throwHttpError("ENVIRONMENT.QUOTA_EXCEEDED_USERS");
          }
        }

        const [userId] = await globalDb.transaction(async (gtx) => {
          let existingUser: (typeof globalTables.users)["$inferSelect"][] = [];

          if (data.email) {
            existingUser = await gtx
              .select()
              .from(globalTables.users)
              .where(eq(globalTables.users.email, data.email))
              .limit(1);
          } else if (data.username) {
            const canonicalUsername = canonicalizeUsername(data.username);
            if (isReservedUsername(canonicalUsername)) {
              throwHttpError("USER.RESERVED_USERNAME");
            }
            existingUser = await gtx
              .select()
              .from(globalTables.users)
              .where(eq(globalTables.users.username, canonicalUsername))
              .limit(1);
          }

          if (existingUser.length > 0) {
            throwHttpError("USER.ALREADY_EXISTS");
          }

          const hashedPassword = data.password ? await AuthPasswordService.generatePassword(data.password) : null;

          const newUserId = await databaseCreateWithRetry(async (newId) => {
            await gtx.insert(globalTables.users).values({
              id: newId,
              email: data.email!,
              username: data.username ? canonicalizeUsername(data.username) : null,
              password: hashedPassword,
              firstName: data.firstName,
              lastName: data.lastName,
              environmentId: environmentId,
              isActive: data.isActive ?? true,
            });
            return newId;
          }, generateIdForUser);

          // Create tenant-specific records
          await tenantDb.transaction(async (ttx) => {
            await ttx.insert(tenantTables.userProfiles).values({
              userId: newUserId,
              username: data.username ? canonicalizeUsername(data.username) : "",
              email: data.email || "",
              firstName: data.firstName,
              lastName: data.lastName,
              isAdmin: data.isAdmin ?? false,
              language: data.language || "en",
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
            });

            await ttx.insert(tenantTables.userEncryption).values({
              userId: newUserId,
              createdAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
            });

            if (data.permissionGroupId || data.permissions) {
              await this.permissionAssignmentService.assignPermissions(
                newUserId,
                data.permissionGroupId,
                data.permissions,
                "replace",
              );
            }
          });

          return [newUserId];
        });

        await this.helperService.clearUserPermissionCache(userId);

        const passwordResetService = getPasswordResetService();
        const { token } = await passwordResetService.generatePasswordResetToken(userId);

        const registerUrl = `https://${envConfig.public.frontURL}/auth/register/${encodeURIComponent(token)}`;

        fireAndForgetOperation("send-sign-up-email", async () => {
          if (!data.email) return;
          const [env] = await globalDb.select().from(globalTables.environments).where(eq(globalTables.environments.id, environmentId))
            .limit(1);
          const emailSenderService = getEmailSenderService();
          const signUpData: SignUpEmailData = {
            fullName: data.firstName + " " + data.lastName,
            inviteeName: creatorFullName,
            email: data.email.toLowerCase().trim(),
            environmentName: env.name,
            registerURL: registerUrl,
            features: EMAIL_SIGN_UP_FEATURES,
          };
          // `useSendEmail` types its payload as the global `JSON` namespace; a
          // precise cast is unavoidable at this boundary until that signature is fixed.
          await emailSenderService.useSendEmail(
            userId,
            data.email.toLowerCase().trim(),
            signUpData as unknown as JSON,
            "sign-up",
            data.language ?? "en",
          );
        });

        return {
          ...await getEnvironmentConfigUserReadService().getUserById(userId, environmentId),
          registerUrl: data.email ? null : registerUrl,
        };
      },
    );
  }
}
