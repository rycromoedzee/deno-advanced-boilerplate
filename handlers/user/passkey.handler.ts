/**
 * @file handlers/user/passkey.handler.ts
 * @description Handlers for user passkey management routes
 */

import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { loggerAppSections } from "@logger/index.ts";
import {
  addPasskeyBeginRoute,
  addPasskeyVerifyRoute,
  deletePasskeyRoute,
  listPasskeysRoute,
  passkeyPrfSetupBeginRoute,
  passkeyPrfSetupVerifyRoute,
  reauthPasskeyBeginRoute,
  reauthPasskeyVerifyRoute,
  reauthPasswordRoute,
} from "@routes/user/passkey.route.ts";
import { getPasskeyManagementService } from "@services/user/index.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { useGetCookie } from "@utils/cookie.ts";
import { tokenHashString } from "@services/token/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@deps";
import {
  SchemaPasskeyBeginResponse,
  SchemaPasskeyDeleteResponse,
  SchemaPasskeyListResponse,
  SchemaPasskeyPrfSetupBeginResponse,
  SchemaPasskeyPrfSetupVerifyResponse,
  SchemaPasskeyReauthBeginResponse,
  SchemaPasskeyReauthPasswordResponse,
  SchemaPasskeyReauthVerifyResponse,
  SchemaPasskeyVerifyResponse,
} from "@models/users/index.ts";

const passkeyService = getPasskeyManagementService();

const getAccessToken = (c: { req: { header: (name: string) => string | undefined } }): string | null => {
  const authHeader = c.req.header("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.replace("Bearer ", "").trim();
  }
  return null;
};

const requireBody = <T>(body: T | undefined): T => {
  if (!body) {
    throwHttpError("VALIDATION.REQUIRED_FIELD_MISSING");
  }
  return body;
};

/**
 * Converts an ArrayBuffer-like object (with numeric keys) to a base64 string.
 * WebAuthn PRF results are returned as ArrayBuffers which get serialized as
 * {"0": 194, "1": 248, ...} when sent over JSON.
 */
function arrayBufferLikeToBase64(bufferLike: unknown): string | undefined {
  if (!bufferLike || typeof bufferLike !== "object") {
    return undefined;
  }

  if (typeof bufferLike === "string") {
    return bufferLike;
  }

  const obj = bufferLike as Record<string, unknown>;
  const keys = Object.keys(obj).map(Number).filter((k) => !isNaN(k));

  if (keys.length === 0) {
    return undefined;
  }

  const maxKey = Math.max(...keys);
  const uint8Array = new Uint8Array(maxKey + 1);

  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "number") {
      uint8Array[key] = value;
    }
  }

  return btoa(String.fromCharCode(...uint8Array));
}

function extractPrfOutput(
  prfOutput: { first?: string } | undefined,
  clientExtensionResults: Record<string, unknown>,
): string | undefined {
  if (prfOutput?.first) {
    return prfOutput.first;
  }

  const extResults = clientExtensionResults as { prf?: { results?: { first?: unknown } } };
  const prfResults = extResults?.prf?.results;

  if (prfResults?.first) {
    return arrayBufferLikeToBase64(prfResults.first);
  }

  return undefined;
}

export const listPasskeysHandler = defineHandler(
  {
    route: listPasskeysRoute,
    operationName: "passkey_list",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyListResponse,
  },
  async ({ userId }) => {
    const result = await passkeyService.listPasskeys(userId);
    const passkeysRequirePrfSetup = result.length > 0 && result.some((p) => !p.hasPrf);
    return { data: { data: result, passkeysRequirePrfSetup }, status: 200 };
  },
);

export const addPasskeyBeginHandler = defineHandler(
  {
    route: addPasskeyBeginRoute,
    operationName: "passkey_begin",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyBeginResponse,
  },
  async ({ userId, c, body }) => {
    const payload = (body ?? {}) as { displayName?: string; username?: string };
    const hostname = new URL(c.req.url).hostname;
    const result = await passkeyService.beginAddPasskey(
      userId,
      hostname,
      { displayName: payload.displayName, username: payload.username },
    );
    return { data: result, status: 200 };
  },
);

