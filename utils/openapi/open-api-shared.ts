/**
 * @file utils/openapi/open-api-shared.ts
 * @description Shared OpenAPI response/schema definitions
 */
// shared-responses.ts
import { z } from "@deps";

// Common error schema matching actual AppHttpException response
export const ErrorSchema = z.object({
  message: z.string().openapi({
    description: "Human-readable error message",
  }),
  messageKey: z.string().openapi({
    description: "i18n translation key for the error message",
  }),
  statusCode: z.number().openapi({
    description: "HTTP status code",
  }),
});

// Individual response objects for specific error types
export const httpResponseBadRequest = {
  400: {
    description: "Bad request - Invalid input data",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 400 }),
        }),
      },
    },
  },
};

export const httpResponseUnauthorized = {
  401: {
    description: "Unauthorized - Authentication required",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 401 }),
        }),
      },
    },
  },
};

export const httpResponseForbidden = {
  403: {
    description: "Forbidden - Insufficient permissions",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 403 }),
        }),
      },
    },
  },
};

export const httpResponseNotFound = {
  404: {
    description: "Not found - Resource does not exist",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 404 }),
        }),
      },
    },
  },
};

export const httpResponseRateLimit = {
  429: {
    description: "Too many requests - Rate limit exceeded",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 429 }),
        }),
      },
    },
  },
};

export const httpResponseContentTooLarge = {
  413: {
    description: "Content too large - File or request exceeds size limit",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 413 }),
        }),
      },
    },
  },
};

export const httpResponseInternalServerError = {
  500: {
    description: "Internal server error",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 500 }),
        }),
      },
    },
  },
};

export const httpResponseConflict = {
  409: {
    description: "Conflict - Resource state conflict",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 409 }),
        }),
      },
    },
  },
};

export const httpResponseServiceUnavailable = {
  503: {
    description: "Service unavailable",
    content: {
      "application/json": {
        schema: ErrorSchema.extend({
          statusCode: z.number().openapi({ example: 503 }),
        }),
      },
    },
  },
};

// Default responses that apply to most routes (for backward compatibility)
export const defaultResponses = {
  ...httpResponseBadRequest,
  ...httpResponseUnauthorized,
  ...httpResponseForbidden,
  ...httpResponseNotFound,
  ...httpResponseContentTooLarge,
  ...httpResponseRateLimit,
  ...httpResponseInternalServerError,
};

// Helper function to merge responses
export const withDefaultResponses = (
  customResponses: Record<string, unknown>,
) => {
  return {
    ...defaultResponses,
    ...customResponses,
  };
};

// Helper function to create JSON body request format
export const withJsonBody = <T extends z.ZodType>(schema: T) => {
  return {
    body: {
      content: {
        "application/json": {
          schema: schema,
        },
      },
    },
  } as const;
};
