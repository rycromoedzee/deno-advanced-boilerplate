/**
 * @file services/auth/user-lookup.service.ts
 * @description User Lookup service (auth)
 */
import { getCustomDomain } from "@utils/network/index.ts";
import { getUserLookupService } from "@services/user/index.ts";
import type { IUserLookupResult, IUserWithEnvironment } from "@services/user/index.ts";
import { IAuthFlowContext, IAuthFlowContextInternal } from "@interfaces/auth.ts";
import { AuthFlowType } from "@interfaces/auth.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import type { Span } from "@interfaces/tracing.ts";

export class AuthUserLookupService {
  private userLookupService = getUserLookupService();

  private mapLookupResultUsers(
    users: IUserLookupResult["users"],
  ): IUserWithEnvironment[] {
    return users.map((user) => ({
      id: user.userId,
      firstName: user.firstName,
      lastName: user.lastName,
      isAdmin: true, // Default for mapped lookup results; actual value resolved at session creation via findUserById
      environmentId: user.environmentId,
      environmentName: user.environmentName,
      customDomain: null,
      isTwoFactorEnabled: user.isTwoFactorEnabled,
      isActive: true,
    }));
  }
  /**
   * Determine authentication flow based on 2FA status
   * @param users Array of users found for the identity (should be single user in single-user model)
   * @returns Authentication flow context with flow type and user information
   * @throws AppHttpException with 401 status if no users are found (invalid credentials)
   */
  public determineAuthFlow(
    users: IUserWithEnvironment[],
  ): IAuthFlowContext {
    if (users.length === 0) {
      // No users found - return invalid credentials (don't reveal if user exists)
      throwHttpError("AUTH.INVALID_CREDENTIALS");
    }

    // In single-user model, always use first user (should be exactly 1 per email in single-tenant model)
    const user = users[0];
    if (user.isTwoFactorEnabled) {
      return {
        flowType: AuthFlowType.TWO_FA_SINGLE,
        users: [user],
        requiresSelection: false,
        requires2FA: true,
      };
    } else {
      return {
        flowType: AuthFlowType.DIRECT_LOGIN,
        users: [user],
        requiresSelection: false,
        requires2FA: false,
      };
    }
  }

  /**
   * Main lookup function that combines subdomain detection and user lookup
   * @param honoContextUrl Hono context URL
   * @param email User email address to lookup
   * @returns Authentication flow context with user information, flow type, password, and identityId
   * @throws AppHttpException with 401 status if environment not found, no users found, or password is null
   * @throws AppHttpException with 500 status if unexpected error occurs
   */
  public lookupUsersForAuthentication(
    honoContextUrl: string,
    email: string,
  ): Promise<IAuthFlowContextInternal> {
    return tracedWithServiceErrorHandling(
      "AuthUserLookupService.lookupUsersForAuthentication",
      {
        service: "AuthUserLookupService",
        method: "lookupUsersForAuthentication",
        section: loggerAppSections.AUTH,
        details: { email },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const traceService = getTraceContext();

        traceService.addBreadcrumb("auth", "Looking up identity", "info", {
          email,
          honoContextUrl,
        });

        const { isSubdomain, isCustomDomain, domain } = getCustomDomain(
          honoContextUrl,
        );

        traceService.addBreadcrumb("auth", "Domain detection result", "info", {
          isSubdomain,
          isCustomDomain,
          domain,
          originalUrl: honoContextUrl,
        });

        let lookupResult: IUserLookupResult | null;

        if (isSubdomain || isCustomDomain) {
          traceService.addBreadcrumb("auth", "Looking up users by domain", "info", {
            domain,
            isCustomDomain,
            isSubdomain,
          });

          lookupResult = await this.userLookupService.findUserByEmailAndDomain(
            email,
            domain,
            isSubdomain,
            isCustomDomain,
          );

          traceService.addBreadcrumb("auth", "Domain user lookup result", "info", {
            found: !!lookupResult,
            userCount: lookupResult?.users.length ?? 0,
          });
        } else {
          traceService.addBreadcrumb("auth", "Looking up users across environments", "info", {
            email,
          });

          lookupResult = await this.userLookupService.findUserByEmail(email);
          traceService.addBreadcrumb("auth", "Global user lookup result", "info", {
            found: !!lookupResult,
            userCount: lookupResult?.users.length ?? 0,
          });
        }

        if (!lookupResult?.password) {
          traceService.addBreadcrumb("auth", "No identity found or password null", "error", {
            email,
          });
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        const users = this.mapLookupResultUsers(
          lookupResult.users,
        );
        const flowContext = this.determineAuthFlow(users);

        traceService.addBreadcrumb("auth", "Auth flow determined", "info", {
          flowType: flowContext.flowType,
          userCount: flowContext.users.length,
          requires2FA: flowContext.requires2FA,
          requiresSelection: flowContext.requiresSelection,
        });

        // Set span attributes for tracing
        span.attributes["user_count"] = users.length;
        span.attributes["flow_type"] = flowContext.flowType;
        span.attributes["requires_2fa"] = flowContext.requires2FA;
        span.attributes["domain_type"] = isSubdomain ? "subdomain" : (isCustomDomain ? "custom" : "none");

        // Return extended context with password
        return {
          ...flowContext,
          password: lookupResult.password,
        };
      },
    );
  }
}
