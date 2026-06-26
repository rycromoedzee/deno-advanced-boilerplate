/**
 * @file services/auth/account-recovery.service.ts
 * @description Main service for account recovery operations
 */

import { getGlobalDB, getTenantDB, globalTables, tenantTables } from "@db/index.ts";
import { eq, hexToBytes, type RegistrationResponseJSON } from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections } from "@logger/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { HASHING_CONTEXTS, TextHashing, TextTransformations } from "@utils/text/index.ts";
import { generateJwtResetToken, tokenHashString } from "@services/token/index.ts";
import { getPasswordResetService } from "./singletons.ts";
import { RecoveryPhraseValidateService } from "@services/user/index.ts";
import { userRecoveryPhraseCreateHashFromPhrase } from "@services/user/recovery-phrase.service.ts";
import { AuthPasskeyRegistrationService } from "./passkey-auth.service.ts";
import { PasskeyPRFService } from "@services/encryption/index.ts";
import { useSymmetricDecrypt, useSymmetricEncrypt } from "@services/encryption/encryption.helper.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { getEmailSenderService } from "@services/mailer/index.ts";
import { envConfig } from "@config/env.ts";
import { IAccountRecoveryInitiateResult, IAccountRecoveryLookupResult, IAccountRecoveryTokenData } from "@interfaces/account-recovery.ts";
import type { Span } from "@interfaces/tracing.ts";
import { AuthServiceCacheKeys } from "@utils/auth/index.ts";

// Recovery token TTL: 15 minutes
const RECOVERY_TOKEN_TTL_SECONDS = 900;

export class AccountRecoveryService {
  /**
   * Detects if identifier is email (contains @) or username
   */
  private isEmail(identifier: string): boolean {
    return identifier.includes("@");
  }

  /**
   * Looks up user account by identifier (email or username)
   */
  private async lookupByIdentifier(
    identifier: string,
  ): Promise<IAccountRecoveryLookupResult> {
    const globalDb = getGlobalDB();
    const isEmail = this.isEmail(identifier);
    const searchField = isEmail ? globalTables.users.email : globalTables.users.username;
    const searchValue = identifier.toLowerCase().trim();

    // Look up user from global DB
    const [user] = await globalDb
      .select({
        id: globalTables.users.id,
        email: globalTables.users.email,
        username: globalTables.users.username,
        password: globalTables.users.password,
        environmentId: globalTables.users.environmentId,
      })
      .from(globalTables.users)
      .where(eq(searchField, searchValue))
      .limit(1);

    if (!user) {
      return { found: false };
    }

    // Get tenant-specific data (encryption + profile with language)
    const tenantDb = await getTenantDB(user.environmentId);
    const [encryption, userProfile] = await Promise.all([
      tenantDb
        .select({
          isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
          recoveryPhraseVerificationData: tenantTables.userEncryption.userEncryptedRecoveryPhraseVerificationData,
        })
        .from(tenantTables.userEncryption)
        .where(eq(tenantTables.userEncryption.userId, user.id))
        .limit(1)
        .then((result) => result[0]),
      tenantDb
        .select({
          language: tenantTables.userProfiles.language,
        })
        .from(tenantTables.userProfiles)
        .where(eq(tenantTables.userProfiles.userId, user.id))
        .limit(1)
        .then((result) => result[0]),
    ]);

    // Check for passkeys (in global DB)
    const passkeys = await globalDb
      .select({ id: globalTables.userPasskeys.id })
      .from(globalTables.userPasskeys)
      .where(eq(globalTables.userPasskeys.userId, user.id))
      .limit(1);

    return {
      found: true,
      userId: user.id,
      identityId: user.id, // For backward compat, identityId = userId now
      email: user.email ?? undefined,
      username: user.username ?? undefined,
      hasPassword: !!user.password,
      hasPasskeys: passkeys.length > 0,
      enhancedEncryptionEnabled: encryption?.isEnhancedEncryptionEnabled ?? false,
      hasRecoveryPhrase: !!encryption?.recoveryPhraseVerificationData,
      language: userProfile?.language ?? "en",
    };
  }

