/**
 * @file services/user/passkey-management.service.ts
 * @description Passkey Management service (user)
 */
import { and, eq, inArray } from "@deps";
import type { AuthenticationResponseJSON, AuthenticatorTransportFuture, RegistrationResponseJSON } from "@deps";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { AuthPasskeyRegistrationService } from "@services/auth/passkey-auth.service.ts";
import { AuthPasswordService } from "@services/auth/password-auth.service.ts";
import { getUserMasterKeySetupService } from "@services/auth/singletons.ts";
import { PasskeyPRFService, PerCredentialPRFService } from "@services/encryption/index.ts";
import { SecureReauthTokenService } from "@services/auth/passkey-reauth-token.service.ts";
import { StrictPasskeyVerifier } from "@services/auth/passkey-strict-verifier.service.ts";
import { ChallengeCleanupService } from "@services/auth/passkey-challenge-cleanup.service.ts";
import { AuthServiceCacheKeys, canonicalizeUsername, isReservedUsername, isValidUsernameFormat } from "@utils/auth/index.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import type { IAuthWebAuthnCredential } from "@interfaces/auth.ts";
import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";

export type PasskeyListItem = {
  id: string;
  displayName: string | null;
  createdAt: number;
  backedUp: boolean;
  transports: AuthenticatorTransportFuture[] | null;
  hasPrf: boolean;
};

export type PasskeyBeginResult = {
  attemptId: string;
  creationOptions: Record<string, unknown>;
  requiresReauth: boolean;
  reauthType?: "password" | "passkey" | "password_or_passkey";
  requireUserVerification?: boolean;
  message?: string;
};

export class PasskeyManagementService {
  private masterKeySetupService = getUserMasterKeySetupService();

