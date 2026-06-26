/**
 * @file handlers/auth/register.handler.ts
 * @description Route handlers for user registration via token
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import type { RegistrationResponseJSON } from "@deps";
import { registerPasskeyVerifyRoute, registerRoute, registerValidateRoute } from "@routes/auth/register.route.ts";
import { getUserRegistrationService } from "@services/auth/index.ts";
import { useSetCookie, useSetSignedCookie } from "@utils/cookie.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { JWT_TOKEN_CONFIG } from "@constants/token.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  SchemaRegisterPasskeyVerifyResponse,
  SchemaRegisterResponse,
  SchemaRegisterValidateResponse,
} from "@models/auth/auth-response.model.ts";

const registrationService = getUserRegistrationService();

/**
 * GET /api/auth/register/:token
 * Validates token and returns user info
 */
export const registerValidateHandler = defineHandler(
  {
    route: registerValidateRoute,
    operationName: "auth_register_validate",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRegisterValidateResponse,
  },
  async ({ params }) => {
    const { token } = params;

    const result = await registrationService.validateRegistrationToken(token);

    return { data: result, status: 200 as const };
  },
);

/**
 * POST /api/auth/register/:token
 * Handle registration with password or begin passkey flow
 */
export const registerHandler = defineHandler(
  {
    route: registerRoute,
    operationName: "auth_register",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRegisterResponse,
  },
  async ({ c, params, body }) => {
    const { token } = params;
    const { mode, password, username, displayName } = body;

    const requestContext = IPLookupUtils.getRequestContext(c);
    const url = new URL(c.req.url);
    const hostname = url.hostname;

    if (mode === "password") {
      if (!password) {
        throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
      }

      const result = await registrationService.registerWithPassword(
        token,
        password,
        {
          userAgent: requestContext.userAgent,
          accept: requestContext.headers["accept"] || "unknown",
          lang: requestContext.headers["Accept-Language"] || "unknown",
        },
        requestContext.ip,
        c,
      );

      // Set session cookies
      useSetCookie(
        c,
        AUTH_HEADER_NAMING.access,
        result.accessToken,
        JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
      );
      await useSetSignedCookie(
        c,
        AUTH_HEADER_NAMING.refresh,
        result.refreshToken,
        JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
      );

      return {
        data: {
          isAuthCompleted: true,
          message: result.message,
          userId: result.userId,
          environmentId: result.environmentId,
          displayName: result.displayName,
        },
        status: 200 as const,
      };
    }

    // mode === "passkey-begin"
    const result = await registrationService.beginPasskeyRegistration(
      token,
      hostname,
      {
        username,
        displayName,
      },
    );

    return {
      data: {
        isAuthCompleted: false,
        nextStep: "passkey-register",
        attemptId: result.attemptId,
        creationOptions: result.creationOptions,
      },
      status: 202 as const,
    };
  },
);

/**
 * POST /api/auth/register/:token/passkey
 * Verify passkey registration and complete setup
 */
export const registerPasskeyVerifyHandler = defineHandler(
  {
    route: registerPasskeyVerifyRoute,
    operationName: "auth_register_passkey_verify",
    entityType: "session",
    loggerSection: loggerAppSections.AUTH,
    authContext: false,
    responseSchema: SchemaRegisterPasskeyVerifyResponse,
  },
  async ({ c, params, body }) => {
    const { token } = params;
    const { attemptId, credential, prfOutput, username, displayName } = body;

    const requestContext = IPLookupUtils.getRequestContext(c);
    const url = c.req.url;
    const hostname = new URL(url).hostname;

    const result = await registrationService.verifyPasskeyRegistration(
      token,
      attemptId,
      credential as unknown as RegistrationResponseJSON,
      url,
      hostname,
      {
        userAgent: requestContext.userAgent,
        accept: requestContext.headers["accept"] || "unknown",
        lang: requestContext.headers["Accept-Language"] || "unknown",
      },
      requestContext.ip,
      c,
      prfOutput, // Pass PRF output for encryption key derivation
      username, // Pass optional username to set
      displayName, // Optional passkey display name
    );

    // Set session cookies
    useSetCookie(
      c,
      AUTH_HEADER_NAMING.access,
      result.accessToken,
      JWT_TOKEN_CONFIG.tokenTTL.authExpiration,
    );
    await useSetSignedCookie(
      c,
      AUTH_HEADER_NAMING.refresh,
      result.refreshToken,
      JWT_TOKEN_CONFIG.tokenTTL.refreshExpiration,
    );

    // PRF setup is always recommended for passkey-only registration since PRF output
    // is not available during WebAuthn registration (only during authentication)
    const prfSetupRecommended = !result.hasMasterKey;

    return {
      data: {
        isAuthCompleted: true,
        message: result.message,
        userId: result.userId,
        environmentId: result.environmentId,
        displayName: result.displayName,
        prfSetupRecommended,
      },
      status: 200 as const,
    };
  },
);
