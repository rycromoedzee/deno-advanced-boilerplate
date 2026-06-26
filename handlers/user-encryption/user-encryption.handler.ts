/**
 * @file handlers/user-encryption/user-encryption.handler.ts
 * @description Handlers for user encryption management routes
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import {
  canEnableEncryptionRoute,
  checkEncryptionStatusRoute,
  disableEnhancedEncryptionRoute,
  enhancedEncryptionOptInPasskeyRoute,
  enhancedEncryptionOptInRoute,
  initiatePRFSetupRoute,
  rewrapStalePasskeyRoute,
  rotateMasterKeyRoute,
  verifyPRFSetupRoute,
  verifyRecoveryPhraseRoute,
} from "@routes/user-encryption/user-encryption.route.ts";
import {
  getRecoveryPhraseCreateService,
  getRecoveryPhraseValidateService,
  getUserEnhancedEncryptionSettingsService,
} from "@services/user/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { useGetCookie, useGetSignedCookie } from "@utils/cookie.ts";
import { EncryptionSystemUserService } from "@services/encryption/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { TextTransformations } from "@utils/text/index.ts";
import {
  SchemaEncryptionCanEnableResponse,
  SchemaEncryptionDisableResponse,
  SchemaEncryptionOptInResponse,
  SchemaEncryptionPRFSetupResponse,
  SchemaEncryptionPRFVerifyResponse,
  SchemaEncryptionRewrapPasskeyResponse,
  SchemaEncryptionRotateKeyResponse,
  SchemaEncryptionStatusResponse,
  SchemaEncryptionVerifyRecoveryPhraseResponse,
} from "@models/user-encryption/index.ts";

const encryptionConfigService = getUserEnhancedEncryptionSettingsService();
const recoveryPhraseCreateService = getRecoveryPhraseCreateService();
const recoveryPhraseValidateService = getRecoveryPhraseValidateService();

/**
 * Handler for enhanced encryption opt-in (password-based)
 */