  async listPasskeys(userId: string): Promise<PasskeyListItem[]> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.listPasskeys",
      {
        service: "PasskeyManagementService",
        method: "listPasskeys",
        section: loggerAppSections.PASSKEYS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const db = getGlobalDB();
        const rows = await db
          .select({
            id: globalTables.userPasskeys.id,
            displayName: globalTables.userPasskeys.displayName,
            createdAt: globalTables.userPasskeys.createdAt,
            backedUp: globalTables.userPasskeys.backedUp,
            transports: globalTables.userPasskeys.transports,
          })
          .from(globalTables.userPasskeys)
          .where(eq(globalTables.userPasskeys.userId, userId));

        if (rows.length === 0) return [];

        const credentialIds = rows.map((r) => r.id);
        const prfRows = await db
          .select({ credentialId: globalTables.passkeyPRFKeys.credentialId })
          .from(globalTables.passkeyPRFKeys)
          .where(inArray(globalTables.passkeyPRFKeys.credentialId, credentialIds));

        const prfCredentialIds = new Set(prfRows.map((r) => r.credentialId));

        return rows.map((row) => ({
          id: row.id,
          displayName: row.displayName ?? null,
          createdAt: row.createdAt ?? Math.floor(Date.now() / 1000),
          backedUp: row.backedUp,
          transports: row.transports as AuthenticatorTransportFuture[] | null,
          hasPrf: prfCredentialIds.has(row.id),
        }));
      },
    );
  }

  private async getUserData(userId: string) {
    const globalDb = getGlobalDB();
    const [user] = await globalDb.select({
      id: globalTables.users.id,
      email: globalTables.users.email,
      username: globalTables.users.username,
      firstName: globalTables.users.firstName,
      lastName: globalTables.users.lastName,
      password: globalTables.users.password,
      environmentId: globalTables.users.environmentId,
    })
      .from(globalTables.users)
      .where(eq(globalTables.users.id, userId))
      .limit(1);

    if (!user) {
      throwHttpError("USER.NOT_FOUND");
    }

    const tenantDb = await getTenantDB(user.environmentId);
    const [encryption] = await tenantDb.select({
      isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
      encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
      encryptedMasterKeyByRecoveryPhrase: tenantTables.userEncryption.encryptedMasterKeyByRecoveryPhrase,
    })
      .from(tenantTables.userEncryption)
      .where(eq(tenantTables.userEncryption.userId, userId))
      .limit(1);

    // Check for PRF enabled (global)
    const prfCheck = await globalDb.select({ id: globalTables.passkeyPRFKeys.credentialId })
      .from(globalTables.passkeyPRFKeys)
      .innerJoin(globalTables.userPasskeys, eq(globalTables.userPasskeys.id, globalTables.passkeyPRFKeys.credentialId))
      .where(eq(globalTables.userPasskeys.userId, userId))
      .limit(1);

    return {
      ...user,
      isEnhancedEncryptionEnabled: encryption?.isEnhancedEncryptionEnabled ?? false,
      encryptedMasterKeyByPassword: encryption?.encryptedMasterKeyByPassword ?? null,
      encryptedMasterKeyByRecoveryPhrase: encryption?.encryptedMasterKeyByRecoveryPhrase ?? null,
      prfEnabled: prfCheck.length > 0,
    };
  }

  async beginAddPasskey(
    userId: string,
    hostname: string,
    options?: { displayName?: string; username?: string },
  ): Promise<PasskeyBeginResult> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.beginAddPasskey",
      {
        service: "PasskeyManagementService",
        method: "beginAddPasskey",
        section: loggerAppSections.PASSKEYS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const userData = await this.getUserData(userId);
        const passkeys = await this.listPasskeys(userId);
        const hasPasskeys = passkeys.length > 0;
        const hasPassword = !!userData.password;
        const hasEnhancedEncryption = userData.isEnhancedEncryptionEnabled;
        const prfEnabled = userData.prfEnabled;
        const hasMasterKey = !!userData.encryptedMasterKeyByPassword ||
          !!userData.encryptedMasterKeyByRecoveryPhrase ||
          prfEnabled;

        span.attributes["has_passkeys"] = hasPasskeys;
        span.attributes["has_password"] = hasPassword;
        span.attributes["has_enhanced_encryption"] = hasEnhancedEncryption;
        span.attributes["prf_enabled"] = prfEnabled;

        if (hasPasskeys && !prfEnabled) {
          throwHttpError("ENCRYPTION.PRF_SETUP_REQUIRED");
        }

        if (!hasPasskeys && hasEnhancedEncryption && !hasPassword) {
          throwHttpError("PASSKEY.CANNOT_ADD_WITHOUT_PASSWORD_OR_RECOVERY");
        }

        let requiresReauth = false;
        let reauthType: PasskeyBeginResult["reauthType"];
        let requireUserVerification: boolean | undefined;
        let message: string | undefined;

        if (hasMasterKey) {
          requiresReauth = true;
          if (hasPassword && hasPasskeys) {
            reauthType = "password_or_passkey";
            message = "Authentication required to add passkey with encryption";
          } else if (hasPassword && !hasPasskeys) {
            reauthType = "password";
            message = "Password required to add passkey with encryption";
          } else {
            reauthType = "passkey";
            requireUserVerification = true;
            message = "Passkey verification required to add new passkey with encryption";
          }
        }

        const sanitizedDisplayName = this.sanitizeDisplayName(options?.displayName ?? null);

        // The account username (login identifier) may only be set/established
        // when adding the FIRST passkey, since it is bound into the WebAuthn
        // credential. Validate it up front so we fail before the (potentially
        // biometric) ceremony, but persist it only on verify.
        let resolvedUsername = userData.username;
        if (options?.username) {
          resolvedUsername = await this.assertUsernameAvailable(
            userId,
            options.username,
            userData.username,
            hasPasskeys,
          );
        }

        const userName = resolvedUsername || userId;
        const displayName = sanitizedDisplayName || `${userData.firstName} ${userData.lastName}`.trim() || userName;

        const registrationResult = hasMasterKey
          ? await AuthPasskeyRegistrationService.buildRegistrationConfigWithPRF({
            urlHostName: hostname,
            userName,
            displayName,
          })
          : await AuthPasskeyRegistrationService.buildRegistrationConfig({
            urlHostName: hostname,
            userName,
            displayName,
          });

        return {
          attemptId: registrationResult.attemptId,
          creationOptions: registrationResult.creationOptions as unknown as Record<string, unknown>,
          requiresReauth,
          reauthType,
          requireUserVerification,
          message,
        };
      },
    );
  }

  async verifyAddPasskey(params: {
    userId: string;
    attemptId: string;
    credential: RegistrationResponseJSON;
    hostname: string;
    url: string;
    displayName?: string | null;
    username?: string;
    prfOutput?: { first?: string };
    reauthToken?: string | null;
    sessionId: string;
    ipAddress: string;
  }): Promise<{
    success: true;
    credentialId: string;
    prfSetupRequired?: boolean;
    prfSetup?: {
      attemptId: string;
      requestOptions: Record<string, unknown>;
      prfEvaluationRequest?: { salt?: string; saltsByCredential?: Record<string, string> };
      reauthToken: string;
      reauthTokenExpiresAt: number;
    };
  }> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.verifyAddPasskey",
      {
        service: "PasskeyManagementService",
        method: "verifyAddPasskey",
        section: loggerAppSections.PASSKEYS,
        details: { userId: params.userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (_span) => {
        const userData = await this.getUserData(params.userId);
        const _hasEnhancedEncryption = userData.isEnhancedEncryptionEnabled;
        const hasMasterKey = !!userData.encryptedMasterKeyByPassword ||
          !!userData.encryptedMasterKeyByRecoveryPhrase ||
          userData.prfEnabled;

        // Whether the user had passkeys BEFORE this credential is added — the
        // username may only be established alongside the first passkey.
        const existingPasskeys = await this.listPasskeys(params.userId);
        const hadPasskeys = existingPasskeys.length > 0;

        const { credential: verifiedCredential } = await AuthPasskeyRegistrationService.register({
          passkeyRegistrationBody: params.credential,
          attemptId: params.attemptId,
          urlHostName: params.hostname,
          url: params.url,
        });

        // Validate the username up front (before consuming the reauth token or
        // inserting the credential) so we fail cleanly on a bad/taken username.
        let canonicalUsername: string | undefined;
        if (params.username) {
          canonicalUsername = await this.assertUsernameAvailable(
            params.userId,
            params.username,
            userData.username,
            hadPasskeys,
          );
        }

        const cleanDisplayName = this.sanitizeDisplayName(params.displayName ?? null);
        const globalDb = getGlobalDB();

        if (hasMasterKey) {
          if (!params.reauthToken) {
            throwHttpError("AUTH.UNAUTHORIZED");
          }

          const masterKey = await SecureReauthTokenService.consumeToken({
            token: params.reauthToken,
            userId: params.userId,
            sessionId: params.sessionId,
            purpose: "passkey_add",
            ipAddress: params.ipAddress,
          });

          try {
            await globalDb.insert(globalTables.userPasskeys).values({
              userId: params.userId,
              id: verifiedCredential.id,
              publicKey: verifiedCredential.publicKey,
              counter: verifiedCredential.counter,
              backedUp: verifiedCredential.backedUp,
              transports: verifiedCredential.transports || [],
              displayName: cleanDisplayName,
              createdAt: Math.floor(Date.now() / 1000),
            });

            if (canonicalUsername) {
              await this.setUsername(params.userId, canonicalUsername);
            }

            const prfSetup = await this.beginPasskeyPrfSetup({
              userId: params.userId,
              credentialId: verifiedCredential.id,
              hostname: params.hostname,
            });

            const prfSetupToken = await SecureReauthTokenService.generateToken({
              userId: params.userId,
              sessionId: params.sessionId,
              purpose: "passkey_add",
              masterKey,
              ipAddress: params.ipAddress,
            });

            return {
              success: true,
              credentialId: verifiedCredential.id,
              prfSetupRequired: true,
              prfSetup: {
                attemptId: prfSetup.attemptId,
                requestOptions: prfSetup.requestOptions as Record<string, unknown>,
                prfEvaluationRequest: prfSetup.prfEvaluationRequest,
                reauthToken: prfSetupToken.token,
                reauthTokenExpiresAt: prfSetupToken.expiresAt,
              },
            };
          } finally {
            masterKey.fill(0);
          }
        } else {
          await globalDb.insert(globalTables.userPasskeys).values({
            userId: params.userId,
            id: verifiedCredential.id,
            publicKey: verifiedCredential.publicKey,
            counter: verifiedCredential.counter,
            backedUp: verifiedCredential.backedUp,
            transports: verifiedCredential.transports || [],
            displayName: cleanDisplayName,
            createdAt: Math.floor(Date.now() / 1000),
          });

          if (canonicalUsername) {
            await this.setUsername(params.userId, canonicalUsername);
          }
        }

        return { success: true, credentialId: verifiedCredential.id };
      },
    );
  }

  async beginPasskeyPrfSetup(params: {
    userId: string;
    credentialId: string;
    hostname: string;
  }): Promise<{
    attemptId: string;
    requestOptions: Record<string, unknown>;
    prfEvaluationRequest?: { salt?: string; saltsByCredential?: Record<string, string> };
  }> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.beginPasskeyPrfSetup",
      {
        service: "PasskeyManagementService",
        method: "beginPasskeyPrfSetup",
        section: loggerAppSections.PASSKEYS,
        details: { userId: params.userId, credentialId: params.credentialId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const globalDb = getGlobalDB();
        const [credential] = await globalDb.select()
          .from(globalTables.userPasskeys)
          .where(and(
            eq(globalTables.userPasskeys.id, params.credentialId),
            eq(globalTables.userPasskeys.userId, params.userId),
          ))
          .limit(1);

        if (!credential) {
          throwHttpError("PASSKEY.NOT_FOUND");
        }

        const prfSalt = PasskeyPRFService.generatePRFSalt();
        const strictResult = await StrictPasskeyVerifier.buildStrictAuthConfigWithPRF(
          params.hostname,
          [{
            id: credential.id,
            transports: (credential.transports as AuthenticatorTransportFuture[]) ?? undefined,
          }],
          { [credential.id]: prfSalt },
        );

        await this.storePrfSetupAttempt(strictResult.attemptId, {
          userId: params.userId,
          credentialId: credential.id,
          createdAt: Date.now(),
        });

        return {
          attemptId: strictResult.attemptId,
          requestOptions: strictResult.requestOptions as unknown as Record<string, unknown>,
          prfEvaluationRequest: strictResult.prfEvaluationRequest,
        };
      },
    );
  }

  async verifyPasskeyPrfSetup(params: {
    userId: string;
    attemptId: string;
    credential: AuthenticationResponseJSON;
    url: string;
    prfOutput?: { first?: string };
    reauthToken: string;
    sessionId: string;
    ipAddress: string;
  }): Promise<{ success: true; credentialId: string }> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.verifyPasskeyPrfSetup",
      {
        service: "PasskeyManagementService",
        method: "verifyPasskeyPrfSetup",
        section: loggerAppSections.PASSKEYS,
        details: { userId: params.userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const attempt = await this.getPrfSetupAttempt(params.attemptId);
        if (!attempt || attempt.userId !== params.userId) {
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        if (attempt.credentialId !== params.credential.id) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        if (!params.prfOutput?.first) {
          throwHttpError("ENCRYPTION.PRF_NOT_CONFIGURED_FOR_CREDENTIAL");
        }

        const globalDb = getGlobalDB();
        const [credential] = await globalDb.select()
          .from(globalTables.userPasskeys)
          .where(and(
            eq(globalTables.userPasskeys.id, params.credential.id),
            eq(globalTables.userPasskeys.userId, params.userId),
          ))
          .limit(1);

        if (!credential) {
          throwHttpError("PASSKEY.NOT_FOUND");
        }

        const originUrl = new URL(params.url);

        const { authenticationInfo } = await StrictPasskeyVerifier.verifyStrictAuth(
          {
            id: credential.id,
            publicKey: credential.publicKey,
            counter: credential.counter,
            backedUp: credential.backedUp,
            transports: credential.transports ?? undefined,
          } as IAuthWebAuthnCredential,
          params.credential,
          params.attemptId,
          originUrl,
        );

        await this.updateCredentialCounter(
          credential.id,
          authenticationInfo.newCounter,
        );

        const prfSaltsByCredential = await this.getCachedPRFSaltsByCredential(
          params.attemptId,
        );
        const prfSalt = prfSaltsByCredential?.[credential.id];
        if (!prfSalt) {
          throwHttpError("ENCRYPTION.PRF_NOT_CONFIGURED_FOR_CREDENTIAL");
        }

        const masterKey = await SecureReauthTokenService.consumeToken({
          token: params.reauthToken,
          userId: params.userId,
          sessionId: params.sessionId,
          purpose: "passkey_add",
          ipAddress: params.ipAddress,
        });

        try {
          await PerCredentialPRFService.setupPRFForCredential(
            credential.id,
            masterKey,
            params.prfOutput.first,
            params.userId,
            prfSalt,
          );

          await ChallengeCleanupService.cleanupAttempt(params.attemptId);

          return { success: true, credentialId: credential.id };
        } finally {
          masterKey.fill(0);
        }
      },
    );
  }

  async deletePasskey(params: {
    userId: string;
    credentialId: string;
    sessionId: string;
    reauthToken: string;
    ipAddress: string;
  }): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.deletePasskey",
      {
        service: "PasskeyManagementService",
        method: "deletePasskey",
        section: loggerAppSections.PASSKEYS,
        details: { userId: params.userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async () => {
        const userData = await this.getUserData(params.userId);
        const passkeys = await this.listPasskeys(params.userId);
        const isLastPasskey = passkeys.length <= 1;

        if (isLastPasskey && !userData.password) {
          throwHttpError("PASSKEY.CANNOT_DELETE_LAST_NO_PASSWORD");
        }
        if (isLastPasskey && userData.isEnhancedEncryptionEnabled) {
          throwHttpError("PASSKEY.CANNOT_DELETE_LAST_WITH_ENCRYPTION");
        }

        await SecureReauthTokenService.consumeToken({
          token: params.reauthToken,
          userId: params.userId,
          sessionId: params.sessionId,
          purpose: "passkey_delete",
          ipAddress: params.ipAddress,
        });

        const globalDb = getGlobalDB();
        await globalDb.transaction(async (tx) => {
          await tx.delete(globalTables.passkeyPRFKeys).where(
            eq(globalTables.passkeyPRFKeys.credentialId, params.credentialId),
          );
          await tx.delete(globalTables.userPasskeys).where(
            and(
              eq(globalTables.userPasskeys.id, params.credentialId),
              eq(globalTables.userPasskeys.userId, params.userId),
            ),
          );
        });
      },
    );
  }

  private sanitizeDisplayName(value: string | null): string | null {
    if (!value) return null;
    return value.trim().substring(0, 100) || null;
  }

  /**
   * Validates a requested account username (format + reserved-list + DB
   * uniqueness) and enforces that it is only set when establishing identity
   * alongside the first passkey. Returns the canonical username to persist.
   *
   * Does NOT write to the DB — call {@link setUsername} after the credential
   * is stored so an abandoned ceremony never mutates the account.
   *
   * @throws USER.USERNAME_INVALID_FORMAT — fails the canonical format check
   * @throws USER.CANNOT_CHANGE_USERNAME_WITH_PASSKEY — passkeys already exist and the username differs
   * @throws USER.RESERVED_USERNAME — username is on the reserved blacklist
   * @throws USER.USERNAME_ALREADY_EXISTS — username is taken by another user
   */
  private async assertUsernameAvailable(
    userId: string,
    requestedUsername: string,
    currentUsername: string | null,
    hadPasskeys: boolean,
  ): Promise<string> {
    if (!isValidUsernameFormat(requestedUsername)) {
      throwHttpError("USER.USERNAME_INVALID_FORMAT");
    }

    const canonicalUsername = canonicalizeUsername(requestedUsername);

    // Setting the same username again is a harmless no-op (even with passkeys).
    if (currentUsername && canonicalizeUsername(currentUsername) === canonicalUsername) {
      return canonicalUsername;
    }

    // The username is bound into existing WebAuthn credentials, so it can only
    // be established when adding the first passkey — never changed afterwards.
    if (hadPasskeys) {
      throwHttpError("USER.CANNOT_CHANGE_USERNAME_WITH_PASSKEY");
    }

    if (isReservedUsername(canonicalUsername)) {
      throwHttpError("USER.RESERVED_USERNAME");
    }

    const db = getGlobalDB();
    const existing = await db
      .select({ id: globalTables.users.id })
      .from(globalTables.users)
      .where(eq(globalTables.users.username, canonicalUsername))
      .limit(1);

    if (existing.length > 0 && existing[0].id !== userId) {
      throwHttpError("USER.USERNAME_ALREADY_EXISTS");
    }

    return canonicalUsername;
  }

  /** Persists an already-validated canonical username for the user. */
  private async setUsername(userId: string, canonicalUsername: string): Promise<void> {
    const db = getGlobalDB();
    await db
      .update(globalTables.users)
      .set({ username: canonicalUsername })
      .where(eq(globalTables.users.id, userId));
  }

  private async updateCredentialCounter(
    credentialId: string,
    newCounter: number,
  ): Promise<void> {
    const db = getGlobalDB();
    await db
      .update(globalTables.userPasskeys)
      .set({ counter: newCounter })
      .where(eq(globalTables.userPasskeys.id, credentialId));
  }

  private async storePrfSetupAttempt(
    attemptId: string,
    data: {
      userId: string;
      credentialId: string;
      createdAt: number;
    },
  ): Promise<void> {
    const cache = await getCache();
    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(attemptId);
    await cache.set(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, attemptKey, data, { ttl: 120 });
  }

  private async getPrfSetupAttempt(attemptId: string): Promise<{ userId: string; credentialId: string } | null> {
    const cache = await getCache();
    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(attemptId);
    return await cache.get(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, attemptKey);
  }

  private async getCachedPRFSaltsByCredential(attemptId: string): Promise<Record<string, string> | null> {
    const cache = await getCache();
    const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
    return await cache.get(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, `${cacheKey}:prf_salt_by_credential`);
  }

  /**
   * Re-authenticate the user with their password and issue a single-use
   * reauth token wrapping the account master key (for passkey_add /
   * passkey_delete operations that require it).
   *
   * KNOWN LIMITATION: no brute-force rate limiting yet (TODO); the endpoint
   * requires a valid session, and the sibling passkey-reauth path is also
   * unthrottled.
   */
  async reauthWithPassword(params: {
    userId: string;
    password: string;
    sessionId: string;
    ipAddress: string;
    userAgent: string;
    purpose: "passkey_add" | "passkey_delete";
  }): Promise<{ token: string; expiresAt: number }> {
    return await tracedWithServiceErrorHandling(
      "PasskeyManagement.reauthWithPassword",
      {
        service: "PasskeyManagementService",
        method: "reauthWithPassword",
        section: loggerAppSections.PASSKEYS,
        details: { userId: params.userId, purpose: params.purpose },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const userData = await this.getUserData(params.userId);

        const storedHash = userData.password;
        if (!storedHash) {
          // Passkey-only account: there is no password to reauthenticate with.
          span.attributes["has_password"] = false;
          throwHttpError("ENCRYPTION.PASSWORD_REQUIRED");
        }
        span.attributes["has_password"] = true;

        // Timing protection is applied inside validatePassword (a sanctioned
        // auth method). needsRehash is intentionally ignored: this flow only
        // verifies identity and never rewrites the stored password hash.
        const { valid } = await AuthPasswordService.validatePassword(
          storedHash,
          params.password,
          params.userId,
        );
        span.attributes["password_valid"] = valid;

        if (!valid) {
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        // Recover the plaintext master key from the password. Returns null
        // when there is no password-wrapped master key (e.g. the key is held
        // via PRF/recovery only) or on any internal recovery failure.
        const masterKey = await this.masterKeySetupService
          .getExistingMasterKeyWithPassword(
            params.userId,
            params.password,
          );

        if (!masterKey) {
          span.attributes["master_key_recoverable"] = false;
          throwHttpError("ENCRYPTION.KEY_NOT_FOUND");
        }

        try {
          return await SecureReauthTokenService.generateToken({
            userId: params.userId,
            sessionId: params.sessionId,
            purpose: params.purpose,
            masterKey,
            ipAddress: params.ipAddress,
          });
        } finally {
          masterKey.fill(0);
        }
      },
    );
  }

  /**
   * Begin passkey reauth — NOT IMPLEMENTED. Fails closed to avoid an auth bypass.
   */
  beginPasskeyReauth(_params: {
    userId: string;
    sessionId: string;
    ipAddress: string;
    userAgent: string;
    purpose: string;
  }): Promise<{ attemptId: string; requestOptions: unknown }> {
    // KNOWN LIMITATION: passkey reauth challenge flow not yet implemented.
    // TODO: implement against the WebAuthn challenge service.
    throwHttpError("COMMON.NOT_IMPLEMENTED");
  }

  /**
   * Verify passkey reauth — NOT IMPLEMENTED. Fails closed to avoid an auth bypass.
   */
  verifyPasskeyReauth(_params: {
    userId: string;
    attemptId: string;
    credential: unknown;
    sessionId: string;
  }): Promise<{ success: boolean }> {
    // KNOWN LIMITATION: passkey reauth verification not yet implemented.
    // TODO: implement against the passkey verifier service.
    throwHttpError("COMMON.NOT_IMPLEMENTED");
  }
}
