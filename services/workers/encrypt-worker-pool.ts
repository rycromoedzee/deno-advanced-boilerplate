/**
 * @file services/workers/encrypt-worker-pool.ts
 * @description Worker pool for ChaCha20-Poly1305 chunk encryption.
 *
 * Extends the generic WorkerPool to provide a typed encrypt() method that:
 * - Accepts a Uint8Array plaintext chunk and a 32-byte raw key
 * - Transfers both buffers to a worker thread (zero-copy)
 * - Returns the encrypted Uint8Array laid out as [ nonce | ciphertext | tag ]
 *
 * This keeps per-chunk ChaCha20-Poly1305 encryption off the main Deno event
 * loop, so large chunked uploads do not contend with HTTP handling, DB queries,
 * or concurrent media-streaming decryption. The wire format is byte-identical to
 * useSymmetricEncrypt (encryption.helper.ts) so seekable-chunk offsets stay valid.
 */

import { WorkerPool } from "./worker-pool.ts";

/** Input sent to the encrypt worker */
interface EncryptInput {
  plaintext: ArrayBuffer;
  rawKey: ArrayBuffer;
}

/** Output returned by the encrypt worker */
interface EncryptOutput {
  encrypted: ArrayBuffer;
}

export class EncryptWorkerPool extends WorkerPool<EncryptInput, EncryptOutput> {
  constructor(poolSize = 1) {
    super(
      new URL("./encrypt-worker.ts", import.meta.url).href,
      poolSize,
    );
  }

  /**
   * Encrypt a single plaintext chunk with ChaCha20-Poly1305 on a worker thread.
   *
   * IMPORTANT: The underlying ArrayBuffers of `plaintext` and `rawKey` are
   * TRANSFERRED to the worker (zero-copy). Do NOT read or reuse either
   * Uint8Array after calling this method — create a copy first if needed.
   *
   * @param plaintext - Raw chunk bytes to encrypt
   * @param rawKey    - 32-byte ChaCha20-Poly1305 key (the raw data master key)
   * @returns         Encrypted bytes as [ nonce (12) | ciphertext | tag (16) ]
   */
  async encrypt(
    plaintext: Uint8Array,
    rawKey: Uint8Array,
  ): Promise<Uint8Array> {
    // Copy into fresh, plain ArrayBuffers (not SharedArrayBuffer, and with the
    // correct byteOffset/byteLength) so they can be transferred. This mirrors
    // DecryptWorkerPool.decrypt and protects callers whose Uint8Array is a view
    // into a larger buffer.
    const plaintextBuffer = new Uint8Array(plaintext).buffer as ArrayBuffer;
    const keyBuffer = new Uint8Array(rawKey).buffer as ArrayBuffer;

    const result = await this.dispatch(
      { plaintext: plaintextBuffer, rawKey: keyBuffer },
      [plaintextBuffer, keyBuffer], // transfer ownership — zero-copy
    );

    return new Uint8Array(result.encrypted);
  }
}
