/**
 * @file services/auth/passkey-challenge-cleanup.service.ts
 * @description Helpers for consuming and cleaning up passkey challenges/attempts
 */

import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { AuthServiceCacheKeys } from "@utils/auth/index.ts";

export class ChallengeCleanupService {
  /**
   * Atomically consume a challenge (single-use)
   */
  static async consumeChallenge(attemptId: string): Promise<string | null> {
    const cache = await getCache();
    const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);

    return await cache.getAndDelete<string>(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      cacheKey,
    );
  }

  /**
   * Clean up attempt data (login attempt) and PRF salt
   */
  static async cleanupAttempt(attemptId: string): Promise<void> {
    const cache = await getCache();
    const challengeKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(
      attemptId,
    );
    const attemptKey = AuthServiceCacheKeys.generatePasskeyAttemptKey(
      attemptId,
    );

    await Promise.all([
      cache.delete(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, `${challengeKey}:prf_salt`),
      cache.delete(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, `${challengeKey}:prf_salt_by_credential`),
      cache.delete(CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE, attemptKey),
    ]);
  }
}
