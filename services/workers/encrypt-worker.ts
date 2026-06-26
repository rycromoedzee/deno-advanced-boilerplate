/**
 * @file services/workers/encrypt-worker.ts
 * @description Deno Worker script for ChaCha20-Poly1305 chunk encryption.
 *
 * Runs in its own isolated thread — completely off the main event loop.
 * Receives a plaintext chunk and a 32-byte raw key, then returns the encrypted
 * bytes via a transferable ArrayBuffer (zero-copy).
 *
 * Uses native node:crypto (OpenSSL-backed) ChaCha20-Poly1305 — Deno's Web Crypto
 * does not implement ChaCha20-Poly1305 encrypt/decrypt. The produced wire format
 * is byte-identical to useSymmetricEncrypt (encryption.helper.ts) with
 * includeNonce=true, so chunk-size math and seekable offsets stay valid.
 *
 * Protocol (mirrors useSymmetricEncrypt in encryption.helper.ts):
 *   Input  → { id, input: { plaintext: ArrayBuffer, rawKey: ArrayBuffer } }
 *   Output → { id, success: true,  output: { encrypted: ArrayBuffer } }   (transferable)
 *           | { id, success: false, error: string }
 *
 * Encrypted format: [ nonce (12 bytes) | ciphertext | Poly1305 tag (16 bytes) ]
 */

import { Buffer, createCipheriv, nodeRandomBytes } from "@deps";

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;

// Declare worker global scope interface for Deno Worker
interface WorkerGlobalScope {
  onmessage: (event: MessageEvent) => void;
  postMessage: (message: unknown, transfer?: Transferable[]) => void;
}

// Type assertion for Web Worker global scope
const workerSelf = self as unknown as WorkerGlobalScope;

workerSelf.onmessage = (event: MessageEvent) => {
  const { id, input } = event.data as {
    id: number;
    input: { plaintext: ArrayBuffer; rawKey: ArrayBuffer };
  };

  try {
    const { plaintext, rawKey } = input;
    const data = new Uint8Array(plaintext);

    if (data.length === 0) {
      workerSelf.postMessage({
        id,
        success: false,
        error: "Plaintext chunk is empty",
      });
      return;
    }

    const key = Buffer.from(rawKey);
    if (key.length !== 32) {
      workerSelf.postMessage({
        id,
        success: false,
        error: `Invalid key length: ${key.length} bytes (expected 32)`,
      });
      return;
    }

    const nonce = nodeRandomBytes(NONCE_LENGTH);

    const cipher = createCipheriv(
      "chacha20-poly1305",
      key,
      nonce,
      { authTagLength: TAG_LENGTH },
    );

    const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();

    // Assemble [ nonce | ciphertext | tag ] into a standalone ArrayBuffer so it
    // can be transferred (zero-copy) back to the main thread.
    const out = new Uint8Array(NONCE_LENGTH + ciphertext.length + TAG_LENGTH);
    out.set(nonce, 0);
    out.set(ciphertext, NONCE_LENGTH);
    out.set(tag, NONCE_LENGTH + ciphertext.length);

    workerSelf.postMessage(
      { id, success: true, output: { encrypted: out.buffer } },
      [out.buffer],
    );
  } catch (error) {
    workerSelf.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : "ChaCha20-Poly1305 encryption failed in worker",
    });
  }
};

// Signal readiness AFTER the onmessage handler is installed. The pool holds
// any dispatched tasks until it receives this message, preventing the Deno
// race where messages posted to a still-initializing worker are dropped.
workerSelf.postMessage({ ready: true });
