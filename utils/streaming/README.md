# Document Stream Response Utility

A centralized utility for creating streamed document responses using Hono's streaming API. This utility provides a consistent, type-safe
approach to handling document downloads and streams with proper error handling, logging, and stream management.

## Features

- ✅ **Unified API**: Single function for both downloads and streaming
- ✅ **Type Safety**: Full TypeScript support with proper interfaces
- ✅ **Error Handling**: Comprehensive error logging and abort detection
- ✅ **Flexible Headers**: Configurable headers for different use cases
- ✅ **Pre-configured Options**: Ready-to-use configurations for common scenarios
- ✅ **Consistent Logging**: Structured logging with configurable sections and message keys

## Basic Usage

### Document Downloads (Forced Download)

```typescript
import { createDocumentStreamResponse, DOWNLOAD_STREAM_OPTIONS } from "@utils/streaming/document-stream-response.ts";

export const downloadHandler = async (c: HonoContext) => {
  const { userId } = getAuthContext(c);
  const { id: documentId } = c.req.valid("param");

  // Get document stream result from service
  const result = await downloadService.download(documentId, userId, encryptionKey, ipAddress, userAgent);

  // Use the utility with pre-configured download options
  return createDocumentStreamResponse(c, result, {
    ...DOWNLOAD_STREAM_OPTIONS,
    context: {
      userId,
      documentId,
    },
  });
};
```

### Document Streaming (Media Playback)

```typescript
import { createDocumentStreamResponse, STREAMING_OPTIONS } from "@utils/streaming/document-stream-response.ts";

export const streamHandler = async (c: HonoContext) => {
  const { userId } = getAuthContext(c);
  const { id: documentId } = c.req.valid("param");
  const range = parseRangeHeader(c.req.header("Range"));

  // Get document stream result from service
  const result = await downloadService.stream(documentId, userId, encryptionKey, range, ipAddress, userAgent);

  // Use the utility with pre-configured streaming options
  return createDocumentStreamResponse(c, result, {
    ...STREAMING_OPTIONS,
    logging: {
      ...STREAMING_OPTIONS.logging,
      additionalDetails: { hasRange: !!range },
    },
    context: {
      userId,
      documentId,
    },
  });
};
```

### Custom Configuration

```typescript
// Custom streaming configuration
return createDocumentStreamResponse(c, result, {
  headers: {
    cacheControl: "public, max-age=86400", // 24 hours
    acceptRanges: true,
    secureMediaHeaders: true,
    additional: {
      "Custom-Header": "custom-value",
    },
  },
  logging: {
    section: loggerAppSections.DOCUMENTS_DOWNLOAD,
    messageKeyPrefix: "custom_stream",
    additionalDetails: {
      customField: "customValue",
      hasRange: !!range,
    },
  },
  context: {
    userId,
    documentId,
    metadata: {
      requestType: "api",
      clientVersion: "2.0",
    },
  },
});
```

## Configuration Options

### Headers Configuration (`IStreamResponseHeaders`)

| Property             | Type                     | Description                                     | Default |
| -------------------- | ------------------------ | ----------------------------------------------- | ------- |
| `cacheControl`       | `string`                 | Cache-Control header value                      | -       |
| `acceptRanges`       | `boolean`                | Whether to set Accept-Ranges: bytes             | `false` |
| `forceDownload`      | `boolean`                | Whether to add Content-Disposition attachment   | `false` |
| `secureMediaHeaders` | `boolean`                | Whether to add X-Content-Type-Options for media | `false` |
| `additional`         | `Record<string, string>` | Additional custom headers                       | -       |

### Logging Configuration (`IStreamLoggingConfig`)

| Property            | Type                      | Description                       |
| ------------------- | ------------------------- | --------------------------------- |
| `section`           | `loggerAppSections`       | Logger section for categorization |
| `messageKeyPrefix`  | `string`                  | Prefix for log message keys       |
| `additionalDetails` | `Record<string, unknown>` | Extra data to include in logs     |

### Context Information (`IStreamContext`)

| Property     | Type                      | Description                 |
| ------------ | ------------------------- | --------------------------- |
| `userId`     | `string`                  | User ID for logging         |
| `documentId` | `string`                  | Document ID for logging     |
| `metadata`   | `Record<string, unknown>` | Additional context metadata |

## Pre-configured Options

### `DOWNLOAD_STREAM_OPTIONS`

- Forces download with Content-Disposition attachment
- No-cache headers for security
- Logs to DOCUMENTS_DOWNLOAD section

### `STREAMING_OPTIONS`

- Enables range requests for media streaming
- Caches for 1 hour
- Adds security headers for media files
- Logs to DEBUG section

## Error Handling

The utility automatically handles:

- **Stream Aborts**: Detects client disconnections and logs them
- **Streaming Errors**: Catches and logs streaming failures
- **Structured Logging**: Consistent log format across all events

## Migration Example

### Before (Manual Stream Management)

```typescript
// Old approach - manual stream handling
return stream(c, async (stream) => {
  c.header("Content-Type", result.mimeType);
  c.header("Content-Length", result.fileSize.toString());
  c.header("Cache-Control", "private, max-age=3600");

  stream.onAbort(() => {
    console.log("Stream aborted");
  });

  await stream.pipe(result.stream);
}, async (err, stream) => {
  console.error("Stream error:", err);
  await stream.writeln("Streaming failed");
});
```

### After (Using Utility)

```typescript
// New approach - centralized utility
return createDocumentStreamResponse(c, result, {
  ...STREAMING_OPTIONS,
  context: { userId, documentId },
});
```

## Benefits

1. **Consistency**: Same streaming behavior across all handlers
2. **Maintainability**: Single place to update streaming logic
3. **Type Safety**: Full TypeScript support prevents runtime errors
4. **Observability**: Structured logging for monitoring and debugging
5. **Flexibility**: Highly configurable for different use cases
6. **Error Resilience**: Proper error handling and cleanup
