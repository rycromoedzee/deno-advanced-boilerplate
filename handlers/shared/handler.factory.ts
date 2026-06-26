/**
 * @file handlers/shared/handler.factory.ts
 * @description Universal handler factory for consistent API handlers
 */

import type { HonoContext, RouteConfig, RouteHandler } from "@deps";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getAuthContext } from "@utils/auth/context.ts";
import { getTraceContext } from "@services/tracing/index.ts";
import { ensureMinimumProcessingTime } from "@utils/shared/timing.ts";
import type { HandlerConfig, HandlerContext, HandlerResponse } from "./types.ts";
import { getDefaultErrorKey } from "./helpers.ts";

/**
 * Minimal view of @hono/zod-openapi's typed request. `c` is a plain HonoContext at this
 * layer (the typed env is not threaded through defineHandler), so we narrow `c.req` to
 * this precise shape to reach `.valid()` instead of casting to `any`.
 */
type ValidatableRequest = {
  valid(target: "param" | "query"): Record<string, unknown>;
  valid(target: "json"): unknown;
};

function getValidatedParams(c: HonoContext, mode: "soft" | "strict"): Record<string, unknown> {
  const req = c.req as unknown as ValidatableRequest;
  if (req.valid && typeof req.valid === "function") {
    if (mode === "strict") {
      return req.valid("param") || {};
    }
    try {
      return req.valid("param") || {};
    } catch {
      return {};
    }
  }
  return {};
}

