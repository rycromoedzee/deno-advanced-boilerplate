/**
 * @file services/workers/index.ts
 * @description Worker pool exports and singleton accessors.
 *
 * Pools are initialized lazily on first access and are long-lived for
 * the lifetime of the process. Use the getter functions to access pools
 * rather than instantiating directly.
 */

export { WorkerPool } from "./worker-pool.ts";
export type { WorkerMessage, WorkerResult, WorkerTask } from "./worker-pool.ts";
export { DecryptWorkerPool } from "./decrypt-worker-pool.ts";
export { EncryptWorkerPool } from "./encrypt-worker-pool.ts";

import { DecryptWorkerPool } from "./decrypt-worker-pool.ts";
import { EncryptWorkerPool } from "./encrypt-worker-pool.ts";
import { envConfig } from "@config/env.ts";

let decryptPool: DecryptWorkerPool | null = null;
let encryptPool: EncryptWorkerPool | null = null;

/**
 * Returns the singleton ChaCha20-Poly1305 decrypt worker pool.
 *
 * Pool size is controlled by the `WORKERS_MAX_DECRYPT` environment variable
 * (defaults to 1). The pool is created on first call and reused for the
 * lifetime of the process.
 *
 * @example
 * ```typescript
 * const decrypted = await getDecryptPool().decrypt(encryptedChunk, rawKey);
 * ```
 */
export function getDecryptPool(): DecryptWorkerPool {
  if (!decryptPool) {
    decryptPool = new DecryptWorkerPool(envConfig.workers.maxDecryptWorkers);
  }
  return decryptPool;
}

/**
 * Returns the singleton ChaCha20-Poly1305 encrypt worker pool.
 *
 * Pool size is controlled by the `WORKERS_MAX_ENCRYPT` environment variable
 * (defaults to 1). The pool is created on first call and reused for the
 * lifetime of the process. Used to offload per-chunk encryption during
 * chunked uploads from the main event loop.
 *
 * @example
 * ```typescript
 * const encrypted = await getEncryptPool().encrypt(plaintextChunk, rawKey);
 * ```
 */
export function getEncryptPool(): EncryptWorkerPool {
  if (!encryptPool) {
    encryptPool = new EncryptWorkerPool(envConfig.workers.maxEncryptWorkers);
  }
  return encryptPool;
}
