/**
 * @file services/workers/decrypt-worker.ts
 * @description Deno Worker script for ChaCha20-Poly1305 chunk decryption.
 *
 * Runs in its own isolated thread — completely off the main event loop.
 * Receives an encrypted chunk (nonce prepended, matching useSymmetricDecrypt
 * with hasNonce=true) and a 32-byte raw key, then returns the decrypted bytes
 * via a transferable ArrayBuffer (zero-copy).
 *
 * Uses native node:crypto (OpenSSL-backed) ChaCha20-Poly1305 — Deno's Web Crypto
 * does not implement ChaCha20-Poly1305 encrypt/decrypt.
 *
 * Protocol (mirrors useSymmetricDecrypt in encryption.helper.ts):
 *   Input  → { id, input: { encryptedChunk: ArrayBuffer, rawKey: ArrayBuffer } }
 *   Output → { id, success: true,  output: { decrypted: ArrayBuffer } }   (transferable)
 *           | { id, success: false, error: string }
 *
 * Encrypted format: [ nonce (12 bytes) | ciphertext | Poly1305 tag (16 bytes) ]
 * Minimum valid size: 12 (nonce) + 1 (plaintext) + 16 (tag) = 29 bytes
 */

import { Buffer, createDecipheriv } from "@deps";

const NONCE_LENGTH = 12;
const TAG_LENGTH = 16;
const MIN_ENCRYPTED_LENGTH = NONCE_LENGTH + TAG_LENGTH; // nonce + tag

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
    input: { encryptedChunk: ArrayBuffer; rawKey: ArrayBuffer };
  };

  try {
    const { encryptedChunk, rawKey } = input;
    const data = new Uint8Array(encryptedChunk);

    if (data.length < MIN_ENCRYPTED_LENGTH) {
      workerSelf.postMessage({
        id,
        success: false,
        error: `Encrypted chunk too short: ${data.length} bytes (minimum ${MIN_ENCRYPTED_LENGTH})`,
      });
      return;
    }

    // Extract nonce (12 bytes), ciphertext, and the trailing 16-byte tag.
    const nonce = Buffer.from(data.subarray(0, NONCE_LENGTH));
    const tagStart = data.length - TAG_LENGTH;
    const ciphertext = Buffer.from(data.subarray(NONCE_LENGTH, tagStart));
    const tag = Buffer.from(data.subarray(tagStart));

    const decipher = createDecipheriv(
      "chacha20-poly1305",
      Buffer.from(rawKey),
      nonce,
      { authTagLength: TAG_LENGTH },
    );
    decipher.setAuthTag(tag);

    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

    // Copy into a standalone ArrayBuffer so it can be transferred (zero-copy)
    // back to the main thread without dragging along Buffer's pooled backing.
    const out = decrypted.buffer.slice(
      decrypted.byteOffset,
      decrypted.byteOffset + decrypted.byteLength,
    );

    workerSelf.postMessage(
      { id, success: true, output: { decrypted: out } },
      [out],
    );
  } catch (error) {
    workerSelf.postMessage({
      id,
      success: false,
      error: error instanceof Error ? error.message : "ChaCha20-Poly1305 decryption failed in worker",
    });
  }
};

// Signal readiness AFTER the onmessage handler is installed. The pool holds
// any dispatched tasks until it receives this message, preventing the Deno
// race where messages posted to a still-initializing worker are dropped.
workerSelf.postMessage({ ready: true });
