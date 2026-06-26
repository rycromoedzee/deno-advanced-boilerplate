/**
 * @file handlers/webhooks/webhooks.handler.ts
 * @description Handler for email status webhook endpoint with Svix signature verification
 */

import { Buffer, hmac, HTTPException, sha256 } from "@deps";
import { defineHandler } from "@handlers/shared/handler.factory.ts";
import { ensureMinimumProcessingTime, safeEqual, TIMING_PROFILES } from "@utils/shared/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger, useLoggerGenerateLogContext, useLogSecurityEvent } from "@logger/index.ts";
import { envConfig } from "@config/env.ts";
import { IPLookupUtils } from "@utils/network/index.ts";
import { getEmailStatusService, ResendWebhookPayload } from "@services/mailer/index.ts";
import { RESEND_IP_LIST } from "@interfaces/email.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { getTimeNow } from "@utils/shared/index.ts";
import { emailStatusRoute } from "@routes/webhooks/webhooks.route.ts";
import { SchemaEmailStatusResponse } from "@models/webhooks/index.ts";

const SVIX_MAX_AGE_SECONDS = 5 * 60;

/**
 * Handler for email status webhook endpoint
 */
export const emailStatusHandler = defineHandler(
  {
    route: emailStatusRoute,
    operationName: "email_status_webhook",
    entityType: "webhook",
    loggerSection: loggerAppSections.EMAIL_WEBHOOK,
    authContext: false,
    responseSchema: SchemaEmailStatusResponse,
    validationMode: "soft",
    errorHandler: async (error, { requestStartTime }) => {
      if (error instanceof HTTPException) {
        await useLogger(LoggerLevels.warn, {
          section: loggerAppSections.EMAIL_WEBHOOK,
          messageKey: "webhook.http.exception",
          message: "Webhook => HTTP exception occurred",
          details: {
            status: error.status,
            message: error.message,
          },
        });

        await ensureMinimumProcessingTime(
          requestStartTime,
          TIMING_PROFILES.STANDARD,
        );

        return new Response(
          JSON.stringify({ success: false, correlationId: crypto.randomUUID() }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
    },
  },
  async ({ c, requestStartTime }) => {
    const correlationId = crypto.randomUUID();
    let payload: unknown;

    const tokenValidationStartTime = performance.now();

    const requestContext = IPLookupUtils.getRequestContext(c);

    const url = new URL(c.req.url);
    const urlPath = url.pathname;
    const token = c.req.param("token");

    const isValidToken = token ? safeEqual(envConfig.mail.webhookToken!, token) : false;
    if (!isValidToken) {
      await useLogSecurityEvent(
        LoggerLevels.warn,
        "Webhook => Security validation failed - Invalid token or path",
        "medium",
        loggerAppSections.EMAIL_WEBHOOK,
        "webhook.security.invalid",
        {
          correlationId,
          path: urlPath,
          userAgent: requestContext.headers["user-agent"] || "unknown",
          remoteAddress: requestContext.ip,
        },
        useLoggerGenerateLogContext(c),
      );

      await ensureMinimumProcessingTime(
        tokenValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );

      throwHttpError("COMMON.NOT_FOUND");
    }

    if (!RESEND_IP_LIST.includes(requestContext.ip)) {
      await useLogSecurityEvent(
        LoggerLevels.critical,
        "Webhook => Email webhook blocked by IP address",
        "critical",
        loggerAppSections.EMAIL_WEBHOOK,
        "webhook.security.ip-blocked",
        {
          correlationId,
          path: urlPath,
          userAgent: requestContext.headers["user-agent"] || "unknown",
          remoteAddress: requestContext.ip,
        },
        useLoggerGenerateLogContext(c),
      );

      await ensureMinimumProcessingTime(
        requestStartTime,
        TIMING_PROFILES.STANDARD,
      );

      throwHttpError("COMMON.NOT_FOUND");
    }

    // Grab svix headers
    const svixId = c.req.header("svix-id");
    const svixTimestamp = c.req.header("svix-timestamp");
    const svixSignature = c.req.header("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      await useLogger(LoggerLevels.warn, {
        section: loggerAppSections.EMAIL_WEBHOOK,
        messageKey: "webhook.header.incomplete",
        message: "Webhook => Email headers incomplete",
        details: {
          correlationId,
          contentLength: c.req.header("content-length") || "unknown",
          userAgent: requestContext.headers["user-agent"] || "unknown",
          remoteAddress: requestContext.ip,
        },
      });

      await ensureMinimumProcessingTime(
        tokenValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );

      throwHttpError("COMMON.NOT_FOUND", "common.invalid-header-payload");
    }

    const timestampSeconds = Number(svixTimestamp);
    const nowSeconds = Math.floor(getTimeNow() / 1000);
    if (!Number.isFinite(timestampSeconds)) {
      await ensureMinimumProcessingTime(
        tokenValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );
      throwHttpError("COMMON.NOT_FOUND", "common.invalid-header-payload");
    }

    if (Math.abs(nowSeconds - timestampSeconds) > SVIX_MAX_AGE_SECONDS) {
      await useLogSecurityEvent(
        LoggerLevels.warn,
        "Webhook => Email webhook rejected due to stale timestamp",
        "medium",
        loggerAppSections.EMAIL_WEBHOOK,
        "webhook.security.timestamp-stale",
        {
          correlationId,
          path: urlPath,
          userAgent: requestContext.headers["user-agent"] || "unknown",
          remoteAddress: requestContext.ip,
          timestamp: timestampSeconds,
          now: nowSeconds,
        },
        useLoggerGenerateLogContext(c),
      );

      await ensureMinimumProcessingTime(
        tokenValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );

      throwHttpError("COMMON.NOT_FOUND", "common.invalid-header-payload");
    }

    try {
      const rawBody = await c.req.text();
      if (!rawBody) {
        await ensureMinimumProcessingTime(
          tokenValidationStartTime,
          TIMING_PROFILES.STANDARD,
        );

        return { data: { success: false, correlationId }, status: 200 as const };
      }

      payload = JSON.parse(rawBody);
    } catch {
      await ensureMinimumProcessingTime(
        tokenValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );

      return { data: { success: false, correlationId }, status: 200 as const };
    }

    const signatureValidationStartTime = performance.now();

    const mailContent = `${svixId}.${svixTimestamp}.${JSON.stringify(payload)}`;

    const key = Buffer.from(
      (envConfig.mail.svixSecret as string).replace(/^whsec_/, ""),
      "base64",
    );

    const preDigest = hmac.create(sha256, key).update(Buffer.from(mailContent)).digest();
    const digest = Buffer.from(preDigest).toString("base64");

    const signatures = svixSignature!
      .split(" ")
      .filter((s) => s.startsWith("v1,"))
      .map((s) => s.slice(3));

    const isValid = signatures.some((sig) => {
      try {
        return safeEqual(digest, sig);
      } catch {
        return false;
      }
    });

    await ensureMinimumProcessingTime(
      signatureValidationStartTime,
      TIMING_PROFILES.STANDARD,
    );

    if (!isValid) {
      await useLogSecurityEvent(
        LoggerLevels.critical,
        "Webhook => Email webhook invalid email signature",
        "critical",
        loggerAppSections.EMAIL_WEBHOOK,
        "webhook.security.email.invalid-signature",
        {
          correlationId,
          path: urlPath,
          userAgent: requestContext.headers["user-agent"] || "unknown",
          remoteAddress: requestContext.ip,
        },
        useLoggerGenerateLogContext(c),
      );

      return { data: { success: false, correlationId }, status: 200 as const };
    }

    const cache = await getCache();
    const replayKey = `svix:${svixId}`;
    const existingReplay = await cache.get<string>(
      CACHE_NAMESPACES.WEBHOOKS.EMAIL_STATUS,
      replayKey,
    );

    if (existingReplay) {
      await useLogSecurityEvent(
        LoggerLevels.warn,
        "Webhook => Replay detected for email webhook",
        "high",
        loggerAppSections.EMAIL_WEBHOOK,
        "webhook.security.replay-detected",
        {
          correlationId,
          path: urlPath,
          svixId,
          remoteAddress: requestContext.ip,
        },
        useLoggerGenerateLogContext(c),
      );

      await ensureMinimumProcessingTime(
        signatureValidationStartTime,
        TIMING_PROFILES.STANDARD,
      );

      return { data: { success: false, correlationId }, status: 200 as const };
    }

    await cache.set(
      CACHE_NAMESPACES.WEBHOOKS.EMAIL_STATUS,
      replayKey,
      "1",
      { ttl: SVIX_MAX_AGE_SECONDS },
    );

    // Process webhook event using EmailStatusService
    const emailStatusService = getEmailStatusService();

    try {
      await emailStatusService.processWebhookEvent(
        payload as ResendWebhookPayload,
      );

      await ensureMinimumProcessingTime(
        requestStartTime,
        TIMING_PROFILES.STANDARD,
      );

      return { data: { success: true, correlationId }, status: 200 as const };
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        section: loggerAppSections.EMAIL_WEBHOOK,
        messageKey: "webhook.processing.failed",
        message: "Webhook => Event processing failed",
        details: {
          correlationId,
          error: error instanceof Error ? error.message : String(error),
        },
      });

      await ensureMinimumProcessingTime(
        requestStartTime,
        TIMING_PROFILES.STANDARD,
      );

      return { data: { success: false, correlationId }, status: 200 as const };
    }
  },
);