export const enhancedEncryptionOptInHandler = defineHandler(
  {
    route: enhancedEncryptionOptInRoute,
    operationName: "encryption_opt_in",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionOptInResponse,
  },
  async ({ userId, body, c }) => {
    const { password } = body as { password: string };

    // Check if user already has enhanced encryption
    const hasEnhancedEncryption = await encryptionConfigService
      .hasEnhancedEncryptionEnabled(userId);
    if (hasEnhancedEncryption) {
      throwHttpError("ENCRYPTION.ALREADY_OPTED_IN");
    }

    // Generate and store recovery phrase
    const recoveryPhrase = await recoveryPhraseCreateService
      .createNewRecoveryPhraseForUser(userId);

    // Enable user-controlled encryption and migrate data keys
    await encryptionConfigService.enableEnhancedEncryption(
      userId,
      password,
      recoveryPhrase,
    );

    // CRITICAL: After enabling enhanced encryption, we must update the current session
    // with the password-derived key so the user can immediately access their encrypted data.
    // Without this, the session would lack the encryption context needed to decrypt the
    // user master key, causing "Encryption key not found" errors.
    try {
      const accessToken = useGetCookie(c, AUTH_HEADER_NAMING.access) ||
        c.req.header("Authorization")?.replace("Bearer ", "");
      // Refresh token is a signed cookie — useGetSignedCookie verifies it.
      const refreshToken = await useGetSignedCookie(c, AUTH_HEADER_NAMING.refresh);

      if (accessToken) {
        // Generate password-derived key from the provided password
        const passwordDerivedKey = await EncryptionSystemUserService
          .generatePasswordDerivedKey(password, userId);
        const derivedKeyB64 = TextTransformations.fromBufferToBase64(passwordDerivedKey);

        // Get or generate session key for encrypting the cached key
        const sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined ||
          useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;

        // Store the password-derived key on the current access token.
        await EncryptionSystemUserService.storePasswordDerivedKeyInCache(
          accessToken,
          JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
          derivedKeyB64,
          sessionKey,
        );

        // ALSO store on the refresh token so the key survives token rotation.
        // reCacheEncryptionKeys re-derives the next access token's key from the
        // refresh token — without this, a key-less session (e.g. magic-link) that
        // just enabled E2EE loses the key on the first rotation (~15 min) and the
        // user must re-login with a password. Mirrors password login
        // (session-create.service.ts stores on both).
        if (refreshToken) {
          await EncryptionSystemUserService.storePasswordDerivedKeyWithRefreshToken(
            refreshToken,
            JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
            derivedKeyB64,
            sessionKey,
          );
        }

        useLogger(LoggerLevels.info, {
          message: "Password-derived key stored in session after enhanced encryption opt-in",
          messageKey: "encryption.opt_in_session_updated",
          section: loggerAppSections.ENCRYPTION,
        });
      }
    } catch (sessionError) {
      // Log but don't fail the opt-in if session update fails
      // The user will need to re-login to access encrypted data
      useLogger(LoggerLevels.warn, {
        message: "Failed to update session with encryption key after opt-in - user may need to re-login",
        messageKey: "encryption.opt_in_session_update_failed",
        section: loggerAppSections.ENCRYPTION,
        details: { error: sessionError instanceof Error ? sessionError.message : String(sessionError) },
      });
    }

    return {
      data: {
        success: true,
        recoveryPhrase: recoveryPhrase,
        message: "Enhanced encryption enabled successfully. Please save your recovery phrase securely.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for enhanced encryption opt-in (passkey-based)
 */
export const enhancedEncryptionOptInPasskeyHandler = defineHandler(
  {
    route: enhancedEncryptionOptInPasskeyRoute,
    operationName: "encryption_opt_in_passkey",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionOptInResponse,
  },
  async ({ userId, c }) => {
    // Check if user already has enhanced encryption
    const hasEnhancedEncryption = await encryptionConfigService
      .hasEnhancedEncryptionEnabled(userId);
    if (hasEnhancedEncryption) {
      throwHttpError("ENCRYPTION.ALREADY_OPTED_IN");
    }

    // Check if user has a password - if so, they should use the password route
    const hasPassword = await encryptionConfigService.hasPassword(userId);
    if (hasPassword) {
      throwHttpError("ENCRYPTION.PASSWORD_REQUIRED");
    }

    // Get access token from cookie or authorization header
    const authHeader = c.req.header("Authorization");
    const cookieHeader = c.req.header("Cookie");
    const accessToken = authHeader?.replace("Bearer ", "") ||
      (cookieHeader
        ? cookieHeader.split(";").find((c: string) => c.trim().startsWith(AUTH_HEADER_NAMING.access + "="))?.split("=")[1]
        : undefined);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Get session key for encrypting cached keys
    const sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined ||
      useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;

    // Enable encryption using PRF-derived key
    const result = await encryptionConfigService.enableEnhancedEncryptionForPasskeyUser(
      userId,
      accessToken,
    );

    // CRITICAL: After enabling enhanced encryption for passkey users, we must cache
    // the PRF-derived key in the session so the user can immediately access their
    // encrypted data. Without this, the session would lack the encryption context
    // needed to decrypt the user master key.
    try {
      // Fetch the PRF key data from the session (it was used during opt-in)
      const prfDerivedKey = await import("@services/encryption/passkey-prf.service.ts")
        .then((m) => m.PasskeyPRFService.fetchPRFDerivedKeyFromSession(accessToken, sessionKey));

      const prfCredentialId = await import("@services/encryption/passkey-prf.service.ts")
        .then((m) => m.PasskeyPRFService.fetchPRFCredentialIdFromSession(accessToken));

      if (prfDerivedKey && prfCredentialId) {
        // Re-cache the PRF key with the current access token
        await import("@services/encryption/passkey-prf.service.ts")
          .then((m) =>
            m.PasskeyPRFService.cachePRFDerivedKey(
              accessToken,
              JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
              prfDerivedKey,
              prfCredentialId,
              sessionKey,
            )
          );

        useLogger(LoggerLevels.info, {
          message: "PRF-derived key stored in session after enhanced encryption opt-in (passkey)",
          messageKey: "encryption.opt_in_passkey_session_updated",
          section: loggerAppSections.ENCRYPTION,
        });
      }
    } catch (sessionError) {
      // Log but don't fail the opt-in if session update fails
      useLogger(LoggerLevels.warn, {
        message: "Failed to update session with PRF key after passkey opt-in - user may need to re-authenticate",
        messageKey: "encryption.opt_in_passkey_session_update_failed",
        section: loggerAppSections.ENCRYPTION,
        details: { error: sessionError instanceof Error ? sessionError.message : String(sessionError) },
      });
    }

    return {
      data: {
        success: true,
        recoveryPhrase: result.recoveryPhrase,
        message: "Enhanced encryption enabled successfully. Please save your recovery phrase securely.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for checking encryption status
 */
export const checkEncryptionStatusHandler = defineHandler(
  {
    route: checkEncryptionStatusRoute,
    operationName: "encryption_status",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionStatusResponse,
  },
  async ({ userId }) => {
    const hasEnhancedEncryption = await encryptionConfigService
      .hasEnhancedEncryptionEnabled(userId);

    return {
      data: {
        isEnhancedEncryptionEnabled: hasEnhancedEncryption,
      },
      status: 200,
    };
  },
);

/**
 * Handler for verifying recovery phrase
 */
export const verifyRecoveryPhraseHandler = defineHandler(
  {
    route: verifyRecoveryPhraseRoute,
    operationName: "encryption_verify_recovery_phrase",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionVerifyRecoveryPhraseResponse,
  },
  async ({ userId, body }) => {
    const { recoveryPhrase } = body as { recoveryPhrase: string };

    // Verify recovery phrase by comparing with stored phrase
    const isValid = await recoveryPhraseValidateService.validatePhraseProvidedByUser(
      userId,
      recoveryPhrase,
    );

    return {
      data: {
        isValid: isValid,
        message: isValid ? "Recovery phrase is valid" : "Recovery phrase is invalid",
      },
      status: 200,
    };
  },
);

/**
 * Handler for disabling enhanced encryption
 * Uses the access token to retrieve the user's master key (works for both password and passkey users)
 */
export const disableEnhancedEncryptionHandler = defineHandler(
  {
    route: disableEnhancedEncryptionRoute,
    operationName: "encryption_disable",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionDisableResponse,
  },
  async ({ userId, c }) => {
    // Check if user has enhanced encryption enabled
    const hasEnhancedEncryption = await encryptionConfigService
      .hasEnhancedEncryptionEnabled(userId);
    if (!hasEnhancedEncryption) {
      throwHttpError("ENCRYPTION.NOT_ENABLED");
    }

    // Get access token from cookie or authorization header
    const authHeader = c.req.header("Authorization");
    const cookieHeader = c.req.header("Cookie");
    const accessToken = authHeader?.replace("Bearer ", "") ||
      (cookieHeader
        ? cookieHeader.split(";").find((c: string) => c.trim().startsWith(AUTH_HEADER_NAMING.access + "="))?.split("=")[1]
        : undefined);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Get ephemeral session key from context or cookie
    const sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined ||
      useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;

    // Disable enhanced encryption - the service will determine how to retrieve the master key
    const result = await encryptionConfigService.disableEnhancedEncryption(userId, accessToken, sessionKey);

    return {
      data: {
        success: result.success,
        migratedKeys: result.migratedKeys,
        sharedKeysConverted: result.sharedKeysConverted,
        message: `Enhanced encryption disabled successfully. ${result.migratedKeys} document(s) converted back to app encryption.${
          result.sharedKeysConverted > 0 ? ` ${result.sharedKeysConverted} shared access key(s) updated.` : ""
        }`,
      },
      status: 200,
    };
  },
);

/**
 * Handler for checking if user can enable encryption
 */
export const canEnableEncryptionHandler = defineHandler(
  {
    route: canEnableEncryptionRoute,
    operationName: "encryption_can_enable",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionCanEnableResponse,
  },
  async ({ userId }) => {
    const capabilities = await encryptionConfigService
      .canEnableEnhancedEncryption(userId);

    return {
      data: capabilities,
      status: 200,
    };
  },
);

/**
 * Handler for initiating PRF setup for passkey users
 */
export const initiatePRFSetupHandler = defineHandler(
  {
    route: initiatePRFSetupRoute,
    operationName: "encryption_prf_setup_begin",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionPRFSetupResponse,
  },
  async ({ userId }) => {
    const result = await encryptionConfigService.initiatePRFSetup(
      userId,
    );

    return {
      data: {
        success: result.success,
      },
      status: 200,
    };
  },
);

/**
 * Handler for verifying PRF setup
 */
export const verifyPRFSetupHandler = defineHandler(
  {
    route: verifyPRFSetupRoute,
    operationName: "encryption_prf_setup_verify",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionPRFVerifyResponse,
  },
  async ({ userId, body, c }) => {
    const { attemptId: _attemptId, credential, prfOutput } = body as {
      attemptId: string;
      credential: { id?: string; response?: { credentialId?: string } };
      prfOutput: { first: string };
    };

    // Extract credential ID from the WebAuthn response
    // The credential ID is in credential.id or credential.response.credentialId
    const credentialId = credential?.id || credential?.response?.credentialId;
    if (!credentialId) {
      throwHttpError("WEBAUTHN.CREDENTIAL_NOT_FOUND");
    }

    // Get access token from cookie or authorization header
    const authHeader = c.req.header("Authorization");
    const cookieHeader = c.req.header("Cookie");
    const accessToken = authHeader?.replace("Bearer ", "") ||
      (cookieHeader
        ? cookieHeader.split(";").find((c: string) => c.trim().startsWith(AUTH_HEADER_NAMING.access + "="))?.split("=")[1]
        : undefined);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const result = await encryptionConfigService.verifyAndCachePRFSetup(
      userId,
      credentialId,
      prfOutput.first,
    );

    return {
      data: {
        success: result.success,
        message: "PRF setup completed successfully. You can now enable enhanced encryption.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for rotating master key
 */
export const rotateMasterKeyHandler = defineHandler(
  {
    route: rotateMasterKeyRoute,
    operationName: "encryption_rotate_master_key",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionRotateKeyResponse,
  },
  async ({ userId, body, c }) => {
    const { recoveryPhrase } = body as { recoveryPhrase: string };

    // Get access token from cookie or authorization header
    const authHeader = c.req.header("Authorization");
    const cookieHeader = c.req.header("Cookie");
    const accessToken = authHeader?.replace("Bearer ", "") ||
      (cookieHeader
        ? cookieHeader.split(";").find((c: string) => c.trim().startsWith(AUTH_HEADER_NAMING.access + "="))?.split("=")[1]
        : undefined);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Get ephemeral session key from context (set by auth middleware from cookie)
    const sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined ||
      useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;

    const result = await encryptionConfigService.rotateMasterKey(
      userId,
      accessToken,
      recoveryPhrase,
      sessionKey,
    );

    return {
      data: {
        success: true,
        pendingPasskeyRewraps: result.pendingPasskeyRewraps,
        message: result.pendingPasskeyRewraps > 0
          ? `Master key rotated successfully. ${result.pendingPasskeyRewraps} passkey(s) will be updated on next login.`
          : "Master key rotated successfully.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for rewrapping stale passkey with recovery phrase
 */
export const rewrapStalePasskeyHandler = defineHandler(
  {
    route: rewrapStalePasskeyRoute,
    operationName: "encryption_rewrap_stale_passkey",
    entityType: "encryption",
    loggerSection: loggerAppSections.ENCRYPTION,
    responseSchema: SchemaEncryptionRewrapPasskeyResponse,
  },
  async ({ userId, body, c }) => {
    const { recoveryPhrase } = body as { recoveryPhrase: string };

    // Get access token from cookie or authorization header
    const authHeader = c.req.header("Authorization");
    const cookieHeader = c.req.header("Cookie");
    const accessToken = authHeader?.replace("Bearer ", "") ||
      (cookieHeader
        ? cookieHeader.split(";").find((c: string) => c.trim().startsWith(AUTH_HEADER_NAMING.access + "="))?.split("=")[1]
        : undefined);

    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    // Get ephemeral session key from context or cookie
    const _sessionKey = c.get(AUTH_HEADER_NAMING.internalSessionKey) as string | undefined ||
      useGetCookie(c, AUTH_HEADER_NAMING.sessionKey) || undefined;

    const result = await encryptionConfigService.rewrapStalePasskeyWithRecoveryPhrase(
      userId,
      "",
      recoveryPhrase,
    );

    return {
      data: {
        success: result.success,
        message: "Passkey encryption updated successfully.",
      },
      status: 200,
    };
  },
);
