/**
 * @file services/upload-processor/chunk-assembler.service.ts
 * @description Service for assembling uploaded chunks into final file stream
 *
 * This service handles:
 * - Reading chunks from temporary storage in sequential order
 * - Creating a unified stream from multiple chunks
 * - Memory-efficient assembly (streaming, not loading all chunks at once)
 * - Content hash calculation for deduplication during assembly
 * - Cleanup of temporary chunk files after assembly
 */

import { getStorage } from "@services/storage/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";
import type { IChunkAssemblyResult, IChunkMetadata, IUploadSession } from "@interfaces/chunked-upload.ts";
import { throwHttpError } from "@utils/http-exception.ts";

/**
 * Service for assembling uploaded chunks into a complete file
 */
export class ChunkAssemblerService {
  /**
   * Assemble chunks into a single readable stream
   * This creates a stream that reads chunks sequentially without loading all into memory
   *
   * NOTE: Content hash calculation is now handled separately by hashing the original chunks
   * BEFORE encryption during the upload phase. This approach:
   * 1. Hashes the correct original content (not encrypted data)
   * 2. Distributes the hashing work across the upload process
   * 3. Avoids double I/O (no need to decrypt chunks during assembly)
   * 4. Maintains memory efficiency (~5MB constant)
   *
   * @param session - Upload session data
   * @param chunks - Array of chunk metadata
   */
  static async assembleChunks(
    session: IUploadSession,
    chunks: IChunkMetadata[],
  ): Promise<IChunkAssemblyResult> {
    return await tracedWithServiceErrorHandling(
      "ChunkAssemblerService.assembleChunks",
      {
        service: "ChunkAssemblerService",
        method: "assembleChunks",
        section: loggerAppSections.DOCUMENTS,
        details: { sessionId: session.id },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      // Callback typed (span) => Promise<T> by tracedWithServiceErrorHandling.
      // deno-lint-ignore require-await
      async (span) => {
        span.attributes["session_id"] = session.id;
        span.attributes["total_chunks"] = session.totalChunks;
        span.attributes["chunks_provided"] = chunks.length;

        // Validate all chunks are present
        if (chunks.length !== session.totalChunks) {
          throwHttpError("DOCUMENT.UPLOAD_INCOMPLETE");
        }

        // Sort chunks by index to ensure correct order
        const sortedChunks = [...chunks].sort((a, b) => a.chunkIndex - b.chunkIndex);

        // Validate sequential chunk indices
        for (let i = 0; i < sortedChunks.length; i++) {
          if (sortedChunks[i].chunkIndex !== i) {
            throwHttpError("DOCUMENT.UPLOAD_INCOMPLETE");
          }
        }

        // Calculate total file size
        const totalSize = sortedChunks.reduce((sum, chunk) => sum + chunk.size, 0);

        // Collect all chunk paths for cleanup
        const tempChunkPaths = sortedChunks.map((chunk) => chunk.storagePath);

        span.attributes["total_file_size"] = totalSize;
        span.attributes["temp_chunk_paths_count"] = tempChunkPaths.length;

        // PERFORMANCE: Use sliding window prefetch to overlap chunk downloads with upload consumption.
        // While the upload consumer reads chunk N, we pre-download chunks N+1..N+K concurrently.
        // This eliminates sequential download→consume→download→consume stacking without loading
        // the entire file into memory at once.
        const stream = this.createSlidingWindowPrefetchStream(sortedChunks);

        span.attributes["success"] = true;

        return {
          fileStream: stream,
          fileSize: totalSize,
          tempChunkPaths,
        };
      },
    );
  }

  /**
   * Create a readable stream using a sliding window prefetch strategy.
   *
   * While the upload consumer reads chunk N, chunks N+1..N+PREFETCH_WINDOW are downloaded
   * concurrently. This eliminates the sequential download→consume→download→consume chain
   * (which was the dominant bottleneck: ~20s of stacked BunnyStorage round-trips) without
   * loading the entire file into memory.
   *
   * Memory footprint: at most PREFETCH_WINDOW * chunkSize bytes at any time (~8MB for K=4 × 2MB).
   */
  private static createSlidingWindowPrefetchStream(
    chunks: IChunkMetadata[],
    prefetchWindow = 4,
  ): ReadableStream<Uint8Array> {
    const storage = getStorage();

    // prefetched[i] holds the Promise<Uint8Array> for chunk i (or undefined if not yet started)
    const prefetched: Array<Promise<Uint8Array> | undefined> = new Array(chunks.length);

    const downloadChunk = async (index: number): Promise<Uint8Array> => {
      const chunk = chunks[index];
      try {
        const downloadResult = await storage.downloadFile(chunk.storagePath);
        if (!downloadResult || !downloadResult.stream) {
          throw new Error(`Failed to download chunk ${index}: empty response`);
        }
        // Collect stream into Uint8Array
        const reader = downloadResult.stream.getReader();
        const parts: Uint8Array[] = [];
        let totalLength = 0;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          parts.push(value);
          totalLength += value.length;
        }
        reader.releaseLock();
        const result = new Uint8Array(totalLength);
        let offset = 0;
        for (const part of parts) {
          result.set(part, offset);
          offset += part.length;
        }
        return result;
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Failed to download chunk in prefetch window",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "chunk_assembler.prefetch_download_failed",
          details: { chunkIndex: index, storagePath: chunk.storagePath },
          raw: error,
        });
        throw error;
      }
    };

    let consumeIndex = 0;

    return new ReadableStream({
      start() {
        // Seed the initial prefetch window before the first pull
        for (let i = 0; i < Math.min(prefetchWindow, chunks.length); i++) {
          prefetched[i] = downloadChunk(i);
        }
      },

      async pull(controller) {
        if (consumeIndex >= chunks.length) {
          controller.close();
          return;
        }

        try {
          // Await the already-in-flight download for the current chunk
          const data = await prefetched[consumeIndex]!;

          // Advance the window: start downloading the chunk that just entered range
          const nextPrefetchIndex = consumeIndex + prefetchWindow;
          if (nextPrefetchIndex < chunks.length) {
            prefetched[nextPrefetchIndex] = downloadChunk(nextPrefetchIndex);
          }

          // Release the resolved promise reference to allow GC
          prefetched[consumeIndex] = undefined;
          consumeIndex++;

          controller.enqueue(data);
        } catch (error) {
          await useLogger(LoggerLevels.error, {
            message: "Error consuming prefetched chunk in stream assembly",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "chunk_assembler.stream_error",
            details: { consumeIndex, totalChunks: chunks.length },
            raw: error,
          });
          controller.error(error);
        }
      },

      cancel(reason) {
        useLogger(LoggerLevels.info, {
          message: "Sliding window prefetch stream cancelled",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "chunk_assembler.stream_cancelled",
          details: { reason: String(reason), consumeIndex, totalChunks: chunks.length },
        });
      },
    });
  }

  /**
   * Create a readable stream from pre-fetched chunk data
   * This eliminates sequential I/O during streaming since chunks are already in memory
   *
   * @param preFetchedChunks - Array of pre-downloaded chunk data
   * @returns ReadableStream of Uint8Array
   */
  private static createStreamFromPrefetchedChunks(
    preFetchedChunks: Uint8Array[],
  ): ReadableStream<Uint8Array> {
    let currentChunkIndex = 0;

    return new ReadableStream({
      pull(controller) {
        // Loop to handle chunk transitions without recursion
        while (true) {
          // If we've finished all chunks, close the stream
          if (currentChunkIndex >= preFetchedChunks.length) {
            controller.close();
            return;
          }

          // Get the next pre-fetched chunk (already in memory - no I/O!)
          const chunkData = preFetchedChunks[currentChunkIndex];
          currentChunkIndex++;

          // Enqueue the data and exit
          controller.enqueue(chunkData);
          return;
        }
      },

      cancel(reason) {
        // Cleanup is not needed since chunks are in memory (already downloaded)
        useLogger(LoggerLevels.info, {
          message: "Prefetched chunk stream cancelled",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "chunk_assembler.prefetched_stream_cancelled",
          details: {
            reason: String(reason),
            remainingChunks: preFetchedChunks.length - currentChunkIndex,
          },
        });
      },
    });
  }

  /**
   * Cleanup temporary chunk files
   * Should be called after successful assembly and processing
   */
  static async cleanupChunks(chunkPaths: string[]): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "ChunkAssemblerService.cleanupChunks",
      {
        service: "ChunkAssemblerService",
        method: "cleanupChunks",
        section: loggerAppSections.DOCUMENTS,
        details: { chunkCount: chunkPaths.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["chunk_count"] = chunkPaths.length;

        const storage = getStorage();
        const cleanupResults = await Promise.allSettled(
          chunkPaths.map(async (path) => {
            try {
              await storage.deleteFile(path);
            } catch (error) {
              await useLogger(LoggerLevels.warn, {
                message: "Failed to cleanup chunk file",
                section: loggerAppSections.DOCUMENTS,
                messageKey: "chunk_assembler.cleanup_failed",
                details: {
                  chunkPath: path,
                  error: error instanceof Error ? error.message : String(error),
                },
              });
              throw error;
            }
          }),
        );

        const successCount = cleanupResults.filter((r) => r.status === "fulfilled").length;
        const failureCount = cleanupResults.filter((r) => r.status === "rejected").length;

        span.attributes["cleanup_success_count"] = successCount;
        span.attributes["cleanup_failure_count"] = failureCount;
        span.attributes["success"] = failureCount === 0;

        if (failureCount > 0) {
          await useLogger(LoggerLevels.warn, {
            message: "Some chunk cleanup operations failed",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "chunk_assembler.partial_cleanup_failure",
            details: {
              totalChunks: chunkPaths.length,
              successCount,
              failureCount,
            },
          });
        }
      },
    );
  }

  /**
   * Cleanup temporary chunk files and the session folder
   * Should be called after successful assembly and processing
   *
   * @param chunkPaths - Array of chunk file paths to delete
   * @param sessionFolderPath - Session folder path to delete after chunks are removed
   */
  static async cleanupChunksAndFolder(
    chunkPaths: string[],
    sessionFolderPath: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "ChunkAssemblerService.cleanupChunksAndFolder",
      {
        service: "ChunkAssemblerService",
        method: "cleanupChunksAndFolder",
        section: loggerAppSections.DOCUMENTS,
        details: { chunkCount: chunkPaths.length },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["chunk_count"] = chunkPaths.length;
        span.attributes["session_folder_path"] = sessionFolderPath;

        // First, delete all chunk files
        await this.cleanupChunks(chunkPaths);

        // Then delete the session folder (recursive to handle any remaining files,
        // e.g. a thumbnail uploaded via /thumbnail/:sessionId before /complete)
        const storage = getStorage();
        try {
          await storage.deleteDirectory(sessionFolderPath, { recursive: true });
          span.attributes["folder_deleted"] = true;
        } catch (error) {
          // Log but don't fail - folder might have files from concurrent operations
          // or might not exist (already cleaned up)
          await useLogger(LoggerLevels.warn, {
            message: "Failed to cleanup session folder",
            section: loggerAppSections.DOCUMENTS,
            messageKey: "chunk_assembler.folder_cleanup_failed",
            details: {
              sessionFolderPath,
              error: error instanceof Error ? error.message : String(error),
            },
          });
          span.attributes["folder_deleted"] = false;
        }

        span.attributes["success"] = true;
      },
    );
  }
}
