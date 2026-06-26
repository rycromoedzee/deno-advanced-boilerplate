/**
 * @file services/auth/passkey-strict-verifier.service.ts
 * @description Passkey verifier that enforces user verification (UV)
 */

import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  type PublicKeyCredentialRequestOptionsJSON,
  randomBytes,
  type VerifiedAuthenticationResponse,
  verifyAuthenticationResponse,
} from "@deps";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { ChallengeCleanupService } from "./passkey-challenge-cleanup.service.ts";
import { AuthServiceCacheKeys } from "@utils/auth/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { envConfig } from "@config/env.ts";
import { getWebAuthnExpectedOrigins } from "@utils/network/index.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import type { IAuthWebAuthnCredential } from "@interfaces/auth.ts";
import type { IPRFEvaluationRequest } from "@services/encryption/index.ts";

export class StrictPasskeyVerifier {
  /**
   * Build authentication options with UV required
   */
  static async buildStrictAuthConfig(
    _hostname: string,
    credentials: { id: string; transports?: AuthenticatorTransportFuture[] }[],
  ): Promise<{ attemptId: string; requestOptions: PublicKeyCredentialRequestOptionsJSON }> {
    const attemptId = TextTransformations.fromBufferToBase64UrlString(
      new Uint8Array(randomBytes(32)).buffer,
    );

    const rpID = envConfig.baseDomain;
    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials,
      userVerification: "required",
    });

    const cache = await getCache();
    const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
    await cache.set(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      cacheKey,
      options.challenge,
      { ttl: 60 },
    );

    return { attemptId, requestOptions: options };
  }

  /**
   * Build authentication options with UV required and PRF extension enabled
   */
  static async buildStrictAuthConfigWithPRF(
    _hostname: string,
    credentials: { id: string; transports?: AuthenticatorTransportFuture[] }[],
    prfSaltsByCredential: Record<string, string>,
  ): Promise<{
    attemptId: string;
    requestOptions: PublicKeyCredentialRequestOptionsJSON;
    prfEvaluationRequest: IPRFEvaluationRequest;
  }> {
    const attemptId = TextTransformations.fromBufferToBase64UrlString(
      new Uint8Array(randomBytes(32)).buffer,
    );

    const rpID = envConfig.baseDomain;
    const prfExtension = {
      prf: {
        evalByCredential: Object.fromEntries(
          Object.entries(prfSaltsByCredential).map(([credentialId, salt]) => [
            credentialId,
            { first: salt },
          ]),
        ),
      },
    };

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials: credentials,
      userVerification: "required",
      extensions: prfExtension as Record<string, unknown>,
    });

    const cache = await getCache();
    const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
    await cache.set(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      cacheKey,
      options.challenge,
      { ttl: 60 },
    );

    await cache.set(
      CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
      `${cacheKey}:prf_salt_by_credential`,
      prfSaltsByCredential,
      { ttl: 120 },
    );

    return {
      attemptId,
      requestOptions: options,
      prfEvaluationRequest: { saltsByCredential: prfSaltsByCredential },
    };
  }

  /**
   * Verify authentication with UV enforcement
   */
  static async verifyStrictAuth(
    credential: IAuthWebAuthnCredential,
    response: AuthenticationResponseJSON,
    attemptId: string,
    _url: URL,
  ): Promise<{ authenticationInfo: VerifiedAuthenticationResponse["authenticationInfo"] }> {
    const expectedChallenge = await ChallengeCleanupService.consumeChallenge(attemptId);

    if (!expectedChallenge) {
      throwHttpError("AUTH.SESSION_EXPIRED");
    }

    // Use base domain for RP ID so passkeys work across all subdomains; accept
    // any allow-listed origin under that base domain.
    const rpID = envConfig.baseDomain;
    const expectedOrigin = getWebAuthnExpectedOrigins();

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin,
      expectedRPID: rpID,
      requireUserVerification: true,
      credential: {
        id: credential.id,
        publicKey: new Uint8Array(
          TextTransformations.fromBase64URLStringToBuffer(credential.publicKey),
        ),
        counter: credential.counter,
        transports: credential.transports,
      },
    });

    if (!verification.verified) {
      throwHttpError("AUTH.INVALID_CREDENTIALS");
    }

    if (!verification.authenticationInfo?.userVerified) {
      useLogger(LoggerLevels.warn, {
        message: "Passkey authentication rejected - user verification not performed",
        messageKey: "passkey.strict_uv_failed",
        section: loggerAppSections.AUTH,
      });
      throwHttpError("AUTH.USER_VERIFICATION_REQUIRED");
    }

    return { authenticationInfo: verification.authenticationInfo! };
  }
}