export const addPasskeyVerifyHandler = defineHandler(
  {
    route: addPasskeyVerifyRoute,
    operationName: "passkey_verify",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyVerifyResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const hostname = new URL(c.req.url).hostname;

    const result = await passkeyService.verifyAddPasskey({
      userId,
      attemptId: payload.attemptId,
      credential: payload.credential as unknown as RegistrationResponseJSON,
      hostname,
      url: c.req.url,
      displayName: payload.displayName,
      username: payload.username,
      prfOutput: payload.prfOutput,
      reauthToken: payload.reauthToken,
      sessionId,
      ipAddress,
    });

    return { data: result, status: 200 };
  },
);

export const reauthPasswordHandler = defineHandler(
  {
    route: reauthPasswordRoute,
    operationName: "passkey_reauth_password",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyReauthPasswordResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "unknown";

    const result = await passkeyService.reauthWithPassword({
      userId,
      password: payload.password,
      sessionId,
      ipAddress,
      userAgent,
      purpose: payload.purpose,
    });

    return { data: result, status: 200 };
  },
);

export const reauthPasskeyBeginHandler = defineHandler(
  {
    route: reauthPasskeyBeginRoute,
    operationName: "passkey_reauth_begin",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyReauthBeginResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    const sessionId = accessToken ? tokenHashString(accessToken) : "";
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";
    const userAgent = c.req.header("user-agent") || "";
    const result = await passkeyService.beginPasskeyReauth({
      userId,
      sessionId,
      ipAddress,
      userAgent,
      purpose: payload.purpose,
    });

    return { data: result, status: 200 };
  },
);

export const reauthPasskeyVerifyHandler = defineHandler(
  {
    route: reauthPasskeyVerifyRoute,
    operationName: "passkey_reauth_verify",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyReauthVerifyResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);

    const result = await passkeyService.verifyPasskeyReauth({
      userId,
      attemptId: payload.attemptId,
      credential: payload.credential as unknown as AuthenticationResponseJSON,
      sessionId,
    });

    return { data: result, status: 200 };
  },
);

export const deletePasskeyHandler = defineHandler(
  {
    route: deletePasskeyRoute,
    operationName: "passkey_delete",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyDeleteResponse,
  },
  async ({ userId, c, params, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";

    await passkeyService.deletePasskey({
      userId,
      credentialId: params.id,
      sessionId,
      reauthToken: payload.reauthToken,
      ipAddress,
    });

    return { data: { success: true }, status: 200 };
  },
);

export const passkeyPrfSetupBeginHandler = defineHandler(
  {
    route: passkeyPrfSetupBeginRoute,
    operationName: "passkey_prf_setup_begin",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyPrfSetupBeginResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const hostname = new URL(c.req.url).hostname;

    const result = await passkeyService.beginPasskeyPrfSetup({
      userId,
      credentialId: payload.credentialId,
      hostname,
    });

    return { data: result, status: 200 };
  },
);

export const passkeyPrfSetupVerifyHandler = defineHandler(
  {
    route: passkeyPrfSetupVerifyRoute,
    operationName: "passkey_prf_setup_verify",
    entityType: "passkey",
    loggerSection: loggerAppSections.PASSKEYS,
    responseSchema: SchemaPasskeyPrfSetupVerifyResponse,
  },
  async ({ userId, c, body }) => {
    const payload = requireBody(body);
    const accessToken = getAccessToken(c) || useGetCookie(c, AUTH_HEADER_NAMING.access);
    if (!accessToken) {
      throwHttpError("AUTH.UNAUTHORIZED");
    }

    const sessionId = tokenHashString(accessToken);
    const ipAddress = IPLookupUtils.extractIPFromRequest(c) || "unknown";

    const extractedPrfOutput = extractPrfOutput(
      payload.prfOutput,
      (payload.credential?.clientExtensionResults ?? {}) as Record<string, unknown>,
    );

    const result = await passkeyService.verifyPasskeyPrfSetup({
      userId,
      attemptId: payload.attemptId,
      credential: payload.credential as unknown as AuthenticationResponseJSON,
      url: c.req.url,
      prfOutput: extractedPrfOutput ? { first: extractedPrfOutput } : undefined,
      reauthToken: payload.reauthToken,
      sessionId,
      ipAddress,
    });

    return { data: result, status: 200 };
  },
);
