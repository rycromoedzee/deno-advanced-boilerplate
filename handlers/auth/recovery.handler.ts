/**
 * @file handlers/auth/recovery.handler.ts
 * @description Account recovery API handlers
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { getAccountRecoveryService } from "@services/auth/index.ts";
import {
  recoveryBeginRoute,
  recoveryDisable2FARoute,
  recoveryResetPasswordRoute,
  recoverySendResetEmailRoute,
  recoveryVerifyBackupCodeRoute,
  recoveryVerifyEmailTokenRoute,
  recoveryVerifyPhraseRoute,
} from "@routes/auth/recovery.route.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  SchemaAccountRecoveryInitiateResponse,
  SchemaResetPasswordRecoveryResponse,
  SchemaVerifyRecoveryPhraseResponse,
} from "@models/auth/account-recovery.model.ts";
import {
  SchemaRecoveryDisable2FAResponse,
  SchemaRecoverySendResetEmailResponse,
  SchemaRecoveryVerifyBackupCodeResponse,
  SchemaRecoveryVerifyEmailTokenResponse,
} from "@models/auth/auth-response.model.ts";

/**
 * POST /api/auth/recovery/begin
 * Initiates account recovery
 */
export const recoveryBeginHandler = defineHandler(
  {
    route: recoveryBeginRoute,
    operationName: "auth_recovery_begin",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaAccountRecoveryInitiateResponse,
  },
  async ({ body }) => {
    const { identifier } = body;
    const recoveryService = getAccountRecoveryService();
    const result = await recoveryService.initiateRecovery(identifier);
    return { data: result, status: 200 as const };
  },
);

/**
 * POST /api/auth/recovery/verify-phrase
 * Verifies recovery phrase and issues recovery token
 */
export const recoveryVerifyPhraseHandler = defineHandler(
  {
    route: recoveryVerifyPhraseRoute,
    operationName: "auth_recovery_verify_phrase",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaVerifyRecoveryPhraseResponse,
  },
  async ({ body }) => {
    const { identifier, recoveryPhrase } = body;
    const recoveryService = getAccountRecoveryService();
    const result = await recoveryService.verifyRecoveryPhrase(identifier, recoveryPhrase);
    return { data: result, status: 200 as const };
  },
);

/**
 * POST /api/auth/recovery/reset-password
 * Resets password during recovery
 */
export const recoveryResetPasswordHandler = defineHandler(
  {
    route: recoveryResetPasswordRoute,
    operationName: "auth_recovery_reset_password",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaResetPasswordRecoveryResponse,
  },
  async ({ body }) => {
    const { recoveryToken, emailToken, newPassword } = body;
    const recoveryService = getAccountRecoveryService();
    const result = await recoveryService.resetPassword(recoveryToken, emailToken, newPassword);
    return { data: result, status: 200 as const };
  },
);

/**
 * POST /api/auth/recovery/disable-2fa
 * Disables 2FA during recovery (stub - requires 2FA service integration)
 */
export const recoveryDisable2FAHandler = defineHandler(
  {
    route: recoveryDisable2FARoute,
    operationName: "auth_recovery_disable_2fa",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRecoveryDisable2FAResponse,
  },
  // Handler must return Promise<HandlerResponse> per defineHandler's contract.
  // deno-lint-ignore require-await
  async ({ body }) => {
    const { recoveryToken } = body;

    // Validate recovery token exists
    if (!recoveryToken) {
      throwHttpError("AUTH.SESSION_EXPIRED");
    }

    // KNOWN LIMITATION: 2FA disable via recovery token is not yet implemented.
    // TODO: integrate against the 2FA/TOTP disable service.
    throwHttpError("COMMON.NOT_IMPLEMENTED");
  },
);

/**
 * POST /api/auth/recovery/verify-backup-code
 * Verifies a TOTP code or backup code during recovery.
 * Uses the existing AuthTOTPValidationService which handles multiple 2FA devices.
 */
export const recoveryVerifyBackupCodeHandler = defineHandler(
  {
    route: recoveryVerifyBackupCodeRoute,
    operationName: "auth_recovery_verify_backup_code",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRecoveryVerifyBackupCodeResponse,
  },
  async ({ body }) => {
    const { recoveryToken, emailToken, twoFaCode, backupCode } = body;
    const recoveryService = getAccountRecoveryService();
    const result = await recoveryService.verify2FA(recoveryToken, emailToken, twoFaCode, backupCode);
    return { data: result, status: 200 as const };
  },
);

/**
 * POST /api/auth/recovery/send-reset-email
 * Sends account recovery email (delegates to initiateRecovery for email identifiers)
 */
export const recoverySendResetEmailHandler = defineHandler(
  {
    route: recoverySendResetEmailRoute,
    operationName: "auth_recovery_send_reset_email",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRecoverySendResetEmailResponse,
  },
  async ({ body }) => {
    const { email } = body;
    const recoveryService = getAccountRecoveryService();

    // Re-use initiateRecovery for email path which already handles sending reset email
    await recoveryService.initiateRecovery(email);

    // Always return success to prevent email enumeration
    return { data: { success: true }, status: 200 as const };
  },
);

/**
 * POST /api/auth/recovery/verify-email-token
 * Validates an email recovery token
 */
export const recoveryVerifyEmailTokenHandler = defineHandler(
  {
    route: recoveryVerifyEmailTokenRoute,
    operationName: "auth_recovery_verify_email_token",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRecoveryVerifyEmailTokenResponse,
  },
  async ({ body }) => {
    const { emailToken } = body;
    const recoveryService = getAccountRecoveryService();
    const result = await recoveryService.validateEmailToken(emailToken);
    return { data: result, status: 200 as const };
  },
);
