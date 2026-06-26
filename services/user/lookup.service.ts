/**
 * @file services/user/lookup.service.ts
 * @description Lookup service (user)
 */
import { and, eq, inArray, isNotNull, type SQL } from "@deps";
import { traced } from "@services/tracing/index.ts";
import type { IUserLookupResult, IUserTwoFactor, IUserWithEnvironment } from "@interfaces/user.ts";
import { canonicalizeUsername } from "@utils/auth/index.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

export class UserLookupService {
  private async getTenantAdminMap(environmentId: string, userIds: string[]): Promise<Map<string, boolean>> {
    if (userIds.length === 0) {
      return new Map();
    }

    const tenantDb = await getTenantDB(environmentId);
    const profiles = await tenantDb
      .select({
        userId: tenantTables.userProfiles.userId,
        isAdmin: tenantTables.userProfiles.isAdmin,
      })
      .from(tenantTables.userProfiles)
      .where(inArray(tenantTables.userProfiles.userId, userIds));

    return new Map(profiles.map((profile) => [profile.userId, profile.isAdmin ?? false]));
  }

  private async attachTenantAdmin(
    users: Array<Omit<IUserWithEnvironment, "isAdmin">>,
  ): Promise<IUserWithEnvironment[]> {
    if (users.length === 0) {
      return [];
    }

    const usersByEnvironment = new Map<string, string[]>();
    for (const user of users) {
      const ids = usersByEnvironment.get(user.environmentId) ?? [];
      ids.push(user.id);
      usersByEnvironment.set(user.environmentId, ids);
    }

    const adminMaps = new Map<string, Map<string, boolean>>();
    for (const [environmentId, userIds] of usersByEnvironment.entries()) {
      adminMaps.set(environmentId, await this.getTenantAdminMap(environmentId, userIds));
    }

    return users.map((user) => ({
      ...user,
      isAdmin: adminMaps.get(user.environmentId)?.get(user.id) ?? false,
    }));
  }

