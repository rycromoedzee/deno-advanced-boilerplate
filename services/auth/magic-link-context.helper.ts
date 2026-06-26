/**
 * @file services/auth/magic-link-context.helper.ts
 * @description Pure, testable request-context helpers for magic-link auth.
 *
 * These extract the security-relevant *decision logic* (UA normalization/hashing
 * + creator/consumer context comparison) into pure functions so they can be
 * unit-tested directly (repo seam discipline: pure in-process utilities are
 * tested through their interface, no DB/network). The service and the Phase B
 * handlers call these — they never reach into hashing/network internals.
 *
 * Security contract (see Decision Gate G3):
 *   - The raw User-Agent is NEVER persisted — only its normalized blake3 hash.
 *   - Context comparison is LOG-ONLY and NEVER blocks login (mobile cell↔Wi-Fi
 *     flips, CGNAT, IPv6 RFC 4941 rotation, VPN/proxy egress, and legitimate
 *     multi-device use all change IP/UA legitimately).
 *   - A mismatch is only claimable when BOTH creator and consumer captured a
 *     value, so an older link / unavailable-at-issue context never fires a
 *     false alarm.
 */

import { HASHING_CONTEXTS, TextHashing } from "@utils/text/index.ts";
import { bytesToHex } from "@deps";

/**
 * Strips volatile version/detail substrings from a UA so minor browser/OS
 * updates do not manufacture false "device changed" signals. Mirrors the
 * normalization philosophy used by the rate-limit fingerprinting.
 *
 *   "Mozilla/5.0 (Macintosh) Chrome/124.0.6367.91" → "mozilla/5.0 (macintosh) chrome/?"
 */
export function normalizeUserAgent(ua: string): string {
  return (ua || "")
    .replace(/\/[\d.[\]_]*/g, "/?") // Chrome/124.0.6367.91 -> Chrome/?
    .toLowerCase()
    .trim();
}

/**
 * blake3 hash of the normalized UA under the auth-fingerprint context.
 * The raw UA is never persisted — callers store/compare only this hash.
 */
export function hashUserAgent(ua: string): string {
  return bytesToHex(
    TextHashing.generateHashFromString(
      normalizeUserAgent(ua),
      HASHING_CONTEXTS.AUTH_FINGERPRINT,
    ),
  );
}

/**
 * Request context captured at issuance and compared (log-only) at consumption.
 * `creatorIP` is the anonymizable raw IP (anonymized before any logging);
 * `creatorUAHash` is always the hash, never the raw UA.
 */
export type MagicLinkContext = {
  creatorIP: string;
  creatorUAHash: string;
};

/**
 * Compare consumer context against the context captured at issuance.
 *
 * Returns a mismatch flag ONLY when BOTH sides have a value, so a missing
 * creator context (older link / unavailable at issue) never fires a false
 * alarm. The caller treats the result as LOG-ONLY — it must NEVER block login
 * (see Decision Gate G3).
 */
export function detectContextMismatch(
  creator: MagicLinkContext,
  consumer: MagicLinkContext,
): { ipMismatch: boolean; uaMismatch: boolean } {
  const ipMismatch = !!creator.creatorIP && !!consumer.creatorIP &&
    creator.creatorIP !== consumer.creatorIP;
  const uaMismatch = !!creator.creatorUAHash && !!consumer.creatorUAHash &&
    creator.creatorUAHash !== consumer.creatorUAHash;
  return { ipMismatch, uaMismatch };
}
