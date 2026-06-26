/**
 * @file services/workers/decrypt-worker-pool.ts
 * @description Worker pool for ChaCha20-Poly1305 chunk decryption.
 *
 * Extends the generic WorkerPool to provide a typed decrypt() method that:
 * - Accepts a Uint8Array encrypted chunk and a 32-byte raw key
 * - Transfers both buffers to a worker thread (zero-copy)
 * - Returns the decrypted Uint8Array
 *
 * This keeps all ChaCha20-Poly1305 work off the main Deno event loop, ensuring
 * media streaming decryption does not contend with HTTP handling, DB
 * queries, or other I/O operations.
 */

import { WorkerPool } from "./worker-pool.ts";

/** Input sent to the decrypt worker */
interface DecryptInput {
  encryptedChunk: ArrayBuffer;
  rawKey: ArrayBuffer;
}

/** Output returned by the decrypt worker */
interface DecryptOutput {
  decrypted: ArrayBuffer;
}

export class DecryptWorkerPool extends WorkerPool<DecryptInput, DecryptOutput> {
  constructor(poolSize = 1) {
    super(
      new URL("./decrypt-worker.ts", import.meta.url).href,
      poolSize,
    );
  }

  /**
   * Decrypt a single ChaCha20-Poly1305 encrypted chunk on a worker thread.
   *
   * IMPORTANT: The underlying ArrayBuffers of `encryptedChunk` and `rawKey`
   * are TRANSFERRED to the worker (zero-copy). Do NOT read or reuse either
   * Uint8Array after calling this method — create a copy first if needed.
   *
   * @param encryptedChunk - [ nonce (12 bytes) | ciphertext | Poly1305 tag (16 bytes) ]
   * @param rawKey         - 32-byte ChaCha20-Poly1305 key
   * @returns              Decrypted plaintext as Uint8Array
   */
  async decrypt(
    encryptedChunk: Uint8Array,
    rawKey: Uint8Array,
  ): Promise<Uint8Array> {
    // Slice to get fresh ArrayBuffers with correct byteOffset/byteLength.
    // This is necessary when the Uint8Array is a view into a larger buffer.
    // We use a manual copy into a new ArrayBuffer to ensure we always have
    // a plain ArrayBuffer (not SharedArrayBuffer), which is required for transfer.
    const chunkBuffer = new Uint8Array(encryptedChunk).buffer as ArrayBuffer;
    const keyBuffer = new Uint8Array(rawKey).buffer as ArrayBuffer;

    const result = await this.dispatch(
      { encryptedChunk: chunkBuffer, rawKey: keyBuffer },
      [chunkBuffer, keyBuffer], // transfer ownership — zero-copy
    );

    return new Uint8Array(result.decrypted);
  }
}