  /**
   * Find user by email address with optional additional filters
   * @param email User's email address
   * @param extraWhereParams Additional where clause parameters for filtering
   * @returns User lookup result containing identity and associated users, or null if not found
   */
  async findUserByEmail(
    email: string,
    extraWhereParams: SQL[] = [],
  ): Promise<IUserLookupResult | null> {
    const db = getGlobalDB();
    const result = await db.select({
      userId: globalTables.users.id,
      password: globalTables.users.password,
      isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
      environmentId: globalTables.environments.id,
      environmentName: globalTables.environments.name,
      environmentCustomSubdomain: globalTables.environments.customSubdomain,
      environmentCustomDomain: globalTables.environments.customDomain,
      firstName: globalTables.users.firstName,
      lastName: globalTables.users.lastName,
    })
      .from(globalTables.users)
      .innerJoin(
        globalTables.environments,
        eq(globalTables.users.environmentId, globalTables.environments.id),
      )
      .where(
        and(
          eq(globalTables.users.email, email),
          isNotNull(globalTables.users.password),
          eq(globalTables.environments.status, "active"),
          eq(globalTables.users.isActive, true),
          ...extraWhereParams,
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];

    return {
      userId: row.userId,
      password: row.password,
      users: [{
        userId: row.userId,
        isTwoFactorEnabled: row.isTwoFactorEnabled,
        environmentId: row.environmentId,
        environmentName: row.environmentName,
        environmentHasSubDomain: !!row.environmentCustomSubdomain,
        environmentHasCustomDomain: !!row.environmentCustomDomain,
        firstName: row.firstName,
        lastName: row.lastName,
      }],
    };
  }

  /**
   * Find user by username with optional additional filters
   * Used for passkey-based authentication where username is the primary identifier
   * @param username User's username
   * @param extraWhereParams Additional where clause parameters for filtering
   * @returns User lookup result containing identity and associated users, or null if not found
   */
  async findUserByUsername(
    username: string,
    extraWhereParams: SQL[] = [],
  ): Promise<IUserLookupResult | null> {
    const canonicalUsername = canonicalizeUsername(username);
    const db = getGlobalDB();
    const result = await db.select({
      userId: globalTables.users.id,
      password: globalTables.users.password,
      isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
      environmentId: globalTables.environments.id,
      environmentName: globalTables.environments.name,
      environmentCustomSubdomain: globalTables.environments.customSubdomain,
      environmentCustomDomain: globalTables.environments.customDomain,
      firstName: globalTables.users.firstName,
      lastName: globalTables.users.lastName,
    })
      .from(globalTables.users)
      .innerJoin(
        globalTables.environments,
        eq(globalTables.users.environmentId, globalTables.environments.id),
      )
      .where(
        and(
          eq(globalTables.users.username, canonicalUsername),
          eq(globalTables.environments.status, "active"),
          eq(globalTables.users.isActive, true),
          ...extraWhereParams,
        ),
      )
      .limit(1);

    if (result.length === 0) {
      return null;
    }

    const row = result[0];

    return {
      userId: row.userId,
      password: row.password,
      users: [{
        userId: row.userId,
        isTwoFactorEnabled: row.isTwoFactorEnabled,
        environmentId: row.environmentId,
        environmentName: row.environmentName,
        environmentHasSubDomain: !!row.environmentCustomSubdomain,
        environmentHasCustomDomain: !!row.environmentCustomDomain,
        firstName: row.firstName,
        lastName: row.lastName,
      }],
    };
  }

  /**
   * Find user by email and domain (subdomain or custom domain)
   * @param email User's email address
   * @param domain Domain name to filter by
   * @param isSubdomain Whether the domain is a subdomain
   * @param isCustomDomain Whether the domain is a custom domain
   * @returns User lookup result for the specific domain, or null if not found
   */
  async findUserByEmailAndDomain(
    email: string,
    domain: string,
    isSubdomain: boolean,
    isCustomDomain: boolean,
  ): Promise<IUserLookupResult | null> {
    if (isCustomDomain) {
      return await this.findUserByEmail(email, [
        eq(globalTables.environments.customDomain, domain),
      ]);
    }

    if (isSubdomain) {
      return await this.findUserByEmail(email, [
        eq(globalTables.environments.customSubdomain, domain),
      ]);
    }

    return null;
  }

  /**
   * Find user by identity ID for two-factor authentication verification
   * @param identityId Identity ID to search for
   * @param extraWhereParams Additional where clause parameters for filtering
   * @returns Array of users with 2FA information, or null if not found
   */
  async findUserByIdentityIdForTwoFactorVerification(
    identityId: string,
    extraWhereParams: SQL[] = [],
  ): Promise<IUserTwoFactor[] | null> {
    const globalDb = getGlobalDB();
    const userResult = await globalDb.select({
      userId: globalTables.users.id,
      environmentId: globalTables.users.environmentId,
      environmentName: globalTables.environments.name,
      isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
      firstName: globalTables.users.firstName,
      lastName: globalTables.users.lastName,
    })
      .from(globalTables.users)
      .innerJoin(
        globalTables.environments,
        eq(globalTables.users.environmentId, globalTables.environments.id),
      )
      .where(and(
        eq(globalTables.users.id, identityId),
        eq(globalTables.users.isActive, true),
        eq(globalTables.environments.status, "active"),
        ...extraWhereParams,
      ))
      .limit(1);

    if (userResult.length === 0) {
      return null;
    }

    const user = userResult[0];

    // Now look up 2FA secret in Tenant DB
    const tenantDb = await getTenantDB(user.environmentId);
    const mfaSecrets = await tenantDb.select({
      id: tenantTables.userTwoFactorSecrets.id,
      encryptedSecret: tenantTables.userTwoFactorSecrets.encryptedSecret,
    })
      .from(tenantTables.userTwoFactorSecrets)
      .where(and(
        eq(tenantTables.userTwoFactorSecrets.userId, user.userId),
        eq(tenantTables.userTwoFactorSecrets.isActive, true),
      ));

    return mfaSecrets.map((secret) => ({
      userId: user.userId,
      environmentId: user.environmentId,
      environmentName: user.environmentName,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      twoFactorSecret: secret.encryptedSecret as Uint8Array,
      twoFactorSecretId: secret.id,
      firstName: user.firstName,
      lastName: user.lastName,
    }));
  }

  /**
   * Find user by identity ID for 2FA verification with domain filtering
   * @param identityId Identity ID to search for
   * @param domain Domain name to filter by
   * @param isSubdomain Whether the domain is a subdomain
   * @param isCustomDomain Whether the domain is a custom domain
   * @returns Array of users with 2FA information for the domain, or null if not found
   */
  async findUserByIdentityIdForTwoFactorVerificationWithDomain(
    identityId: string,
    domain: string,
    isSubdomain: boolean,
    isCustomDomain: boolean,
  ): Promise<IUserTwoFactor[] | null> {
    if (isCustomDomain) {
      return await this.findUserByIdentityIdForTwoFactorVerification(
        identityId,
        [
          eq(globalTables.environments.customDomain, domain),
        ],
      );
    }

    if (isSubdomain) {
      return await this.findUserByIdentityIdForTwoFactorVerification(
        identityId,
        [
          eq(globalTables.environments.customSubdomain, domain),
        ],
      );
    }

    return null;
  }

  /**
   * Find users by email identity in a specific environment
   * @param email User's email address
   * @param environmentId Environment ID to filter by
   * @returns Array of users with environment information in the specified environment
   */
  async findUsersByIdentityInEnvironment(
    email: string,
    environmentId: string,
  ): Promise<IUserWithEnvironment[]> {
    const db = getGlobalDB();
    const result = await db
      .select({
        id: globalTables.users.id,
        firstName: globalTables.users.firstName,
        lastName: globalTables.users.lastName,
        environmentId: globalTables.users.environmentId,
        environmentName: globalTables.environments.name,
        customDomain: globalTables.environments.customDomain,
        isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
        isActive: globalTables.users.isActive,
      })
      .from(globalTables.users)
      .innerJoin(globalTables.environments, eq(globalTables.users.environmentId, globalTables.environments.id))
      .where(
        and(
          eq(globalTables.users.email, email),
          eq(globalTables.users.environmentId, environmentId),
          eq(globalTables.users.isActive, true),
          eq(globalTables.environments.status, "active"),
        ),
      );

    return await this.attachTenantAdmin(result as Array<Omit<IUserWithEnvironment, "isAdmin">>);
  }

  /**
   * Find all users by email identity across all environments
   * @param email User's email address
   * @returns Array of users with environment information across all environments
   */
  async findUsersByIdentity(email: string): Promise<IUserWithEnvironment[]> {
    const db = getGlobalDB();
    const result = await db
      .select({
        id: globalTables.users.id,
        firstName: globalTables.users.firstName,
        lastName: globalTables.users.lastName,
        environmentId: globalTables.users.environmentId,
        environmentName: globalTables.environments.name,
        customDomain: globalTables.environments.customDomain,
        isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
        isActive: globalTables.users.isActive,
      })
      .from(globalTables.users)
      .innerJoin(globalTables.environments, eq(globalTables.users.environmentId, globalTables.environments.id))
      .where(
        and(
          eq(globalTables.users.email, email),
          eq(globalTables.users.isActive, true),
          eq(globalTables.environments.status, "active"),
        ),
      );

    return await this.attachTenantAdmin(result as Array<Omit<IUserWithEnvironment, "isAdmin">>);
  }

  /**
   * Find user by ID (for token validation scenarios)
   * @param userId User ID to search for
   * @returns User with environment information, or null if not found
   */
  async findUserById(userId: string): Promise<IUserWithEnvironment | null> {
    return await traced("UserLookupService.findUserById", "db.query", async (span) => {
      span.attributes["user_id"] = userId;

      const db = getGlobalDB();
      try {
        const result = await db
          .select({
            id: globalTables.users.id,
            firstName: globalTables.users.firstName,
            lastName: globalTables.users.lastName,
            environmentId: globalTables.users.environmentId,
            environmentName: globalTables.environments.name,
            customDomain: globalTables.environments.customDomain,
            isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
            isActive: globalTables.users.isActive,
          })
          .from(globalTables.users)
          .innerJoin(globalTables.environments, eq(globalTables.users.environmentId, globalTables.environments.id))
          .where(
            and(
              eq(globalTables.users.id, userId),
              eq(globalTables.users.isActive, true),
              eq(globalTables.environments.status, "active"),
            ),
          )
          .limit(1);

        const baseUser = result[0] || null;
        const user = baseUser ? (await this.attachTenantAdmin([baseUser as Omit<IUserWithEnvironment, "isAdmin">]))[0] ?? null : null;
        span.attributes["found"] = !!user;
        if (user) {
          span.attributes["environment_id"] = user.environmentId;
        }

        return user as IUserWithEnvironment;
      } catch (err) {
        span.attributes["error"] = true;
        span.attributes["error_message"] = err instanceof Error ? err.message : String(err);

        throw err;
      }
    });
  }

  /**
   * Find multiple users by IDs (for multi-user token validation)
   * @param userIds Array of user IDs to search for
   * @returns Array of users with environment information
   */
  async findUsersByIds(userIds: string[]): Promise<IUserWithEnvironment[]> {
    if (userIds.length === 0) return [];

    const db = getGlobalDB();
    const result = await db
      .select({
        id: globalTables.users.id,
        firstName: globalTables.users.firstName,
        lastName: globalTables.users.lastName,
        environmentId: globalTables.users.environmentId,
        environmentName: globalTables.environments.name,
        customDomain: globalTables.environments.customDomain,
        isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
        isActive: globalTables.users.isActive,
      })
      .from(globalTables.users)
      .innerJoin(globalTables.environments, eq(globalTables.users.environmentId, globalTables.environments.id))
      .where(
        and(
          inArray(globalTables.users.id, userIds),
          eq(globalTables.users.isActive, true),
          eq(globalTables.environments.status, "active"),
        ),
      );

    return await this.attachTenantAdmin(result as Array<Omit<IUserWithEnvironment, "isAdmin">>);
  }
}
