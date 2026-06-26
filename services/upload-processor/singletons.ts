/**
 * @file services/upload-processor/singletons.ts
 * @description Lazy singletons for upload processor services
 */
import { SSEChunkedUploadService } from "./sse-chunked-upload.service.ts";

let sseChunkedUploadService: SSEChunkedUploadService;

/**
 * Gets the singleton instance of SSEChunkedUploadService. Holds the live SSE
 * connection map and pending-event buffer for chunked uploads.
 * @returns {SSEChunkedUploadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getSSEChunkedUploadService(): SSEChunkedUploadService {
  if (!sseChunkedUploadService) {
    try {
      sseChunkedUploadService = new SSEChunkedUploadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize SSEChunkedUploadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return sseChunkedUploadService;
}
