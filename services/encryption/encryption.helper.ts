/**
 * @file services/encryption/encryption.helper.ts
 * @description Core symmetric encryption helper functions
 * Contains only symmetric encryption operations and utility re-exports
 *
 * Cipher: ChaCha20-Poly1305 (RFC 8439) via Node's native crypto (`node:crypto`,
 * OpenSSL-backed). Deno's Web Crypto `crypto.subtle` can import a ChaCha20-Poly1305
 * key but does not implement encrypt/decrypt for it, so `node:crypto` is the only
 * native AEAD path today. It outperforms native AES-GCM across all payload sizes
 * in this codebase's workloads (key wrapping and 10MB streaming chunks).
 *
 * Wire format (unchanged from the previous AES-GCM scheme so all chunk-size math
 * and seekable offsets stay valid):
 *
 *   [ nonce (12 bytes) | ciphertext (== plaintext length) | auth tag (16 bytes) ]
 *
 * ChaCha20 is a stream cipher, so ciphertext length always equals plaintext length;
 * the 16-byte Poly1305 tag is appended after the ciphertext. This matches the byte
 * layout AES-GCM produced (12-byte IV prefix + 16-byte tag suffix => +28 overhead).
 */

import { Buffer, createCipheriv, createDecipheriv, randomBytes } from "@deps";

import { DB_ENUM_ENCRYPTION_MODE } from "@db/enums/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { TextTransformations } from "@utils/text/index.ts";

/** ChaCha20-Poly1305 nonce length in bytes (96-bit, RFC 8439). */
export const CHACHA_NONCE_LENGTH = 12;
/** Poly1305 authentication tag length in bytes. */
export const CHACHA_TAG_LENGTH = 16;
/** Per-encryption overhead: nonce prefix + tag suffix. */
export const ENCRYPTION_OVERHEAD = CHACHA_NONCE_LENGTH + CHACHA_TAG_LENGTH; // 28

/**
 * Maps a key type string from DataAccessService to the corresponding
 * DB_ENUM_ENCRYPTION_MODE value. Used by handlers that need to pass
 * the encryption mode when creating/updating records.
 */
export function encryptionModeFromKeyType(
  keyType: "app" | "user",
): DB_ENUM_ENCRYPTION_MODE {
  switch (keyType) {
    case "app":
      return DB_ENUM_ENCRYPTION_MODE.APP_CONTROLLED;
    case "user":
      return DB_ENUM_ENCRYPTION_MODE.USER_CONTROLLED;
  }
}

const CIPHER_ALGORITHM = "chacha20-poly1305";

/**
 * Opaque handle returned by importEncryptionKey. Previously a Web Crypto
 * CryptoKey (needed to avoid re-importing the key per AES-GCM chunk). With
 * native node:crypto there is no expensive key-import step, so this simply
 * carries validated raw key bytes. Kept as a distinct type so the streaming
 * call sites (importEncryptionKey + useSymmetricEncryptWithCryptoKey) need no
 * changes.
 */
export interface ImportedEncryptionKey {
  readonly __brand: "ImportedEncryptionKey";
  readonly key: Buffer;
}

/**
 * Validates a raw 32-byte key and returns an imported-key handle.
 * Call once, then pass the result to useSymmetricEncryptWithCryptoKey for each chunk.
 */
// deno-lint-ignore require-await
export async function importEncryptionKey(key: Uint8Array): Promise<ImportedEncryptionKey> {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throwHttpError("ENCRYPTION.INVALID_MASTER_KEY");
  }
  return {
    __brand: "ImportedEncryptionKey",
    key: Buffer.from(key),
  };
}

/**
 * Encrypts data using a pre-imported key handle. Avoids re-validating the key
 * on every call, which matters for streaming encryption (many chunks, same key).
 */
// deno-lint-ignore require-await
export const useSymmetricEncryptWithCryptoKey = async ({
  cryptoKey,
  data,
  nonce,
  includeNonce = true,
}: {
  cryptoKey: ImportedEncryptionKey;
  data: Uint8Array;
  nonce?: Uint8Array;
  includeNonce?: boolean;
}): Promise<Uint8Array> => {
  if (!data || data.length === 0) {
    throwHttpError("ENCRYPTION.ENCRYPT_DATA_EMPTY");
  }

  try {
    const ivToUse = nonce || randomBytes(CHACHA_NONCE_LENGTH);
    return encryptWithKeyBytes(cryptoKey.key, data, ivToUse, includeNonce);
  } catch (error) {
    throwHttpError("ENCRYPTION.SYMMETRIC_ENCRYPT_FAILED", error);
  }
};

// deno-lint-ignore require-await
export const useSymmetricEncrypt = async ({
  key,
  data,
  nonce,
  includeNonce = true,
}: {
  key: Uint8Array;
  data: string | Uint8Array;
  nonce?: Uint8Array;
  includeNonce?: boolean;
}): Promise<Uint8Array> => {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throwHttpError("ENCRYPTION.INVALID_MASTER_KEY");
  }

  if (
    !data || (typeof data === "string" && data.length === 0) ||
    (data instanceof Uint8Array && data.length === 0)
  ) {
    throwHttpError("ENCRYPTION.ENCRYPT_DATA_EMPTY");
  }

  if (nonce && (!(nonce instanceof Uint8Array) || nonce.length !== CHACHA_NONCE_LENGTH)) {
    throwHttpError("ENCRYPTION.NONCE_MUST_BE_12_BYTES");
  }

  try {
    const dataBytes = typeof data === "string" ? TextTransformations.base64ToBuffer(data) : data;

    const ivToUse = nonce || randomBytes(CHACHA_NONCE_LENGTH); // Provided nonce or fresh random 12-byte nonce

    return encryptWithKeyBytes(key, dataBytes, ivToUse, includeNonce);
  } catch (error) {
    throwHttpError("ENCRYPTION.SYMMETRIC_ENCRYPT_FAILED", error);
  }
};

