/**
 * @file services/encryption/data-encryption.helper.ts
 * @description Core encryption/decryption helper functions for data operations
 * Simplified and streamlined version that handles both string and stream data
 */

import { importEncryptionKey, useSymmetricDecrypt, useSymmetricEncrypt, useSymmetricEncryptWithCryptoKey } from "./encryption.helper.ts";
import { getDecryptPool } from "@services/workers/index.ts";
import { EncryptionValidationHelper } from "./encryption-validation.helper.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { randomBytes } from "@deps";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { createStreamWorkSpan, tracedSync } from "@services/tracing/index.ts";
import { CHUNKED_UPLOAD_CONFIG } from "@constants/documents/chunked-upload.ts";

export class DataEncryptionHelperService {
  /**
   * Encrypt data with a provided key
   * @param key Encryption key as Uint8Array (must be exactly 32 bytes)
   * @param data Data to encrypt (string or Uint8Array)
   * @returns Object containing encrypted data and encrypted master key
   * @throws HTTPException if key is invalid or data validation fails
   */
  static async encryptDataWithKey(
    key: Uint8Array,
    data: string | Uint8Array,
  ): Promise<{ data: Uint8Array; encryptedMasterKey: Uint8Array }> {
    return await tracedSync(
      "DataEncryptionHelper.encryptDataWithKey",
      "service",
      async (span) => {
        // Add span attributes for observability
        span.attributes["encryption.dataType"] = typeof data;
        span.attributes["encryption.dataSize"] = data instanceof Uint8Array ? data.length : data.length;

        // Validate inputs (these throw HTTP exceptions that should propagate)
        EncryptionValidationHelper.validateDataInput(data);
        EncryptionValidationHelper.validateEncryptionKey(key);

        try {
          const dataMasterKey = this.generateDataMasterKey();

          try {
            const encryptedData = await useSymmetricEncrypt({
              data,
              key: dataMasterKey,
            });

            const encryptedMasterKey = await useSymmetricEncrypt({
              key: key,
              data: dataMasterKey,
            });

            span.attributes["encryption.success"] = true;
            span.attributes["encryption.outputSize"] = encryptedData.length;

            return {
              data: encryptedData,
              encryptedMasterKey: encryptedMasterKey,
            };
          } finally {
            dataMasterKey.fill(0);
          }
        } catch (error) {
          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.ENCRYPTION_FAILED", error);
        }
      },
    );
  }