async function getValidatedBody(c: HonoContext, mode: "soft" | "strict"): Promise<unknown> {
  if (c.req.method === "GET" || c.req.method === "HEAD") {
    return undefined;
  }

  const req = c.req as unknown as ValidatableRequest;
  if (req.valid && typeof req.valid === "function") {
    if (mode === "strict") {
      return await req.valid("json");
    }
    try {
      return await req.valid("json");
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function getValidatedQuery(c: HonoContext, mode: "soft" | "strict"): Record<string, unknown> {
  const req = c.req as unknown as ValidatableRequest;
  if (req.valid && typeof req.valid === "function") {
    if (mode === "strict") {
      return req.valid("query") || {};
    }
    try {
      return req.valid("query") || {};
    } catch {
      return {};
    }
  }
  return {};
}

/**
 * Creates a standardized handler with improved API
 */
export function defineHandler<TRoute extends RouteConfig>(
  config: HandlerConfig<TRoute>,
  handler: (context: HandlerContext<TRoute>) => Promise<HandlerResponse>,
  // RouteHandler<TRoute> requires the returned Response to satisfy the route's
  // typed-response contract; this factory shapes responses generically via c.json/c.body,
  // so the strict generic cannot be expressed. Documented escape-hatch — see
  // plans/refactor-review-log.md (R2-C residue).
  // deno-lint-ignore no-explicit-any
): RouteHandler<any> {
  const {
    route,
    operationName,
    entityType,
    timingProfile,
    authContext = true,
    errorKey,
    loggerSection = loggerAppSections.INTERNAL,
    responseSchema,
    validationMode = "strict",
    errorHandler,
  } = config;

  const resolvedErrorKey = errorKey || getDefaultErrorKey(operationName, entityType);

  const hasRouteConfig = Boolean(route);
  const shouldValidateParams = route?.request?.params !== undefined || !hasRouteConfig;
  const shouldValidateQuery = route?.request?.query !== undefined || !hasRouteConfig;
  const shouldValidateBody = route?.request?.body !== undefined || !hasRouteConfig;

  return async (c) => {
    const requestStartTime = performance.now();
    const traceService = getTraceContext();

    let params: Record<string, unknown> = {};
    let userId: string | undefined;
    let environmentId: string | undefined;
    let isAdmin: boolean | undefined;
    let firstName: string | undefined;
    let lastName: string | undefined;
    let fullName: string | undefined;

    try {
      if (shouldValidateParams) {
        params = getValidatedParams(c, validationMode);
      }

      if (authContext) {
        const authData = getAuthContext(c);
        userId = authData.userId;
        environmentId = authData.environmentId;
        isAdmin = authData.isAdmin;
        firstName = authData.firstName;
        lastName = authData.lastName;
        fullName = authData.fullName;
      }

      const body = shouldValidateBody ? await getValidatedBody(c, validationMode) : undefined;
      const query = shouldValidateQuery ? getValidatedQuery(c, validationMode) : {};

      const context: HandlerContext<TRoute> = {
        userId: userId!,
        environmentId: environmentId!,
        isAdmin: isAdmin!,
        firstName: firstName!,
        lastName: lastName!,
        fullName: fullName!,
        // The validators return Record<string,unknown>/unknown; the route's inferred
        // param/body/query shapes (HandlerContext<TRoute>) can't be reconstructed without
        // threading TRoute through them, so narrow via the indexed target type.
        params: params as unknown as HandlerContext<TRoute>["params"],
        body: body as unknown as HandlerContext<TRoute>["body"],
        query: query as unknown as HandlerContext<TRoute>["query"],
        traceService,
        c,
        requestStartTime,
      };

      traceService.addBreadcrumb("handler", `${operationName} started`, "info", {
        entityType,
        entityId: (params as Record<string, unknown>)?.id,
        userId,
      });

      const result = await handler(context);

      traceService.addBreadcrumb("handler", `${operationName} completed`, "info", {
        entityType,
        entityId: (params as Record<string, unknown>)?.id,
      });

      c.status(result.status as unknown as Parameters<typeof c.status>[0]);

      if (result.headers) {
        Object.entries(result.headers).forEach(([key, value]) => {
          c.header(key, value);
        });
      }

      if (result.status === 204) {
        return c.body(null);
      }

      const responseData = responseSchema ? responseSchema.parse(result.data) : result.data;
      return c.json(responseData);
    } catch (error) {
      if (timingProfile) {
        await ensureMinimumProcessingTime(requestStartTime, timingProfile);
      }

      if (error instanceof AppHttpException) {
        // Server-side faults (5xx) must never be silent: an AppHttpException is
        // otherwise treated as "already handled" by every layer and re-thrown
        // untouched, so a real 500 would surface to the client with zero logs.
        // Expected client errors (4xx) stay quiet. Skip if a lower layer already
        // logged this failure (see `_serviceErrorLogged` in handleServiceErrorAsync).
        if (error.status >= 500 && !error._serviceErrorLogged) {
          await useLogger(LoggerLevels.error, {
            message: `${operationName} failed`,
            section: loggerSection,
            messageKey: error.messageKey ?? `${operationName}_error`,
            details: {
              statusCode: error.status,
              error: error.message,
              cause: error.cause instanceof Error
                ? { name: error.cause.name, message: error.cause.message, stack: error.cause.stack }
                : error.cause,
              entityType,
              params,
              userId,
              environmentId,
              method: c.req.method,
              path: c.req.path,
            },
          });
        }
        throw error;
      }

      if (errorHandler) {
        const maybeResponse = await errorHandler(error, {
          operationName,
          entityType,
          requestStartTime,
          params,
          userId,
          environmentId,
          errorKey: resolvedErrorKey,
          loggerSection: loggerSection,
          c,
          traceService,
        });
        if (maybeResponse) {
          return maybeResponse;
        }
      }

      await useLogger(LoggerLevels.error, {
        message: `${operationName} failed`,
        section: loggerSection,
        messageKey: `${operationName}_error`,
        details: {
          error: error instanceof Error ? error.message : String(error),
          entityType,
          params,
          method: c.req.method,
          path: c.req.path,
        },
      });

      throwHttpError(resolvedErrorKey as unknown as Parameters<typeof throwHttpError>[0]);
    }
  };
}