  /**
   * Initiates account recovery
   *
   * EMAIL path: SECURITY: Always returns generic success to prevent email enumeration.
   * Email is sent with a token that reveals account state when validated.
   *
   * USERNAME path: Returns recovery options shape WITHOUT revealing if account exists.
   * If username not found, returns all options as false. This supports passkey-only users
   * with no email who can recover via recovery phrase.
   */
  async initiateRecovery(
    identifier: string,
  ): Promise<IAccountRecoveryInitiateResult> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.initiateRecovery",
      {
        service: "AccountRecoveryService",
        method: "initiateRecovery",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const isEmail = this.isEmail(identifier);

        if (isEmail) {
          // EMAIL PATH: Always return generic success to prevent enumeration
          span.attributes["identifier_type"] = "email";

          const lookupResult = await this.lookupByIdentifier(identifier);

          if (lookupResult.found && lookupResult.userId) {
            span.attributes["account_found"] = true;
            span.attributes["user_id"] = lookupResult.userId;

            // Generate password reset token (existing service)
            const passwordResetService = getPasswordResetService();
            const { token } = await passwordResetService
              .generatePasswordResetToken(
                lookupResult.userId,
              );

            const resetUrl = `https://${envConfig.public.frontURL}/auth/forget-password/${encodeURIComponent(token)}`;
            const recoveryPhraseRequired = lookupResult.enhancedEncryptionEnabled ?? false;
            const toEmail = lookupResult.email ?? identifier.toLowerCase().trim();
            const language = lookupResult.language ?? "en";

            const emailSenderService = getEmailSenderService();
            await emailSenderService.useSendEmail(
              lookupResult.userId,
              toEmail,
              {
                email: toEmail,
                resetURL: resetUrl,
                recoveryPhraseRequired,
              } as unknown as JSON,
              "password-reset",
              language,
            );
          } else {
            span.attributes["account_found"] = false;
            // Silently succeed — do not leak account existence
          }

          // SECURITY: Always return the same generic shape for email
          return {
            identifierType: "email",
            recoveryOptions: { emailLink: true, recoveryPhrase: false },
            enhancedEncryptionEnabled: false,
            hasRecoveryPhrase: false,
          };
        } else {
          // USERNAME PATH: Return actual options without revealing account existence
          span.attributes["identifier_type"] = "username";

          const lookupResult = await this.lookupByIdentifier(identifier);

          if (!lookupResult.found) {
            span.attributes["account_found"] = false;
            // Return same shape with all options false — do not leak account existence
            return {
              identifierType: "username",
              recoveryOptions: { emailLink: false, recoveryPhrase: false },
              enhancedEncryptionEnabled: false,
              hasRecoveryPhrase: false,
            };
          }

          span.attributes["account_found"] = true;
          span.attributes["user_id"] = lookupResult.userId;

          const hasEmail = !!lookupResult.email;
          const hasRecoveryPhrase = lookupResult.hasRecoveryPhrase ?? false;
          const enhancedEncryptionEnabled = lookupResult.enhancedEncryptionEnabled ?? false;

          return {
            identifierType: "username",
            recoveryOptions: {
              emailLink: hasEmail,
              recoveryPhrase: hasRecoveryPhrase || enhancedEncryptionEnabled,
            },
            enhancedEncryptionEnabled,
            hasRecoveryPhrase,
          };
        }
      },
    );
  }

  /**
   * Validates an email recovery token and returns recovery options
   * Called when user clicks the email link
   */
  async validateEmailToken(
    emailToken: string,
  ): Promise<{
    valid: boolean;
    identifier?: string;
    recoveryOptions?: {
      emailLink: boolean;
      recoveryPhrase: boolean;
    };
    enhancedEncryptionEnabled?: boolean;
    hasRecoveryPhrase?: boolean;
    /**
     * True if the account has 2FA enabled.
     * Frontend must prompt for 2FA code or backup code before allowing password reset.
     * This is checked AFTER email link validation, BEFORE the password reset step.
     */
    has2FA?: boolean;
    requiresUserSelection?: boolean;
    availableUsers?: Array<{
      userId: string;
      environmentName: string;
      displayName: string;
    }>;
  }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.validateEmailToken",
      {
        service: "AccountRecoveryService",
        method: "validateEmailToken",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const passwordResetService = getPasswordResetService();
        // NOTE: PasswordResetService stores identityId as 'userId' field
        const tokenData = await passwordResetService.validatePasswordResetToken(
          emailToken,
        );

        if (!tokenData) {
          return { valid: false };
        }

        // userId is now the primary identifier (identities merged into users)
        const userId = tokenData.userId;

        // Get user from global DB
        const globalDb = getGlobalDB();
        const [user] = await globalDb
          .select({
            id: globalTables.users.id,
            firstName: globalTables.users.firstName,
            lastName: globalTables.users.lastName,
            password: globalTables.users.password,
            email: globalTables.users.email,
            username: globalTables.users.username,
            environmentId: globalTables.users.environmentId,
            isTwoFactorEnabled: globalTables.users.isTwoFactorEnabled,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!user) {
          return { valid: false };
        }

        const hasPassword = !!user.password;
        // Return email preferentially as the identifier; fall back to username
        const identifier = user.email ?? user.username ?? undefined;

        // Get tenant-specific encryption settings
        const tenantDb = await getTenantDB(user.environmentId);
        const [encryption] = await tenantDb
          .select({
            isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
            recoveryPhraseVerificationData: tenantTables.userEncryption.userEncryptedRecoveryPhraseVerificationData,
          })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        // Get environment name
        const environments = await globalDb
          .select({
            id: globalTables.environments.id,
            name: globalTables.environments.name,
          })
          .from(globalTables.environments)
          .where(eq(globalTables.environments.id, user.environmentId));

        // In new model: 1:1 user→identity, no multi-user selection needed
        const _envName = environments[0]?.name || "Unknown";
        const enhancedEncryptionEnabled = encryption?.isEnhancedEncryptionEnabled ?? false;
        const hasRecoveryPhrase = !!encryption?.recoveryPhraseVerificationData;
        const has2FA = user.isTwoFactorEnabled ?? false;

        span.attributes["success"] = true;
        span.attributes["user_count"] = 1;
        span.attributes["has_2fa"] = has2FA;

        return {
          valid: true,
          identifier,
          recoveryOptions: {
            emailLink: hasPassword,
            recoveryPhrase: enhancedEncryptionEnabled,
          },
          enhancedEncryptionEnabled,
          hasRecoveryPhrase,
          has2FA,
          requiresUserSelection: false,
          availableUsers: undefined,
        };
      },
    );
  }

  /**
   * Generates an encryption key for recovery token storage
   */
  private generateRecoveryTokenEncryptionKey(tokenHash: string): Uint8Array {
    return TextHashing.generateHashFromString(
      `recovery:${tokenHash}`,
      HASHING_CONTEXTS.AUTH_SESSION_ENCRYPTION,
      32,
    );
  }

  /**
   * Stores a recovery token with encrypted master key
   */
  private async storeRecoveryToken(
    userId: string,
    masterKey: Uint8Array,
  ): Promise<string> {
    const token = generateJwtResetToken();
    const tokenHash = tokenHashString(token);
    const now = getTimeNow();
    const expiresAt = now + RECOVERY_TOKEN_TTL_SECONDS * 1000;

    // Encrypt master key with token-derived key
    const encryptionKey = this.generateRecoveryTokenEncryptionKey(tokenHash);
    const encryptedMasterKey = await useSymmetricEncrypt({
      key: encryptionKey,
      data: masterKey,
    });

    const tokenData: IAccountRecoveryTokenData = {
      identityId: userId, // using userId as identityId here for backward compat
      userId,
      tokenHash,
      encryptedMasterKey: TextTransformations.fromBufferToBase64(encryptedMasterKey),
      createdAt: now,
      expiresAt,
      used: false,
    };

    const cache = await getCache();
    await cache.set(
      CACHE_NAMESPACES.AUTH.RECOVERY_TOKENS,
      tokenHash,
      tokenData,
      { ttl: RECOVERY_TOKEN_TTL_SECONDS },
    );

    return token;
  }

  /**
   * Retrieves and validates a recovery token
   */
  private async getRecoveryTokenData(
    recoveryToken: string,
  ): Promise<IAccountRecoveryTokenData | null> {
    const tokenHash = tokenHashString(recoveryToken);
    const cache = await getCache();

    const tokenData = await cache.get<IAccountRecoveryTokenData>(
      CACHE_NAMESPACES.AUTH.RECOVERY_TOKENS,
      tokenHash,
    );

    if (!tokenData) {
      return null;
    }

    // Check expiration
    if (tokenData.expiresAt < getTimeNow()) {
      await cache.delete(CACHE_NAMESPACES.AUTH.RECOVERY_TOKENS, tokenHash);
      return null;
    }

    // Check if already used
    if (tokenData.used) {
      return null;
    }

    return tokenData;
  }

  /**
   * Retrieves the decrypted master key for a recovery token
   */
  private async getMasterKeyForToken(
    recoveryToken: string,
  ): Promise<{ userId: string; masterKey: Uint8Array } | null> {
    const tokenData = await this.getRecoveryTokenData(recoveryToken);
    if (!tokenData || !tokenData.userId) {
      return null;
    }

    const encryptionKey = this.generateRecoveryTokenEncryptionKey(tokenData.tokenHash);
    const encryptedMasterKey = TextTransformations.base64ToBuffer(
      tokenData.encryptedMasterKey,
    );

    const masterKey = await useSymmetricDecrypt({
      key: encryptionKey,
      data: encryptedMasterKey,
    });

    return { userId: tokenData.userId, masterKey };
  }

  /**
   * Marks a recovery token as used / deletes it
   */
  private async invalidateRecoveryToken(recoveryToken: string): Promise<void> {
    const tokenHash = tokenHashString(recoveryToken);
    const cache = await getCache();
    await cache.delete(CACHE_NAMESPACES.AUTH.RECOVERY_TOKENS, tokenHash);
  }

  /**
   * Verifies 2FA during recovery — supports both TOTP codes (6-digit) and backup codes.
   * The existing AuthTOTPValidationService handles multiple devices by checking all active secrets.
   *
   * Accepts either a recoveryToken (from phrase verification) or emailToken (from email link).
   * This is important because when 2FA is checked after email link validation, the user
   * only has an emailToken — they do not yet have a recoveryToken.
   *
   * @param recoveryToken - Optional: recovery token from phrase verification
   * @param emailToken - Optional: email token from email link (alternative to recoveryToken)
   * @param twoFaCode - A 6-digit TOTP code from an authenticator app
   * @param backupCode - A backup code (used when authenticator is unavailable)
   * @returns The token passed in (either recoveryToken or emailToken) as verifiedToken
   */
  async verify2FA(
    recoveryToken: string | undefined,
    emailToken: string | undefined,
    twoFaCode?: string,
    backupCode?: string,
  ): Promise<{ success: boolean; verifiedToken: string }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.verify2FA",
      {
        service: "AccountRecoveryService",
        method: "verify2FA",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        let userId: string;
        let verifiedToken: string;

        if (recoveryToken) {
          // Try recovery token first (stored in RECOVERY_TOKENS cache)
          const tokenData = await this.getRecoveryTokenData(recoveryToken);
          if (tokenData && tokenData.userId) {
            userId = tokenData.userId;
            verifiedToken = recoveryToken;
            span.attributes["token_type"] = "recovery";
          } else {
            // Fall through: treat as email token (user may have passed emailToken in recoveryToken field)
            const passwordResetService = getPasswordResetService();
            const emailTokenData = await passwordResetService.validatePasswordResetToken(recoveryToken);
            if (!emailTokenData) {
              throwHttpError("AUTH.SESSION_EXPIRED");
            }
            const userId2 = emailTokenData!.userId;
            const db = getGlobalDB();
            const [user] = await db
              .select({ id: globalTables.users.id })
              .from(globalTables.users)
              .where(eq(globalTables.users.id, userId2))
              .limit(1);
            if (!user) {
              throwHttpError("USER.NOT_FOUND");
            }
            userId = user!.id;
            verifiedToken = recoveryToken;
            span.attributes["token_type"] = "email_as_recovery";
          }
        } else if (emailToken) {
          // Look up user from email token (PasswordResetService)
          const passwordResetService = getPasswordResetService();
          const tokenData = await passwordResetService.validatePasswordResetToken(emailToken);
          if (!tokenData) {
            throwHttpError("AUTH.SESSION_EXPIRED");
          }
          const userId2 = tokenData!.userId;
          const db = getGlobalDB();
          const [user] = await db
            .select({ id: globalTables.users.id })
            .from(globalTables.users)
            .where(eq(globalTables.users.id, userId2))
            .limit(1);
          if (!user) {
            throwHttpError("USER.NOT_FOUND");
          }
          userId = user!.id;
          verifiedToken = emailToken;
          span.attributes["token_type"] = "email";
        } else {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
          throw new Error("unreachable");
        }

        span.attributes["user_id"] = userId;

        const { AuthTOTPValidationService } = await import("./mfa-totp.service.ts");

        if (twoFaCode) {
          // Validate TOTP code — AuthTOTPValidationService checks all active secrets for this user
          span.attributes["method"] = "totp";
          const result = await AuthTOTPValidationService.validateTwoFactorCode(
            userId,
            twoFaCode,
          );

          if (!result.isValid) {
            throwHttpError("AUTH.TWO_FACTOR_INVALID");
          }
        } else if (backupCode) {
          // Validate backup code
          span.attributes["method"] = "backup_code";
          const result = await AuthTOTPValidationService.validateBackupCode(
            userId,
            backupCode,
          );

          if (!result.isValid) {
            throwHttpError("AUTH.TWO_FACTOR_INVALID");
          }
        } else {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
        }

        span.attributes["success"] = true;
        return { success: true, verifiedToken: verifiedToken! };
      },
    );
  }

  /**
   * Verifies recovery phrase and issues a recovery token
   * Accepts email OR username as identifier — supports passkey-only users without email
   */
  async verifyRecoveryPhrase(
    identifier: string,
    recoveryPhrase: string,
  ): Promise<{ recoveryToken: string }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.verifyRecoveryPhrase",
      {
        service: "AccountRecoveryService",
        method: "verifyRecoveryPhrase",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const lookupResult = await this.lookupByIdentifier(identifier);

        if (!lookupResult.found || !lookupResult.userId) {
          throwHttpError("AUTH.INVALID_RECOVERY_PHRASE");
        }

        span.attributes["user_id"] = lookupResult.userId!;

        // Verify recovery phrase
        const validateService = new RecoveryPhraseValidateService();
        const isValid = await validateService.validatePhraseProvidedByUser(
          lookupResult.userId!,
          recoveryPhrase,
        );

        if (!isValid) {
          throwHttpError("AUTH.INVALID_RECOVERY_PHRASE");
        }

        // Get the encrypted master key from recovery phrase (tenant table)
        const globalDb2 = getGlobalDB();
        const [globalUser2] = await globalDb2
          .select({ environmentId: globalTables.users.environmentId })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, lookupResult.userId!))
          .limit(1);

        if (!globalUser2) {
          throwHttpError("AUTH.INVALID_RECOVERY_PHRASE");
        }

        const tenantDb2 = await getTenantDB(globalUser2.environmentId);
        const [userEncryption2] = await tenantDb2
          .select({
            encryptedMasterKeyByRecoveryPhrase: tenantTables.userEncryption.encryptedMasterKeyByRecoveryPhrase,
          })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, lookupResult.userId!))
          .limit(1);

        if (!userEncryption2 || !userEncryption2.encryptedMasterKeyByRecoveryPhrase) {
          throwHttpError("AUTH.INVALID_RECOVERY_PHRASE");
        }

        // Derive key from recovery phrase and decrypt master key
        // The hash is hex-encoded; must use hexToBytes to match how it was encrypted
        const recoveryPhraseHash = userRecoveryPhraseCreateHashFromPhrase(recoveryPhrase);
        const recoveryPhraseDerivedKey = hexToBytes(recoveryPhraseHash);

        const masterKey = await useSymmetricDecrypt({
          key: recoveryPhraseDerivedKey,
          data: userEncryption2!.encryptedMasterKeyByRecoveryPhrase as Uint8Array,
        });

        // Store recovery token with encrypted master key
        const recoveryToken = await this.storeRecoveryToken(
          lookupResult.userId!,
          masterKey,
        );

        // Zero the master key from memory
        masterKey.fill(0);

        span.attributes["success"] = true;

        return { recoveryToken };
      },
    );
  }

  /**
   * Resets password during recovery flow
   */
  async resetPassword(
    recoveryToken: string | undefined,
    emailToken: string | undefined,
    newPassword: string,
  ): Promise<{ success: boolean; newRecoveryPhrase?: string }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.resetPassword",
      {
        service: "AccountRecoveryService",
        method: "resetPassword",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        let userId: string;
        let masterKey: Uint8Array | null = null;

        if (emailToken) {
          // Validate email token
          const passwordResetService = getPasswordResetService();
          const tokenData = await passwordResetService.validatePasswordResetToken(
            emailToken,
          );

          if (!tokenData) {
            throwHttpError("AUTH.TOKEN_ALREADY_USED");
          }

          const resetUserId = tokenData!.userId;
          span.attributes["flow"] = "email";

          // Mark email token as used
          await passwordResetService.markTokenAsUsed(tokenData!.tokenHash);

          // tokenData.userId is the userId directly (identities merged into users)
          const db = getGlobalDB();
          const [user] = await db
            .select({ id: globalTables.users.id })
            .from(globalTables.users)
            .where(eq(globalTables.users.id, resetUserId))
            .limit(1);

          if (!user) {
            throwHttpError("USER.NOT_FOUND");
          }

          userId = user!.id;
        } else if (recoveryToken) {
          // Try as recovery token first (from phrase verification)
          const tokenData = await this.getMasterKeyForToken(recoveryToken);
          if (tokenData) {
            userId = tokenData.userId;
            masterKey = tokenData.masterKey;
            span.attributes["flow"] = "recovery_phrase";
          } else {
            // Fall through: treat as email token (user may have passed emailToken in recoveryToken field)
            const passwordResetService = getPasswordResetService();
            const resetTokenData = await passwordResetService.validatePasswordResetToken(recoveryToken);
            if (!resetTokenData) {
              throwHttpError("AUTH.SESSION_EXPIRED");
            }
            const fallbackUserId = resetTokenData!.userId;
            span.attributes["flow"] = "email_via_recovery_field";

            await passwordResetService.markTokenAsUsed(resetTokenData!.tokenHash);

            const dbFallback = getGlobalDB();
            const [fallbackUser] = await dbFallback
              .select({ id: globalTables.users.id })
              .from(globalTables.users)
              .where(eq(globalTables.users.id, fallbackUserId))
              .limit(1);

            if (!fallbackUser) {
              throwHttpError("USER.NOT_FOUND");
            }
            userId = fallbackUser!.id;
          }
        } else {
          throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
          throw new Error("unreachable"); // TypeScript flow
        }

        span.attributes["user_id"] = userId!;

        const db = getGlobalDB();

        // Get user info from global DB
        const [user] = await db
          .select({
            id: globalTables.users.id,
            environmentId: globalTables.users.environmentId,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId!))
          .limit(1);

        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Get encryption info from tenant DB
        const tenantDbForReset = await getTenantDB(user!.environmentId);
        const [userEncryptionForReset] = await tenantDbForReset
          .select({
            isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
            encryptedMasterKeyByPassword: tenantTables.userEncryption.encryptedMasterKeyByPassword,
            encryptedMasterKeyByRecoveryPhrase: tenantTables.userEncryption.encryptedMasterKeyByRecoveryPhrase,
          })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId!))
          .limit(1);

        // Hash new password using EncryptionSystemUserService pattern
        const newPasswordHash = await EncryptionSystemUserService.generatePasswordDerivedKey(
          newPassword,
          userId!,
        );

        // Hash password for storage
        const { AuthPasswordService } = await import("./password-auth.service.ts");
        const newPasswordStored = await AuthPasswordService.generatePassword(newPassword);

        // Update password in user record
        await db
          .update(globalTables.users)
          .set({ password: newPasswordStored })
          .where(eq(globalTables.users.id, userId!));

        let newRecoveryPhrase: string | undefined;

        if (userEncryptionForReset?.isEnhancedEncryptionEnabled && masterKey) {
          // Re-encrypt master key with new password
          const newEncryptedMasterKey = await useSymmetricEncrypt({
            key: newPasswordHash,
            data: masterKey,
          });

          // Generate new recovery phrase
          const { RecoveryPhraseCreateService } = await import(
            "@services/user/index.ts"
          );
          const createService = new RecoveryPhraseCreateService();
          newRecoveryPhrase = await createService.createNewRecoveryPhraseForUser(userId!);

          // Encrypt master key with new recovery phrase
          // Hash is hex-encoded; must use hexToBytes to match encrypt/decrypt convention
          const newRecoveryPhraseDerivedKey = hexToBytes(
            userRecoveryPhraseCreateHashFromPhrase(newRecoveryPhrase),
          );

          const newEncryptedMasterKeyByRecoveryPhrase = await useSymmetricEncrypt({
            key: newRecoveryPhraseDerivedKey,
            data: masterKey,
          });

          // Update encryption keys in tenant DB
          await tenantDbForReset
            .update(tenantTables.userEncryption)
            .set({
              encryptedMasterKeyByPassword: newEncryptedMasterKey,
              encryptedMasterKeyByRecoveryPhrase: newEncryptedMasterKeyByRecoveryPhrase,
            })
            .where(eq(tenantTables.userEncryption.userId, userId!));
        } else if (masterKey) {
          // Just re-encrypt with new password (no enhanced encryption)
          const newEncryptedMasterKey = await useSymmetricEncrypt({
            key: newPasswordHash,
            data: masterKey,
          });

          await tenantDbForReset
            .update(tenantTables.userEncryption)
            .set({ encryptedMasterKeyByPassword: newEncryptedMasterKey })
            .where(eq(tenantTables.userEncryption.userId, userId!));
        }

        // Zero the master key from memory after all encryption operations
        if (masterKey) {
          masterKey.fill(0);
        }

        // Invalidate recovery token if used
        if (recoveryToken) {
          await this.invalidateRecoveryToken(recoveryToken);
        }

        span.attributes["success"] = true;

        return { success: true, newRecoveryPhrase };
      },
    );
  }

  /**
   * Begins passkey registration during recovery
   */
  async beginPasskeyRegistration(
    recoveryToken: string,
    hostname: string,
  ): Promise<{ attemptId: string; creationOptions: unknown; prfSalt: string }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.beginPasskeyRegistration",
      {
        service: "AccountRecoveryService",
        method: "beginPasskeyRegistration",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const tokenData = await this.getRecoveryTokenData(recoveryToken);
        if (!tokenData || !tokenData.userId) {
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        span.attributes["user_id"] = tokenData!.userId!;

        // Get user info for registration
        const db = getGlobalDB(); // Note: getTenantDB() as needed for tenant-specific data
        const [user] = await db
          .select({
            id: globalTables.users.id,
            firstName: globalTables.users.firstName,
            lastName: globalTables.users.lastName,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, tokenData!.userId!))
          .limit(1);

        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        const displayName = `${user!.firstName ?? ""} ${user!.lastName ?? ""}`.trim();

        // Use existing passkey registration service with PRF
        const result = await AuthPasskeyRegistrationService
          .buildRegistrationConfigWithPRF({
            urlHostName: hostname,
            userName: user!.id,
            displayName,
          });

        span.attributes["success"] = true;

        return {
          attemptId: result.attemptId,
          creationOptions: result.creationOptions,
          prfSalt: result.prfSalt,
        };
      },
    );
  }

  /**
   * Completes passkey registration during recovery
   */
  async completePasskeyRegistration(
    recoveryToken: string,
    attemptId: string,
    registrationResponse: RegistrationResponseJSON,
    prfOutput: string,
    url: string,
  ): Promise<{ success: boolean; newRecoveryPhrase?: string }> {
    return await tracedWithServiceErrorHandling(
      "AccountRecoveryService.completePasskeyRegistration",
      {
        service: "AccountRecoveryService",
        method: "completePasskeyRegistration",
        section: loggerAppSections.AUTH,
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span: Span) => {
        const tokenData = await this.getMasterKeyForToken(recoveryToken);
        if (!tokenData) {
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        const { userId, masterKey } = tokenData!;
        span.attributes["user_id"] = userId;

        const urlObj = new URL(url);

        // Verify passkey registration
        const registrationResult = await AuthPasskeyRegistrationService.register({
          passkeyRegistrationBody: registrationResponse,
          attemptId,
          urlHostName: urlObj.hostname,
          url,
        });

        const db = getGlobalDB();

        // Get user info
        const [user] = await db
          .select({
            id: globalTables.users.id,
            environmentId: globalTables.users.environmentId,
          })
          .from(globalTables.users)
          .where(eq(globalTables.users.id, userId))
          .limit(1);

        if (!user) {
          throwHttpError("USER.NOT_FOUND");
        }

        // Get encryption info from tenant DB
        const tenantDbForPasskey = await getTenantDB(user!.environmentId);
        const [userEncryptionForPasskey] = await tenantDbForPasskey
          .select({
            isEnhancedEncryptionEnabled: tenantTables.userEncryption.isEnhancedEncryptionEnabled,
          })
          .from(tenantTables.userEncryption)
          .where(eq(tenantTables.userEncryption.userId, userId))
          .limit(1);

        // Store passkey in userPasskeys
        await db.insert(globalTables.userPasskeys).values({
          userId: user!.id,
          id: registrationResult.credential.id,
          publicKey: registrationResult.credential.publicKey,
          counter: registrationResult.credential.counter,
          backedUp: registrationResult.credential.backedUp,
          transports: registrationResult.credential.transports,
        });

        // Derive key from PRF output
        const prfDerivedKey = await PasskeyPRFService.deriveKeyFromPRF(
          prfOutput,
          userId,
        );

        // Encrypt master key with PRF-derived key
        const encryptedMasterKeyBytes = await PasskeyPRFService.encryptMasterKeyWithPRF(
          masterKey,
          prfDerivedKey,
          userId,
        );

        // Get PRF salt from cache (stored during begin)
        const cache = await getCache();
        const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
        const prfSalt = await cache.get<string>(
          CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
          `${cacheKey}:prf_salt`,
        );

        if (!prfSalt) {
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        // Store PRF key record
        await db.insert(globalTables.passkeyPRFKeys).values({
          credentialId: registrationResult.credential.id,
          encryptedMasterKey: encryptedMasterKeyBytes,
          prfSalt: prfSalt!,
        });

        let newRecoveryPhrase: string | undefined;

        // Generate new recovery phrase if enhanced encryption is enabled
        if (userEncryptionForPasskey?.isEnhancedEncryptionEnabled) {
          const { RecoveryPhraseCreateService } = await import(
            "@services/user/index.ts"
          );
          const createService = new RecoveryPhraseCreateService();
          newRecoveryPhrase = await createService.createNewRecoveryPhraseForUser(userId);

          // Encrypt master key with new recovery phrase
          // Hash is hex-encoded; must use hexToBytes to match encrypt/decrypt convention
          const newRecoveryPhraseDerivedKey = hexToBytes(
            userRecoveryPhraseCreateHashFromPhrase(newRecoveryPhrase),
          );

          const newEncryptedMasterKeyByRecoveryPhrase = await useSymmetricEncrypt({
            key: newRecoveryPhraseDerivedKey,
            data: masterKey,
          });

          await tenantDbForPasskey
            .update(tenantTables.userEncryption)
            .set({
              encryptedMasterKeyByRecoveryPhrase: newEncryptedMasterKeyByRecoveryPhrase,
            })
            .where(eq(tenantTables.userEncryption.userId, userId));
        }

        // Zero the master key from memory after all encryption operations
        masterKey.fill(0);

        // Invalidate recovery token
        await this.invalidateRecoveryToken(recoveryToken);

        span.attributes["success"] = true;

        return { success: true, newRecoveryPhrase };
      },
    );
  }
}
