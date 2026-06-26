/**
 * @file utils/streaming/file-stream-response.ts
 * @description Utility for creating streamed document responses with Hono
 */

import { stream } from "@deps";
import type { HonoContext } from "@deps";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";

/**
 * Result object from document download/stream services
 */
export interface IDocumentStreamResult {
  stream: ReadableStream;
  mimeType: string;
  fileName: string;
  fileSize: number;
  status: 200 | 206 | 404 | 403 | 500; // Specific HTTP status codes
  contentLength?: number;
  contentRange?: string;
}

/**
 * Configuration for stream response headers
 */
export interface IStreamResponseHeaders {
  /** Cache control policy */
  cacheControl?: string;
  /** Whether to set Accept-Ranges header */
  acceptRanges?: boolean;
  /** Whether to add Content-Disposition as attachment */
  forceDownload?: boolean;
  /** Additional headers to set */
  additional?: Record<string, string>;
  /** Whether to add X-Content-Type-Options for media files */
  secureMediaHeaders?: boolean;
  /**
   * Whether to omit the Content-Length header and use chunked transfer
   * encoding instead. Use this for streamed bodies whose exact byte length
   * is not known up front (e.g. on-the-fly decryption), to avoid the browser
   * hanging on a Content-Length/body-size mismatch.
   */
  omitContentLength?: boolean;
}

/**
 * Logging configuration for stream events
 */
export interface IStreamLoggingConfig {
  /** Logger section to use */
  section: typeof loggerAppSections[keyof typeof loggerAppSections];
  /** Base message key prefix */
  messageKeyPrefix: string;
  /** Additional details to include in logs */
  additionalDetails?: Record<string, unknown>;
}

/**
 * Context information for logging
 */
export interface IStreamContext {
  userId: string;
  documentId: string;
  /** Additional context data for logging */
  metadata?: Record<string, unknown>;
}

/**
 * Options for document stream response
 */
export interface IDocumentStreamOptions {
  /** Header configuration */
  headers: IStreamResponseHeaders;
  /** Logging configuration */
  logging: IStreamLoggingConfig;
  /** Context information */
  context: IStreamContext;
}

/**
 * Creates a streamed document response using Hono's stream API
 *
 * This utility centralizes the logic for streaming document downloads/streams,
 * handling headers, error logging, abort detection, and proper stream management.
 *
 * @param c - Hono context (with stream support)
 * @param result - Document stream result from service
 * @param options - Configuration options
 * @returns Response - Hono stream response
 *
 * @example
 * ```typescript
 * // For document downloads
 * return createFileStreamResponse(c, result, {
 *   headers: {
 *     cacheControl: "private, no-cache, no-store, must-revalidate",
 *     forceDownload: true,
 *     additional: { "Pragma": "no-cache", "Expires": "0" }
 *   },
 *   logging: {
 *     section: "DOCUMENTS_DOWNLOAD",
 *     messageKeyPrefix: "download"
 *   },
 *   context: { userId, documentId }
 * });
 *
 * // For document streaming
 * return createFileStreamResponse(c, result, {
 *   headers: {
 *     cacheControl: "private, max-age=3600",
 *     acceptRanges: true,
 *     secureMediaHeaders: true
 *   },
 *   logging: {
 *     section: "DEBUG",
 *     messageKeyPrefix: "stream",
 *     additionalDetails: { hasRange: !!range }
 *   },
 *   context: { userId, documentId }
 * });
 * ```
 */
