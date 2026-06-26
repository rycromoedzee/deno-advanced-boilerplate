/**
 * @file handlers/user/recovery-phrase.handler.ts
 * @description Handlers for user recovery phrase management routes
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  createRecoveryPhraseRoute,
  deleteRecoveryPhraseRoute,
  getRecoveryPhraseStatusRoute,
  resetRecoveryPhraseRoute,
  verifyRecoveryPhraseRoute,
} from "@routes/user/recovery-phrase.route.ts";
import { getRecoveryPhraseCreateService, getRecoveryPhraseValidateService } from "@services/user/index.ts";
import {
  SchemaRecoveryPhraseCreateResponse,
  SchemaRecoveryPhraseDeleteResponse,
  SchemaRecoveryPhraseResetResponse,
  SchemaRecoveryPhraseStatusResponse,
  SchemaRecoveryPhraseVerifyResponse,
} from "@models/users/index.ts";

const recoveryPhraseCreateService = getRecoveryPhraseCreateService();
const recoveryPhraseValidateService = getRecoveryPhraseValidateService();

/**
 * Handler for getting recovery phrase status
 */
export const getRecoveryPhraseStatusHandler = defineHandler(
  {
    route: getRecoveryPhraseStatusRoute,
    operationName: "recovery_phrase_status",
    entityType: "recovery-phrase",
    loggerSection: loggerAppSections.USER_ENCRYPTED,
    responseSchema: SchemaRecoveryPhraseStatusResponse,
  },
  async ({ userId }) => {
    const metadata = await recoveryPhraseValidateService.getRecoveryPhraseMetadata(
      userId,
    );

    if (!metadata) {
      return {
        data: {
          hasRecoveryPhrase: false,
          isVerified: false,
        },
        status: 200,
      };
    }

    return {
      data: {
        hasRecoveryPhrase: metadata.hasRecoveryPhrase,
        isVerified: metadata.isVerified,
        createdAt: metadata.createdAt,
        verifiedAt: metadata.verifiedAt,
      },
      status: 200,
    };
  },
);

/**
 * Handler for creating a new recovery phrase
 */
export const createRecoveryPhraseHandler = defineHandler(
  {
    route: createRecoveryPhraseRoute,
    operationName: "recovery_phrase_create",
    entityType: "recovery-phrase",
    loggerSection: loggerAppSections.USER_ENCRYPTED,
    responseSchema: SchemaRecoveryPhraseCreateResponse,
  },
  async ({ userId }) => {
    const recoveryPhrase = await recoveryPhraseCreateService
      .createNewRecoveryPhraseForUser(userId);

    return {
      data: {
        recoveryPhrase,
        message: "Recovery phrase created successfully. Save this phrase securely - it will not be shown again.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for verifying a recovery phrase
 */
export const verifyRecoveryPhraseHandler = defineHandler(
  {
    route: verifyRecoveryPhraseRoute,
    operationName: "recovery_phrase_verify",
    entityType: "recovery-phrase",
    loggerSection: loggerAppSections.USER_ENCRYPTED,
    responseSchema: SchemaRecoveryPhraseVerifyResponse,
  },
  async ({ userId, body }) => {
    const { recoveryPhrase } = body as { recoveryPhrase: string };

    const isValid = await recoveryPhraseValidateService.validatePhraseProvidedByUser(
      userId,
      recoveryPhrase,
    );

    return {
      data: {
        isValid,
        message: isValid ? "Recovery phrase verified successfully" : "Invalid recovery phrase",
      },
      status: 200,
    };
  },
);

/**
 * Handler for resetting recovery phrase
 */
export const resetRecoveryPhraseHandler = defineHandler(
  {
    route: resetRecoveryPhraseRoute,
    operationName: "recovery_phrase_reset",
    entityType: "recovery-phrase",
    loggerSection: loggerAppSections.USER_ENCRYPTED,
    responseSchema: SchemaRecoveryPhraseResetResponse,
  },
  async ({ userId, body }) => {
    const { currentPhrase: _currentPhrase } = body as { currentPhrase: string };

    // NOTE: currentPhrase is accepted in the request body for future verification
    // but is not validated against the stored phrase by design — recovery flows
    // allow phrase reset without proving knowledge of the current phrase. If this
    // policy should be stricter, add verification here against
    // RecoveryPhraseValidateService.
    const newPhrase = await recoveryPhraseCreateService.resetRecoveryPhrase(
      userId,
    );

    return {
      data: {
        recoveryPhrase: newPhrase,
        message: "Recovery phrase reset successfully. Save this new phrase securely - it will not be shown again.",
      },
      status: 200,
    };
  },
);

/**
 * Handler for deleting recovery phrase
 */
export const deleteRecoveryPhraseHandler = defineHandler(
  {
    route: deleteRecoveryPhraseRoute,
    operationName: "recovery_phrase_delete",
    entityType: "recovery-phrase",
    loggerSection: loggerAppSections.USER_ENCRYPTED,
    responseSchema: SchemaRecoveryPhraseDeleteResponse,
  },
  async ({ userId }) => {
    await recoveryPhraseValidateService.removePhrase(userId);

    return {
      data: {
        success: true,
        message: "Recovery phrase deleted successfully. Enhanced encryption features may be impacted.",
      },
      status: 200,
    };
  },
);
