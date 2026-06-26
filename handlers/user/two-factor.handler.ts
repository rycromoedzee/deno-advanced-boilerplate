/**
 * @file handlers/user/two-factor.handler.ts
 * @description Handlers for user two-factor authentication management routes
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  createTwoFactorRoute,
  deleteTwoFactorRoute,
  getTwoFactorStatusRoute,
  listTwoFactorRoute,
  regenerateBackupCodesRoute,
  revealTwoFactorRoute,
} from "@routes/user/two-factor.route.ts";
import { getUserTwoFactorService } from "@services/user/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import {
  SchemaTwoFactorBackupCodesResponse,
  SchemaTwoFactorCreateResponse,
  SchemaTwoFactorDeleteResponse,
  SchemaTwoFactorListResponse,
  SchemaTwoFactorRevealResponse,
  SchemaTwoFactorStatusResponse,
} from "@models/users/index.ts";

/**
 * Handler for listing 2FA devices
 */
export const listTwoFactorHandler = defineHandler(
  {
    route: listTwoFactorRoute,
    operationName: "two_factor_list",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorListResponse,
  },
  async ({ userId }) => {
    const devices = await getUserTwoFactorService().getUserTwoFactorSecrets(userId);

    return {
      data: { data: devices },
      status: 200,
    };
  },
);

/**
 * Handler for creating a new 2FA device
 */
export const createTwoFactorHandler = defineHandler(
  {
    route: createTwoFactorRoute,
    operationName: "two_factor_create",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorCreateResponse,
  },
  async ({ userId, body, c }) => {
    const { name, isPrimary, password } = body as {
      name: string;
      isPrimary: boolean;
      password: string;
    };

    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    const result = await getUserTwoFactorService().createTwoFactorSecret(
      userId,
      name,
      isPrimary,
      password,
      ipAddress,
      userAgent,
    );

    return {
      data: {
        secretId: result.secretId,
        uri: result.uri,
        backupCodes: result.backupCodes,
      },
      status: 200,
    };
  },
);

/**
 * Handler for deleting a 2FA device
 * Requires password verification and 2FA code from the device being removed
 */
export const deleteTwoFactorHandler = defineHandler(
  {
    route: deleteTwoFactorRoute,
    operationName: "two_factor_delete",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorDeleteResponse,
  },
  async ({ userId, params, body, c }) => {
    const { id } = params;
    const { password, twoFactorCode } = body as {
      password: string;
      twoFactorCode: string;
    };

    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    const result = await getUserTwoFactorService().removeTwoFactorSecret(
      userId,
      id,
      password,
      twoFactorCode,
      ipAddress,
      userAgent,
    );

    if (!result.success) {
      throwHttpError("COMMON.NOT_FOUND");
    }

    return {
      data: {
        success: true,
        message: result.wasLastDevice
          ? "2FA device removed successfully. Two-factor authentication has been disabled."
          : "2FA device removed successfully",
      },
      status: 200,
    };
  },
);

/**
 * Handler for regenerating backup codes
 * Requires password verification and a current backup code (which will be consumed)
 */
export const regenerateBackupCodesHandler = defineHandler(
  {
    route: regenerateBackupCodesRoute,
    operationName: "two_factor_backup_codes",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorBackupCodesResponse,
  },
  async ({ userId, body, c }) => {
    const { password, backupCode } = body;

    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    const result = await getUserTwoFactorService().regenerateBackupCodes(
      userId,
      password,
      backupCode,
      ipAddress,
      userAgent,
    );

    return {
      data: {
        backupCodes: result.backupCodes,
        message: "Backup codes regenerated successfully. Save these codes securely.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for getting 2FA status
 */
export const getTwoFactorStatusHandler = defineHandler(
  {
    route: getTwoFactorStatusRoute,
    operationName: "two_factor_status",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorStatusResponse,
  },
  async ({ userId }) => {
    const twoFactorService = getUserTwoFactorService();
    const isActive = await twoFactorService.isTwoFactorActive(userId);
    const activeDeviceCount = await twoFactorService.getActiveTwoFactorCount(userId);

    return {
      data: {
        isEnabled: isActive,
        activeDeviceCount,
        hasBackupCodes: isActive, // If 2FA is active, backup codes should exist
      },
      status: 200,
    };
  },
);

/**
 * Handler for revealing an existing 2FA secret
 * Requires password verification for security
 */
export const revealTwoFactorHandler = defineHandler(
  {
    route: revealTwoFactorRoute,
    operationName: "two_factor_reveal",
    entityType: "two-factor",
    loggerSection: loggerAppSections.AUTH,
    responseSchema: SchemaTwoFactorRevealResponse,
  },
  async ({ userId, params, body, c }) => {
    const { id } = params;
    const { password } = body as {
      password: string;
    };

    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    const result = await getUserTwoFactorService().revealTwoFactorSecret(
      userId,
      id,
      password,
      ipAddress,
      userAgent,
    );

    return {
      data: {
        secretId: result.secretId,
        name: result.name,
        uri: result.uri,
        secret: result.secret,
      },
      status: 200,
    };
  },
);
