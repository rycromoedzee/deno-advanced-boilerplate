/**
 * @file utils/http-exception.ts
 * @description AppHttpException type and throwHttpError helper
 */
import { HTTPException as HonoHTTPException, z } from "@deps";
import type { AllErrorKeys } from "@constants/errors/index.ts";
import { createCustomError, getErrorDefinition } from "@constants/errors/index.ts";
import { envConfig } from "@config/env.ts";

/**
 * Custom HTTPException that supports a messageKey for i18n/translation.
 */
export class AppHttpException extends HonoHTTPException {
  messageKey?: string;
  /**
   * Internal marker set by `handleServiceErrorAsync` when it logs an
   * unexpected error before wrapping it as an AppHttpException. Outer
   * service boundaries check this flag to avoid emitting a duplicate
   * ERROR event for the same failure.
   * @internal
   */
  _serviceErrorLogged?: boolean;
  constructor(
    status: number,
    options: {
      message?: string;
      messageKey?: string;
      cause?: unknown;
      res?: Response;
    },
  ) {
    // @ts-expect-error - Hono's HTTPException expects specific status code types
    super(status, { ...options });
    this.messageKey = options.messageKey;
  }

  /**
   * Ensure consistent JSON error responses that include messageKey when available.
   */
  override getResponse(): Response {
    if (this.res) {
      return this.res;
    }

    const payload: Record<string, unknown> = {
      message: this.message,
      statusCode: this.status,
    };

    if (this.messageKey) {
      payload.messageKey = this.messageKey;
    }

    if (!envConfig.isProduction && this.cause !== undefined) {
      if (this.cause instanceof Error) {
        payload.cause = {
          name: this.cause.name,
          message: this.cause.message,
          stack: this.cause.stack,
        };
      } else {
        payload.cause = this.cause;
      }
    }

    if (!envConfig.isProduction && this.stack) {
      payload.stack = this.stack;
    }

    return new Response(JSON.stringify(payload), {
      status: this.status,
      headers: {
        "content-type": "application/json",
      },
    });
  }
}

/**
 * Zod schema for HTTP exception options - matches AppHttpException constructor options 1:1
 */
export const ZodHttpExceptionSchema = z.object({
  message: z.string().optional(),
  messageKey: z.string().optional(),
  cause: z.unknown().optional(),
  res: z.any().optional().openapi({
    type: "object",
    description: "HTTP Response object",
  }),
});

/**
 * @deprecated Use error constants from @constants/errors.ts instead
 */
export type IHttpCommonErrorKey = keyof typeof HTTP_EXCEPTION_COMMON_ERRORS;
export const HTTP_EXCEPTION_COMMON_ERRORS: Record<
  string,
  { message: string; messageKey: string }
> = {
  UNAUTHORIZED: {
    message: "Unauthorized",
    messageKey: "auth.not-authorized",
  },
};

/**
 * Throw HTTP exception using predefined error constants
 * @param errorKey Error key from error constants (e.g., 'AUTH.UNAUTHORIZED')
 * @param cause Optional cause of the error
 * @param res Optional response object
 * @throws AppHttpException
 */
export function throwHttpError(
  errorKey: AllErrorKeys,
  causeReason?: unknown,
  response?: Response,
): never {
  const cause = envConfig.isProduction ? undefined : causeReason;
  const res = envConfig.isProduction ? undefined : response;

  let error;
  try {
    error = getErrorDefinition(errorKey);
  } catch (lookupError) {
    // Defense-in-depth: if the requested error key is missing we must not
    // surface a TypeError/plain Error from the error handler itself. Log it
    // and fall back to a generic 500 so callers still get a well-formed
    // AppHttpException response.
    console.error(
      `[throwHttpError] Unknown error key "${errorKey}" — falling back to COMMON.INTERNAL_SERVER_ERROR`,
      lookupError,
    );
    error = getErrorDefinition("COMMON.INTERNAL_SERVER_ERROR");
  }

  throw new AppHttpException(error.statusCode, {
    message: error.message,
    messageKey: error.messageKey,
    cause,
    res,
  });
}

/**
 * Throw an HTTP exception with a DYNAMIC message layered on a standard error key.
 *
 * The base key's `messageKey` (what the frontend translates) and `statusCode` are
 * preserved; only the free-text `message` is overridden. Use this ONLY to attach
 * runtime detail that cannot live in a static constant — the `customMessage`
 * argument MUST be a template literal containing `${...}` interpolation (e.g. an id,
 * count, or field name).
 *
 * For any STATIC message, add a proper error key (with its own messageKey) to
 * `constants/errors/` and call `throwHttpError("YOUR.NEW_KEY")` instead. This is
 * enforced by the `no-static-custom-http-error-message` ESLint rule.
 *
 * @param errorKey Base error key from error constants
 * @param customMessage Dynamic message — must contain ${...} interpolation
 * @param cause Optional cause of the error
 * @param res Optional response object
 * @throws AppHttpException
 */
export function throwHttpErrorWithCustomMessage(
  errorKey: AllErrorKeys,
  customMessage: string,
  causeReason?: unknown,
  res?: Response,
): never {
  const cause = envConfig.isProduction ? undefined : causeReason;

  const error = createCustomError(errorKey, customMessage);
  throw new AppHttpException(error.statusCode, {
    message: error.message,
    messageKey: error.messageKey,
    cause,
    res,
  });
}

/**
 * Create an HTTP exception without throwing it
 * @param errorKey Error key from error constants
 * @param cause Optional cause of the error
 * @param res Optional response object
 * @returns AppHttpException instance
 */
export function createHttpError(
  errorKey: AllErrorKeys,
  cause?: unknown,
  res?: Response,
): AppHttpException {
  const error = getErrorDefinition(errorKey);
  return new AppHttpException(error.statusCode, {
    message: error.message,
    messageKey: error.messageKey,
    cause,
    res,
  });
}