/**
 * Core ChaCha20-Poly1305 encryption. Produces [nonce | ciphertext | tag] when
 * includeNonce is true, or [ciphertext | tag] when false (seekable encryption
 * where the nonce is managed separately).
 */
function encryptWithKeyBytes(
  key: Uint8Array,
  data: Uint8Array,
  nonce: Uint8Array,
  includeNonce: boolean,
): Uint8Array {
  const cipher = createCipheriv(
    CIPHER_ALGORITHM,
    key,
    nonce,
    { authTagLength: CHACHA_TAG_LENGTH },
  );

  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  if (includeNonce) {
    const result = new Uint8Array(nonce.length + ciphertext.length + tag.length);
    result.set(nonce, 0);
    result.set(ciphertext, nonce.length);
    result.set(tag, nonce.length + ciphertext.length);
    return result;
  }

  // Return [ciphertext | tag] only (nonce managed externally by the caller).
  const result = new Uint8Array(ciphertext.length + tag.length);
  result.set(ciphertext, 0);
  result.set(tag, ciphertext.length);
  return result;
}

/**
 * Decrypts data encrypted with useSymmetricEncrypt using ChaCha20-Poly1305.
 * Expects [nonce (12 bytes) | ciphertext | tag (16 bytes)] when hasNonce is true.
 *
 * @param key - The decryption key as a Uint8Array (32 bytes).
 * @param data - The encrypted data (Uint8Array).
 * @param nonce - Optional nonce (12 bytes); required when hasNonce is false.
 * @param hasNonce - Whether the data includes the nonce prefix.
 * @returns Promise<Uint8Array> The decrypted data.
 */
// deno-lint-ignore require-await
export const useSymmetricDecrypt = async ({
  key,
  data,
  nonce,
  hasNonce = true,
}: {
  key: Uint8Array;
  data: Uint8Array;
  nonce?: Uint8Array;
  hasNonce?: boolean;
}): Promise<Uint8Array> => {
  if (!(key instanceof Uint8Array) || key.length !== 32) {
    throwHttpError("ENCRYPTION.INVALID_MASTER_KEY");
  }

  if (!data || !(data instanceof Uint8Array)) {
    throwHttpError("ENCRYPTION.ENCRYPTED_DATA_UINT8ARRAY_REQUIRED");
  }

  if (
    !hasNonce &&
    (!nonce || !(nonce instanceof Uint8Array) || nonce.length !== CHACHA_NONCE_LENGTH)
  ) {
    throwHttpError("ENCRYPTION.NONCE_REQUIRED_WHEN_ABSENT");
  }

  try {
    let ivToUse: Uint8Array;
    let ciphertextWithTag: Uint8Array;

    if (hasNonce) {
      // Validate minimum length (nonce + at least 1 byte ciphertext + tag).
      const MIN_ENCRYPTED_LENGTH = CHACHA_NONCE_LENGTH + CHACHA_TAG_LENGTH;
      if (data.length < MIN_ENCRYPTED_LENGTH) {
        throwHttpError("ENCRYPTION.ENCRYPTED_DATA_TOO_SHORT_FOR_NONCE");
      }

      // Extract nonce and ciphertext+tag.
      ivToUse = data.slice(0, CHACHA_NONCE_LENGTH);
      ciphertextWithTag = data.slice(CHACHA_NONCE_LENGTH);

      if (ivToUse.length !== CHACHA_NONCE_LENGTH) {
        throwHttpError("ENCRYPTION.NONCE_LENGTH_INVALID_IN_DATA");
      }
    } else {
      // Use provided nonce and treat all data as ciphertext+tag.
      ivToUse = nonce!;
      ciphertextWithTag = data;
    }

    return decryptWithKeyBytes(key, ciphertextWithTag, ivToUse);
  } catch (error) {
    throwHttpError("ENCRYPTION.SYMMETRIC_DECRYPT_FAILED", error);
  }
};

/**
 * Core ChaCha20-Poly1305 decryption. Expects ciphertextWithTag laid out as
 * [ciphertext | tag (16 bytes)] and verifies the Poly1305 tag.
 */
function decryptWithKeyBytes(
  key: Uint8Array,
  ciphertextWithTag: Uint8Array,
  nonce: Uint8Array,
): Uint8Array {
  if (ciphertextWithTag.length < CHACHA_TAG_LENGTH) {
    throw new Error("Ciphertext too short to contain authentication tag");
  }

  const tagStart = ciphertextWithTag.length - CHACHA_TAG_LENGTH;
  const ciphertext = ciphertextWithTag.subarray(0, tagStart);
  const tag = ciphertextWithTag.subarray(tagStart);

  const decipher = createDecipheriv(
    CIPHER_ALGORITHM,
    key,
    nonce,
    { authTagLength: CHACHA_TAG_LENGTH },
  );
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return new Uint8Array(decrypted.buffer, decrypted.byteOffset, decrypted.byteLength);
}
