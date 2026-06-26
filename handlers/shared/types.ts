/**
 * @file handlers/shared/types.ts
 * @description Shared type definitions for universal handlers
 */

import type { HonoContext, RouteConfig, z } from "@deps";
import type { TraceContextService } from "@services/tracing/index.ts";
import type { TimingProfile } from "@utils/shared/timing.ts";
import type { loggerAppSections } from "@logger/types.ts";

/**
 * Entity types supported by the handler system
 *
 * NOTE: Additional entity strings are allowed via the string intersection.
 */
export type EntityType =
  | "document"
  | "folder"
  | "comment"
  | "document_comment"
  | "tag"
  | "user"
  | "env_config_user"
  | "environment_config_user"
  // `string & {}` is a TypeScript idiom that preserves literal-union autocomplete
  // while still accepting arbitrary strings. `ban-types` flags the empty `{}`;
  // the Record-based alternatives collapse the intersection and break the type,
  // so we keep the idiom and suppress the rule here.
  // deno-lint-ignore ban-types
  | (string & {});

// =====================
// Route Type Inference
// =====================
type RequestTypes = {
  body?: {
    content?: Record<string, { schema?: z.ZodTypeAny }>;
  };
  params?: z.ZodTypeAny;
  query?: z.ZodTypeAny;
};

type IsJson<T> = T extends string
  ? T extends `application/${infer Start}json${infer _End}` ? Start extends "" | `${string}+` | `vnd.${string}+` ? "json"
    : never
  : never
  : never;

type JsonContentKeys<T> = {
  [K in keyof T]: K extends string ? (IsJson<K> extends never ? never : K) : never;
}[keyof T];

type ExtractJsonSchema<T> = JsonContentKeys<T> extends infer K ? K extends keyof T ? T[K] extends { schema?: infer S } ? S
    : never
  : never
  : never;

type RouteParams<R extends RouteConfig> = R["request"] extends RequestTypes
  ? R["request"]["params"] extends z.ZodTypeAny ? z.output<R["request"]["params"]>
  : Record<string, string>
  : Record<string, string>;

type RouteQuery<R extends RouteConfig> = R["request"] extends RequestTypes
  ? R["request"]["query"] extends z.ZodTypeAny ? z.output<R["request"]["query"]>
  : Record<string, string | string[] | undefined>
  : Record<string, string | string[] | undefined>;

type BodyConfig<R extends RouteConfig> = R["request"] extends RequestTypes ? R["request"]["body"]
  : undefined;

type BodyContent<R extends RouteConfig> = BodyConfig<R> extends { content?: infer C } ? C : undefined;

type RouteBody<R extends RouteConfig> = BodyContent<R> extends Record<string, { schema?: z.ZodTypeAny }>
  ? ExtractJsonSchema<BodyContent<R>> extends z.ZodTypeAny ? z.output<ExtractJsonSchema<BodyContent<R>>>
  : unknown
  : undefined;

/**
 * Standard HTTP status codes used by handlers
 */
export type HandlerStatus = 200 | 201 | 202 | 204 | 400 | 401 | 403 | 404 | 409 | 422 | 500;

/**
 * Handler context containing all necessary information for handler execution
 */
export interface HandlerContext<TRoute extends RouteConfig = RouteConfig> {
  /** Authenticated user ID */
  userId: string;

  /** Environment ID for multi-tenancy */
  environmentId: string;

  /** Whether the user is an admin */
  isAdmin: boolean;

  /** User's first name */
  firstName: string;

  /** User's last name */
  lastName: string;

  /** User's full name */
  fullName: string;

  /** Route parameters (from URL path) */
  params: RouteParams<TRoute>;

  /** Request body (from JSON payload) */
  body: RouteBody<TRoute>;

  /** Query parameters (from URL query string) */
  query: RouteQuery<TRoute>;

  /** Trace service for distributed tracing */
  traceService: TraceContextService;

  /** Original Hono context */
  c: HonoContext;

  /** Request start time for timing protection */
  requestStartTime: number;
}

/**
 * Standardized handler response
 */
export interface HandlerResponse<T = unknown> {
  /** Response data */
  data?: T;

  /** HTTP status code */
  status: HandlerStatus;

  /** Optional response headers */
  headers?: Record<string, string>;
}

/**
 * Error context for error handling hooks
 */
export interface ErrorContext<TRoute extends RouteConfig = RouteConfig> {
  operationName: string;
  entityType: EntityType;
  requestStartTime: number;
  params?: Record<string, unknown>;
  userId?: string;
  environmentId?: string;
  errorKey?: string;
  loggerSection?: loggerAppSections;
  c: HonoContext;
  traceService: TraceContextService;
}

export type HandlerErrorHandler<TRoute extends RouteConfig = RouteConfig> = (
  error: unknown,
  context: ErrorContext<TRoute>,
) => Promise<Response | void> | Response | void;

/**
 * Handler configuration (without the handler implementation)
 */
export interface HandlerConfig<TRoute extends RouteConfig = RouteConfig> {
  /** Route configuration for type inference */
  route?: TRoute;

  /** Operation name for logging and tracing */
  operationName: string;

  /** Entity type for logging section determination */
  entityType: EntityType;

  /** Timing profile for timing attack protection */
  timingProfile?: TimingProfile;

  /**
   * Whether to pull auth context into HandlerContext (default: true).
   * When true, getAuthContext(c) runs and HandlerContext is fully populated
   * (userId, environmentId, isAdmin, names). When false, auth context is not
   * read — use for routes the auth middleware skips (public/auth/webhooks).
   */
  authContext?: boolean;

  /** Custom error key for error handling */
  errorKey?: string;

  /** Logger section for this handler */
  loggerSection: loggerAppSections;

  /** Optional response schema for validation */
  responseSchema?: { parse: (data: unknown) => unknown };

  /**
   * Validation mode for req.valid() calls
   * - "soft": swallow validation errors and return empty data
   * - "strict": surface validation errors to the handler error pipeline (default)
   */
  validationMode?: "soft" | "strict";

  /**
   * Optional error handler hook for custom error responses
   * Return a Response to short-circuit the default error handling.
   */
  errorHandler?: HandlerErrorHandler<TRoute>;
}