export function createFileStreamResponse(
  c: HonoContext,
  result: IDocumentStreamResult,
  options: IDocumentStreamOptions,
): Response {
  // Set response status BEFORE creating stream
  c.status(result.status);

  // Set ALL headers BEFORE creating stream - this is critical for CORS and browser compatibility
  c.header("Content-Type", result.mimeType);

  // Set cache control
  if (options.headers.cacheControl) {
    c.header("Cache-Control", options.headers.cacheControl);
  }

  // Set Accept-Ranges for streaming support
  if (options.headers.acceptRanges) {
    c.header("Accept-Ranges", "bytes");
  }

  // Set Content-Disposition for forced downloads
  if (options.headers.forceDownload) {
    c.header(
      "Content-Disposition",
      `attachment; filename="${encodeURIComponent(result.fileName)}"`,
    );
  }

  // Set Content-Range for partial content
  if (result.contentRange) {
    c.header("Content-Range", result.contentRange);
  }

  // Set Content-Length
  //
  // When omitContentLength is set (streamed bodies of unknown exact size, e.g.
  // on-the-fly decryption) we deliberately skip Content-Length so the runtime
  // uses chunked transfer encoding. Declaring a fixed Content-Length that does
  // not exactly match the emitted byte count causes the browser to hang waiting
  // for the missing bytes.
  if (!options.headers.omitContentLength) {
    if (result.contentLength !== undefined) {
      c.header("Content-Length", result.contentLength.toString());
    } else {
      c.header("Content-Length", result.fileSize.toString());
    }
  }

  // Set secure headers for media files
  if (
    options.headers.secureMediaHeaders &&
    (result.mimeType.startsWith("video/") || result.mimeType.startsWith("audio/"))
  ) {
    c.header("X-Content-Type-Options", "nosniff");
  }

  // Set additional headers (including CORS headers)
  if (options.headers.additional) {
    for (const [key, value] of Object.entries(options.headers.additional)) {
      c.header(key, value);
    }
  }

  // NOW create the stream response with headers already set
  return stream(c, async (stream) => {
    // Handle stream abort events
    stream.onAbort(() => {
      useLogger(LoggerLevels.warn, {
        message: `Document ${options.logging.messageKeyPrefix} aborted by client`,
        section: options.logging.section,
        messageKey: `${options.logging.messageKeyPrefix}_aborted`,
        details: {
          userId: options.context.userId,
          documentId: options.context.documentId,
          fileName: result.fileName,
          ...options.logging.additionalDetails,
          ...options.context.metadata,
        },
      });
    });

    // Pipe the document stream to the response
    await stream.pipe(result.stream);
  }, async (err, stream) => {
    // Handle streaming errors
    await useLogger(LoggerLevels.error, {
      message: `Stream error during document ${options.logging.messageKeyPrefix}`,
      section: options.logging.section,
      messageKey: `${options.logging.messageKeyPrefix}_streaming_error`,
      details: {
        documentId: options.context.documentId,
        userId: options.context.userId,
        fileName: result.fileName,
        error: err instanceof Error ? err.message : String(err),
        ...options.logging.additionalDetails,
        ...options.context.metadata,
      },
    });

    await stream.writeln(
      `Document ${options.logging.messageKeyPrefix} failed due to streaming error`,
    );
  });
}

/**
 * Pre-configured options for document downloads
 */
export const DOWNLOAD_STREAM_OPTIONS = {
  headers: {
    // Use private cache control to prevent browser from caching authenticated responses
    // Browser cache revalidation requests don't include credentials, causing 401 errors
    cacheControl: "private, no-cache, no-store, must-revalidate",
    forceDownload: true,
    // The download body is decrypted on the fly; its exact byte length is not
    // guaranteed to match the DB-recorded original size, so stream it with
    // chunked transfer encoding instead of a fixed Content-Length.
    omitContentLength: true,
    additional: {
      "Access-Control-Expose-Headers": "Content-Disposition, Content-Length, Content-Type",
      "Access-Control-Allow-Credentials": "true",
      "Access-Control-Max-Age": "86400",
      "Pragma": "no-cache",
      "Expires": "0",
    },
  },
  logging: {
    section: loggerAppSections.DOCUMENTS_DOWNLOAD,
    messageKeyPrefix: "download",
  },
};

/**
 * Pre-configured options for document streaming
 */
export const STREAMING_OPTIONS = {
  headers: {
    cacheControl: "public, max-age=31536000, immutable",
    acceptRanges: true,
    secureMediaHeaders: true,
    additional: {
      "Access-Control-Max-Age": "86400",
    },
  },
  logging: {
    section: loggerAppSections.DEBUG,
    messageKeyPrefix: "stream",
  },
};

/**
 * Pre-configured options for thumbnail previews
 */
export const PREVIEW_STREAM_OPTIONS = {
  headers: {
    cacheControl: "public, max-age=31536000, immutable",
    forceDownload: false,
    additional: {
      "Cross-Origin-Resource-Policy": "cross-origin",
      "Access-Control-Max-Age": "86400",
    },
  },
  logging: {
    section: loggerAppSections.DOCUMENTS_DOWNLOAD,
    messageKeyPrefix: "preview",
  },
};