  /**
   * Decrypt data with a provided key
   * @param key Encryption key as Uint8Array (must be exactly 32 bytes)
   * @param encryptedMasterKey Encrypted master key as Uint8Array
   * @param encryptedData Encrypted data as Uint8Array
   * @returns Decrypted data as string or Uint8Array
   * @throws HTTPException if key is invalid or decryption fails
   */
  static async decryptDataWithKey(
    key: Uint8Array,
    encryptedMasterKey: Uint8Array,
    encryptedData: Uint8Array,
  ) {
    return await tracedSync(
      "DataEncryptionHelper.decryptDataWithKey",
      "service",
      async (span) => {
        // Add span attributes for observability
        span.attributes["encryption.encryptedDataSize"] = encryptedData.length;

        // Validate inputs (these throw HTTP exceptions that should propagate)
        EncryptionValidationHelper.validateEncryptionKey(key);

        if (!encryptedData || !(encryptedData instanceof Uint8Array)) {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        let dataMasterKey: Uint8Array | null = null;

        try {
          dataMasterKey = await useSymmetricDecrypt({
            key: key,
            data: encryptedMasterKey,
          });

          const decryptedData = await useSymmetricDecrypt({
            key: dataMasterKey,
            data: encryptedData,
          });

          // Zero sensitive key material from memory
          dataMasterKey.fill(0);
          dataMasterKey = null;

          span.attributes["encryption.success"] = true;
          const dataSize = decryptedData.length;
          span.attributes["encryption.decryptedDataSize"] = dataSize;

          return decryptedData;
        } catch (error) {
          // Zero sensitive key material from memory
          if (dataMasterKey) {
            dataMasterKey.fill(0);
            dataMasterKey = null;
          }

          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.DECRYPTION_FAILED", error);
        }
      },
    );
  }

  /**
   * Encrypt a data stream with a provided key
   * @param key Encryption key as Uint8Array (must be exactly 32 bytes)
   * @param dataStream Readable stream of data to encrypt
   * @returns Object containing encrypted stream and encrypted data key
   * @throws HTTPException if key is invalid or stream encryption fails
   */
  static async encryptStreamWithKey(
    key: Uint8Array,
    dataStream: ReadableStream<Uint8Array>,
    encryptionChunkSize?: number,
  ): Promise<{
    encryptedStream: ReadableStream<Uint8Array>;
    encryptedDataKey: Uint8Array;
  }> {
    return await tracedSync(
      "DataEncryptionHelper.encryptStreamWithKey",
      "service",
      async (span) => {
        // Add span attributes for observability
        span.attributes["encryption.mode"] = "stream";

        // Validate inputs (these throw HTTP exceptions that should propagate)
        EncryptionValidationHelper.validateEncryptionKey(key);

        // Simple stream validation
        if (!dataStream || typeof dataStream.getReader !== "function") {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        try {
          // Generate data master key
          const dataMasterKey = this.generateDataMasterKey();

          // Encrypt data master key with the provided key
          const encryptedDataKey = await useSymmetricEncrypt({
            key: key,
            data: dataMasterKey,
          });

          // Import the data master key once as a CryptoKey for all chunk encryptions.
          // This avoids calling crypto.subtle.importKey() on every chunk.
          const dataMasterCryptoKey = await importEncryptionKey(dataMasterKey);

          // Create encrypted stream processing chunks using master key directly
          const reader = dataStream.getReader();
          const chunkSize = encryptionChunkSize || CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES;

          // Pre-allocate buffer for one encryption chunk to avoid O(n²) copy-on-append.
          // Each reader.read() copies directly into position instead of reallocating.
          let buffer = new Uint8Array(chunkSize);
          let offset = 0;

          // Cancellation flag to prevent enqueue after cancel
          let isCancelled = false;

          const encryptedStream = new ReadableStream<Uint8Array>({
            async pull(controller) {
              // Early exit if already cancelled
              if (isCancelled) {
                return;
              }

              try {
                while (!isCancelled) {
                  // Read more data
                  const { done, value } = await reader.read();

                  if (done) {
                    // Process remaining buffer
                    if (offset > 0 && !isCancelled) {
                      const encryptedChunk = await useSymmetricEncryptWithCryptoKey({
                        cryptoKey: dataMasterCryptoKey,
                        data: buffer.subarray(0, offset),
                      });
                      if (!isCancelled) controller.enqueue(new Uint8Array(encryptedChunk));
                    }
                    if (!isCancelled) controller.close();
                    return;
                  }

                  if (value && value.length > 0) {
                    // Copy incoming data into pre-allocated buffer, encrypting
                    // full chunks as the buffer fills. Handles reads of any size
                    // including those larger than chunkSize.
                    let didEncrypt = false;
                    let valuePos = 0;

                    while (valuePos < value.length) {
                      const space = chunkSize - offset;
                      const toCopy = Math.min(space, value.length - valuePos);
                      buffer.set(value.subarray(valuePos, valuePos + toCopy), offset);
                      offset += toCopy;
                      valuePos += toCopy;

                      if (offset >= chunkSize) {
                        const encryptedChunk = await useSymmetricEncryptWithCryptoKey({
                          cryptoKey: dataMasterCryptoKey,
                          data: buffer,
                        });
                        if (!isCancelled) controller.enqueue(new Uint8Array(encryptedChunk));
                        buffer = new Uint8Array(chunkSize);
                        offset = 0;
                        didEncrypt = true;
                      }
                    }

                    if (didEncrypt) return; // Yield to event loop
                  }
                }
              } catch (error) {
                if (isCancelled) {
                  // Silently ignore - this is expected when stream is cancelled mid-processing
                  return;
                }
                controller.error(error);
              }
            },

            cancel() {
              isCancelled = true;
            },
          });

          span.attributes["encryption.success"] = true;
          span.attributes["encryption.chunkSize"] = chunkSize;

          return {
            encryptedStream,
            encryptedDataKey,
          };
        } catch (error) {
          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.ENCRYPTION_FAILED", error);
        }
      },
    );
  }

  /**
   * Decrypt a data stream with a raw data master key (no encrypted key decryption step)
   * Use this when you already have the decrypted data master key
   * @param dataMasterKey Raw data master key as Uint8Array (must be exactly 32 bytes)
   * @param encryptedStream Readable stream of encrypted data
   * @param encryptionChunkSize Chunk size used during encryption (defaults to 64KB)
   * @returns Readable stream of decrypted data
   * @throws HTTPException if key is invalid or stream decryption fails
   */
  static decryptStreamWithRawDataMasterKey(
    dataMasterKey: Uint8Array,
    encryptedStream: ReadableStream<Uint8Array>,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): ReadableStream<Uint8Array> {
    return tracedSync(
      "DataEncryptionHelper.decryptStreamWithRawDataMasterKey",
      "service",
      (span) => {
        // Add span attributes for observability
        span.attributes["encryption.mode"] = "stream";
        span.attributes["encryption.chunkSize"] = encryptionChunkSize;

        // Validate inputs (these throw HTTP exceptions that should propagate)
        EncryptionValidationHelper.validateEncryptionKey(dataMasterKey);

        try {
          // Create decrypted stream processing chunks using master key directly
          const reader = encryptedStream.getReader();
          const chunkSize = encryptionChunkSize;
          const encryptedChunkSize = chunkSize + 28; // 12 bytes IV + 16 bytes tag

          // Buffer state
          let chunks: Uint8Array[] = [];
          let totalBufferedLength = 0;

          // Read-ahead state
          let nextChunkPromise: Promise<ReadableStreamReadResult<Uint8Array>> | null = null;

          // Chunk tracking for debugging
          let chunkNumber = 0;

          // Cancellation flag to prevent enqueue after cancel
          let isCancelled = false;

          // This stream owns `dataMasterKey` for its lifetime. Zero it exactly
          // once when the stream is done (close, error, or cancel) so the key
          // material does not linger in memory. It must NOT be zeroed earlier:
          // this stream is lazy and only decrypts when the consumer pulls.
          let keyZeroed = false;
          const zeroKey = () => {
            if (!keyZeroed) {
              keyZeroed = true;
              dataMasterKey.fill(0);
            }
          };

          // Record the real decryption work time (storage reads + worker
          // decryption) as a span that finishes when the stream does — long
          // after the request's trace was flushed. See createStreamWorkSpan.
          const workSpan = createStreamWorkSpan({
            name: "decrypt.stream",
            operationType: "encryption",
            attributes: { "encryption.chunkSize": encryptionChunkSize },
          });

          const pullBody = async (
            controller: ReadableStreamDefaultController<Uint8Array>,
          ) => {
            // Early exit if already cancelled
            if (isCancelled) {
              return;
            }

            try {
              // Start pre-fetching the next chunk if not already doing so
              if (!nextChunkPromise) {
                nextChunkPromise = reader.read();
              }

              // Read until we have enough for a chunk
              while (totalBufferedLength < encryptedChunkSize && !isCancelled) {
                // Wait for the current read to complete
                const result = await nextChunkPromise;
                nextChunkPromise = null; // Reset for next iteration

                if (!result) {
                  // Should not happen with standard ReadableStream, but handle for safety
                  zeroKey();
                  if (!isCancelled) controller.close();
                  return;
                }

                const { done, value } = result;

                if (done) {
                  // Process remaining buffer
                  if (totalBufferedLength > 0 && !isCancelled) {
                    try {
                      // Combine chunks efficiently
                      const buffer = new Uint8Array(totalBufferedLength);
                      let offset = 0;
                      for (const chunk of chunks) {
                        buffer.set(chunk, offset);
                        offset += chunk.length;
                      }

                      // Offload decryption to the worker pool — keeps
                      // crypto off the main event loop and thread pool.
                      const decryptedChunk = await getDecryptPool().decrypt(buffer, dataMasterKey);
                      if (!isCancelled) {
                        try {
                          controller.enqueue(decryptedChunk);
                        } catch (_enqueueError) {
                          // Controller may have been closed - exit gracefully
                          return;
                        }
                      }
                    } catch (error) {
                      // Log chunk decryption errors with more details
                      useLogger(LoggerLevels.error, {
                        message: "Final chunk decryption error in stream",
                        messageKey: "encryption.stream_chunk_decrypt.error",
                        section: loggerAppSections.USER_ENCRYPTED,
                        details: {
                          chunkNumber,
                          bufferSize: totalBufferedLength,
                          expectedEncryptedSize: encryptedChunkSize,
                          expectedDecryptedSize: chunkSize,
                          isPartialChunk: totalBufferedLength < encryptedChunkSize,
                          chunksInBuffer: chunks.length,
                          error: error instanceof Error ? error.message : String(error),
                          errorStack: error instanceof Error ? error.stack : undefined,
                        },
                        raw: error,
                      });
                      zeroKey();
                      if (!isCancelled) controller.error(error);
                      return;
                    }
                  }
                  zeroKey();
                  if (!isCancelled) controller.close();
                  return;
                }

                if (value && value.length > 0) {
                  chunks.push(value);
                  totalBufferedLength += value.length;

                  // Start fetching next chunk immediately (read-ahead)
                  if (totalBufferedLength < encryptedChunkSize && !isCancelled) {
                    nextChunkPromise = reader.read();
                  }
                }
              }

              // We have enough data, process a chunk
              if (totalBufferedLength >= encryptedChunkSize && !isCancelled) {
                // Combine chunks efficiently
                const buffer = new Uint8Array(totalBufferedLength);
                let offset = 0;
                for (const chunk of chunks) {
                  buffer.set(chunk, offset);
                  offset += chunk.length;
                }

                const chunkToDecrypt = buffer.slice(0, encryptedChunkSize);

                // Reset buffer with remaining data
                const remaining = buffer.slice(encryptedChunkSize);
                chunks = remaining.length > 0 ? [remaining] : [];
                totalBufferedLength = remaining.length;

                // Start fetching next chunk immediately while we decrypt (read-ahead)
                if (!nextChunkPromise && !isCancelled) {
                  nextChunkPromise = reader.read();
                }

                try {
                  chunkNumber++;
                  // Offload decryption to the worker pool — keeps
                  // crypto off the main event loop and thread pool.
                  const decryptedChunk = await getDecryptPool().decrypt(chunkToDecrypt, dataMasterKey);
                  if (!isCancelled) {
                    try {
                      controller.enqueue(decryptedChunk);
                    } catch (enqueueError) {
                      // Controller may have been closed due to client disconnect - exit gracefully
                      useLogger(LoggerLevels.warn, {
                        message: "Failed to enqueue decrypted chunk - client likely disconnected",
                        messageKey: "encryption.stream_enqueue_failed",
                        section: loggerAppSections.USER_ENCRYPTED,
                        details: {
                          chunkNumber,
                          error: enqueueError instanceof Error ? enqueueError.message : String(enqueueError),
                        },
                      });
                      return;
                    }
                  }
                } catch (error) {
                  useLogger(LoggerLevels.error, {
                    message: "Chunk decryption error in stream",
                    messageKey: "encryption.stream_chunk_decrypt.error",
                    section: loggerAppSections.USER_ENCRYPTED,
                    details: {
                      chunkNumber,
                      chunkSize: chunkToDecrypt.length,
                      expectedEncryptedSize: encryptedChunkSize,
                      expectedDecryptedSize: chunkSize,
                      remainingBufferSize: totalBufferedLength,
                      chunksProcessed: chunkNumber - 1,
                      error: error instanceof Error ? error.message : String(error),
                      errorStack: error instanceof Error ? error.stack : undefined,
                    },
                    raw: error,
                  });
                  // Always propagate stream errors to the consumer regardless of buffer state
                  zeroKey();
                  if (!isCancelled) controller.error(error);
                  return;
                }
              }
            } catch (error) {
              // Check if this is a "controller cannot enqueue" error due to cancellation
              if (isCancelled) {
                // Silently ignore - this is expected when stream is cancelled mid-processing
                return;
              }
              zeroKey();
              controller.error(error);
            }
          };

          const decryptedStream = new ReadableStream<Uint8Array>({
            async pull(realController) {
              // Time only the work done inside pull() (storage reads + worker
              // decryption). Time spent idle waiting for the consumer to drain
              // is excluded, so the recorded duration reflects real decryption
              // work rather than client download speed.
              const controller = workSpan.wrapController(realController);
              const endWork = workSpan.beginWork();
              try {
                await pullBody(controller);
              } finally {
                endWork();
              }
            },

            cancel(reason) {
              // Client disconnected or the consumer cancelled. Stop further
              // decryption, release the upstream reader, and zero the key.
              workSpan.finalize("ok", undefined, true);
              isCancelled = true;
              zeroKey();
              reader.cancel(reason).catch(() => {
                // Upstream may already be closed; ignore.
              });
            },
          });

          span.attributes["encryption.success"] = true;

          return decryptedStream;
        } catch (error) {
          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.DECRYPTION_FAILED", error);
        }
      },
    );
  }

  /**
   * Decrypt a data stream with a provided key
   * @param key Encryption key as Uint8Array (must be exactly 32 bytes)
   * @param encryptedDataKey Encrypted data key as Uint8Array
   * @param encryptedStream Readable stream of encrypted data
   * @param encryptionChunkSize Chunk size used during encryption (defaults to 64KB)
   * @returns Readable stream of decrypted data
   * @throws HTTPException if key is invalid or stream decryption fails
   */
  static async decryptStreamWithKey(
    key: Uint8Array,
    encryptedDataKey: Uint8Array,
    encryptedStream: ReadableStream<Uint8Array>,
    encryptionChunkSize: number = CHUNKED_UPLOAD_CONFIG.DEFAULT_CHUNK_SIZE_BYTES,
  ): Promise<ReadableStream<Uint8Array>> {
    return await tracedSync(
      "DataEncryptionHelper.decryptStreamWithKey",
      "service",
      async (span) => {
        // Add span attributes for observability
        span.attributes["encryption.mode"] = "stream";
        span.attributes["encryption.chunkSize"] = encryptionChunkSize;

        // Validate inputs (these throw HTTP exceptions that should propagate)
        EncryptionValidationHelper.validateEncryptionKey(key);

        if (!encryptedDataKey || !(encryptedDataKey instanceof Uint8Array)) {
          throwHttpError("VALIDATION.INVALID_FORMAT");
        }

        let dataMasterKey: Uint8Array | null = null;

        try {
          dataMasterKey = await useSymmetricDecrypt({
            key: key,
            data: encryptedDataKey,
          });

          span.attributes["encryption.masterKeyDecrypted"] = true;

          const decryptedStream = DataEncryptionHelperService.decryptStreamWithRawDataMasterKey(
            dataMasterKey,
            encryptedStream,
            encryptionChunkSize,
          );

          // IMPORTANT: do NOT zero `dataMasterKey` here. The decryption stream is
          // lazy (pull-based) and captures this key by reference; it only runs
          // when the HTTP response is actually streamed. Zeroing it now would
          // leave the stream decrypting with an all-zero key, producing
          // "unable to authenticate data". Ownership of the key — and the
          // responsibility to zero it on stream close/cancel/error — is
          // transferred to decryptStreamWithRawDataMasterKey.
          dataMasterKey = null;

          return decryptedStream;
        } catch (error) {
          // Zero sensitive key material from memory
          if (dataMasterKey) {
            dataMasterKey.fill(0);
            dataMasterKey = null;
          }

          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.DECRYPTION_FAILED", error);
        }
      },
    );
  }

  /**
   * Generate a cryptographically secure data master key
   * @returns 32-byte Uint8Array containing the master key
   * @throws HTTPException if key generation fails or produces weak key
   */
  static generateDataMasterKey(): Uint8Array {
    return tracedSync(
      "DataEncryptionHelper.generateDataMasterKey",
      "service",
      (span) => {
        // Add span attributes for observability
        span.attributes["encryption.keySize"] = 32;

        try {
          const keyBytes = new Uint8Array(randomBytes(32));

          // Check for weak keys (all zeros)
          const isAllZeros = keyBytes.every((byte) => byte === 0);
          if (isAllZeros) {
            throwHttpError("ENCRYPTION.KEY_GENERATION_FAILED");
          }

          span.attributes["encryption.success"] = true;

          return keyBytes;
        } catch (error) {
          // Re-throw intentional HTTP exceptions (caller owns logging)
          if (error instanceof AppHttpException) {
            throw error;
          }

          throwHttpError("ENCRYPTION.KEY_GENERATION_FAILED", error);
        }
      },
    );
  }
}
