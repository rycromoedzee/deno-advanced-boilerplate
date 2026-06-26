/**
 * @file services/auth/passkey-auth.service.ts
 * @description Passkey Auth service (auth)
 */
import {
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
  type Base64URLString,
  generateAuthenticationOptions,
  type GenerateAuthenticationOptionsOpts,
  generateRegistrationOptions,
  type GenerateRegistrationOptionsOpts,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  randomBytes,
  type RegistrationResponseJSON,
  type VerifiedAuthenticationResponse,
  type VerifiedRegistrationResponse,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  z,
} from "@deps";
import { throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections } from "@logger/index.ts";
import type { IAuthWebAuthnCredential } from "@interfaces/auth.ts";
import { CACHE_NAMESPACES, getCache } from "@services/cache/index.ts";
import { TextTransformations } from "@utils/text/index.ts";
import { ensureMinimumProcessingTime, TIMING_PROFILES } from "@utils/shared/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { AuthServiceCacheKeys } from "@utils/auth/index.ts";
import { ChallengeCleanupService } from "./passkey-challenge-cleanup.service.ts";
import { envConfig } from "@config/env.ts";
import { getWebAuthnExpectedOrigins } from "@utils/network/index.ts";
import type { IPRFEvaluationRequest } from "@services/encryption/index.ts";

/**
 * Supported WebAuthn algorithm identifiers:
 * -7: ES256 (ECDSA with SHA-256)
 * -257: RS256 (RSA with SHA-256)
 * -8: ES384 (ECDSA with SHA-384)
 * These are the most commonly supported algorithms for WebAuthn credentials
 */
const PasskeySupportedAlgorithmIDs = [-7, -257, -8];

const YUBIKEY_PREFERRED_TRANSPORTS: AuthenticatorTransportFuture[] = [
  "usb",
  "nfc",
  "ble",
  "hybrid",
];

/**
 * Internal helper functions for passkey operations
 */

/**
 * Stores a WebAuthn challenge in cache for later verification
 *
 * @param attemptId - Unique identifier for the authentication attempt
 * @param challenge - The WebAuthn challenge string to store
 * @returns Promise that resolves to the attemptId
 */
const storeChallenge = async (
  attemptId: string,
  challenge: string,
): Promise<string> => {
  const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
  await (await getCache()).set<string>(
    CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
    cacheKey,
    challenge,
    { ttl: 60 },
  );
  return attemptId;
};

/**
 * Atomically consumes a stored WebAuthn challenge from cache
 */
const consumeChallenge = async (attemptId: string): Promise<string | null> => {
  return await ChallengeCleanupService.consumeChallenge(attemptId);
};

/**
 * Service class for handling WebAuthn passkey registration operations.
 * Provides methods for generating registration options and processing registration responses.
 */
export class AuthPasskeyRegistrationService {
  /**
   * Builds WebAuthn registration configuration options for a user
   *
   * @param params - Configuration parameters
   * @param params.urlHostName - The hostname of the relying party
   * @param params.userName - The username for the registration
   * @returns Promise that resolves to an object containing attemptId and creation options
   * @throws HTTPException with status 500 if configuration generation fails
   */
  static async buildRegistrationConfig({
    urlHostName,
    userName,
    displayName,
  }: {
    urlHostName: string;
    userName: string;
    displayName?: string;
  }): Promise<
    {
      attemptId: string;
      creationOptions: PublicKeyCredentialCreationOptionsJSON;
    }
  > {
    return await tracedWithServiceErrorHandling(
      "AuthPasskeyRegistrationService.buildRegistrationConfig",
      {
        service: "AuthPasskeyRegistrationService",
        method: "buildRegistrationConfig",
        section: loggerAppSections.PASSKEYS,
        details: { userName, urlHostName },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["url_host_name"] = urlHostName;
        span.attributes["user_name"] = userName;

        const attemptId = TextTransformations.fromBufferToBase64UrlString(
          new Uint8Array(randomBytes(32)).buffer,
        );

        // Use base domain for RP ID to allow passkeys to work across all subdomains
        const rpID = envConfig.baseDomain;

        const rpName = envConfig.public.appName || urlHostName;

        const _config = {
          rpID: rpID,
          rpName,
          userName: userName,
          userDisplayName: displayName ?? userName,
          authenticatorSelection: {
            userVerification: "preferred",
            residentKey: "preferred",
          },
          supportedAlgorithmIDs: PasskeySupportedAlgorithmIDs,
        } satisfies GenerateRegistrationOptionsOpts;

        const options = await generateRegistrationOptions(
          _config as GenerateRegistrationOptionsOpts,
        );
        await storeChallenge(attemptId, options.challenge);

        span.attributes["success"] = true;
        return {
          attemptId,
          creationOptions: options,
        };
      },
      {
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey registration configuration failed: ${message}`,
            messageKey: "passkeys.registration.config.failed",
            details: { userName },
          };
        },
      },
    );
  }

  /**
   * Processes and verifies a WebAuthn registration response
   *
   * @param params - Registration parameters
   * @param params.passkeyRegistrationBody - The registration response from the client
   * @param params.attemptId - The attempt ID used to retrieve the stored challenge
   * @param params.urlHostName - The hostname of the relying party
   * @param params.url - The full URL for origin verification
   * @returns Promise that resolves to credential and registration info
   * @throws HTTPException with status 400 if verification fails or challenge not found
   */
  static async register({
    passkeyRegistrationBody,
    attemptId,
    urlHostName,
    url: _url,
  }: {
    passkeyRegistrationBody: RegistrationResponseJSON;
    attemptId: string;
    urlHostName: string;
    url: string;
  }): Promise<
    {
      credential: IAuthWebAuthnCredential;
      registrationInfo: VerifiedRegistrationResponse["registrationInfo"];
    }
  > {
    return await tracedWithServiceErrorHandling(
      "AuthPasskeyRegistrationService.register",
      {
        service: "AuthPasskeyRegistrationService",
        method: "register",
        section: loggerAppSections.PASSKEYS,
        details: { urlHostName, attemptId: attemptId.substring(0, 8) + "..." },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["url_host_name"] = urlHostName;
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";

        // Retrieve and consume the stored challenge using attemptId
        const expectedChallenge = await consumeChallenge(attemptId);

        if (!expectedChallenge) {
          span.attributes["failure_reason"] = "challenge_not_found";
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        // Use base domain for RP ID so passkeys work across all subdomains.
        // The frontend runs on a subdomain, so origin
        // verification must accept any allow-listed origin under the base domain
        // rather than assuming the bare base-domain origin.
        const rpID = envConfig.baseDomain;
        const expectedOrigin = getWebAuthnExpectedOrigins();

        const verification = await verifyRegistrationResponse({
          response: passkeyRegistrationBody,
          expectedChallenge,
          expectedOrigin: expectedOrigin,
          expectedRPID: rpID,
          requireUserVerification: false,
          supportedAlgorithmIDs: PasskeySupportedAlgorithmIDs,
        });

        if (!verification.verified) {
          span.attributes["failure_reason"] = "verification_failed";
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        const credential: IAuthWebAuthnCredential = {
          id: verification.registrationInfo!.credential.id,
          publicKey: TextTransformations.fromBufferToBase64UrlString(
            verification.registrationInfo!.credential.publicKey
              .buffer as ArrayBuffer,
          ),
          counter: verification.registrationInfo!.credential.counter,
          backedUp: verification.registrationInfo!.credentialBackedUp,
          transports: verification.registrationInfo!.credential.transports ||
            YUBIKEY_PREFERRED_TRANSPORTS,
        };

        await ChallengeCleanupService.cleanupAttempt(attemptId);

        span.attributes["success"] = true;
        span.attributes["credential_backed_up"] = credential.backedUp;
        return {
          credential,
          registrationInfo: verification.registrationInfo!,
        };
      },
      {
        onUnexpected: async () => {
          await ChallengeCleanupService.cleanupAttempt(attemptId);
        },
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey registration failed: ${message}`,
            messageKey: "passkeys.registration.failed",
            details: {
              urlHostName,
              attemptId: attemptId.substring(0, 8) + "...",
            },
          };
        },
      },
    );
  }

  /**
   * Validates the minimum required payload for passkey registration
   *
   * @param payload - The payload to validate
   * @throws HTTPException with status 400 if validation fails
   */
  static validateMinimumPayload(payload: unknown): void {
    const result = z
      .object({
        userName: z.string().min(1).toLowerCase().trim(),
        beginConfig: z.boolean(),
      })
      .safeParse(payload);

    if (!result.success) {
      throwHttpError("VALIDATION.SCHEMA_VALIDATION_FAILED");
    }
  }

  /**
   * Builds WebAuthn registration configuration with PRF extension enabled
   * This allows passkey-only users to derive encryption keys from their authenticator
   *
   * @param params - Configuration parameters
   * @param params.urlHostName - The hostname of the relying party
   * @param params.userName - The username for the registration
   * @returns Promise that resolves to an object containing attemptId, creation options, and PRF salt
   * @throws HTTPException with status 500 if configuration generation fails
   */
  static async buildRegistrationConfigWithPRF({
    urlHostName,
    userName,
    displayName,
  }: {
    urlHostName: string;
    userName: string;
    displayName?: string;
  }): Promise<
    {
      attemptId: string;
      creationOptions: PublicKeyCredentialCreationOptionsJSON & {
        extensions?: { prf?: Record<string, unknown> };
      };
      prfSalt: string;
    }
  > {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "AuthPasskeyRegistrationService.buildRegistrationConfigWithPRF",
      {
        service: "AuthPasskeyRegistrationService",
        method: "buildRegistrationConfigWithPRF",
        section: loggerAppSections.PASSKEYS,
        details: { userName, urlHostName },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["url_host_name"] = urlHostName;
        span.attributes["user_name"] = userName;

        const attemptId = TextTransformations.fromBufferToBase64UrlString(
          new Uint8Array(randomBytes(32)).buffer,
        );

        // Generate PRF salt for this registration
        const prfSaltBytes = randomBytes(32);
        const prfSalt = TextTransformations.fromBufferToBase64(prfSaltBytes);

        // Use base domain for RP ID to allow passkeys to work across all subdomains
        const rpID = envConfig.baseDomain;

        const rpName = envConfig.public.appName || urlHostName;

        const _config: GenerateRegistrationOptionsOpts & {
          extensions?: Record<string, unknown>;
        } = {
          rpID: rpID,
          rpName,
          userName: userName,
          userDisplayName: displayName ?? userName,
          authenticatorSelection: {
            userVerification: "preferred",
            residentKey: "preferred",
          },
          supportedAlgorithmIDs: PasskeySupportedAlgorithmIDs,
          // Enable PRF extension for encryption key derivation
          extensions: {
            prf: {},
          },
        };

        const options = await generateRegistrationOptions(_config);

        // Store the PRF salt with the challenge for later retrieval
        const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
        await (await getCache()).set(
          CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
          `${cacheKey}:prf_salt`,
          prfSalt,
          { ttl: 120 }, // 2 minutes for registration
        );

        await storeChallenge(attemptId, options.challenge);

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);

        span.attributes["success"] = true;
        span.attributes["prf_enabled"] = true;
        return {
          attemptId,
          creationOptions: options as PublicKeyCredentialCreationOptionsJSON & {
            extensions?: { prf?: Record<string, unknown> };
          },
          prfSalt,
        };
      },
      {
        onUnexpected: async (_error) => {
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
        },
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey registration with PRF configuration failed: ${message}`,
            messageKey: "passkeys.registration.prf_config.failed",
            details: { userName },
          };
        },
      },
    );
  }
}

/**
 * Service class for handling WebAuthn passkey authentication operations.
 * Provides methods for generating authentication options and processing authentication responses.
 */
export class AuthPasskeyAuthenticationService {
  /**
   * Builds WebAuthn authentication configuration options for login
   *
   * @param params - Configuration parameters
   * @param params.hostname - The hostname of the relying party
   * @param params.storedCredentials - Array of stored credentials for the user
   * @returns Promise that resolves to request options and attempt ID
   * @throws HTTPException with status 500 if configuration generation fails
   */
  static async buildLoginConfig({
    hostname,
    storedCredentials,
  }: {
    hostname: string;
    storedCredentials:
      | { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[]
      | [];
  }): Promise<
    { requestOptions: PublicKeyCredentialRequestOptionsJSON; attemptId: string }
  > {
    const startTime = performance.now();
    const credentialCount = storedCredentials.length;

    return await tracedWithServiceErrorHandling(
      "AuthPasskeyAuthenticationService.buildLoginConfig",
      {
        service: "AuthPasskeyAuthenticationService",
        method: "buildLoginConfig",
        section: loggerAppSections.PASSKEYS,
        details: { hostname, credentialCount },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["hostname"] = hostname;
        span.attributes["credential_count"] = credentialCount;

        // Use base domain for RP ID to allow passkeys to work across all subdomains
        const rpID = envConfig.baseDomain;

        const _config = {
          rpID: rpID,
          allowCredentials: storedCredentials,
        } satisfies GenerateAuthenticationOptionsOpts;

        const options = await generateAuthenticationOptions(
          _config as GenerateAuthenticationOptionsOpts,
        );
        const attemptId = TextTransformations.fromBufferToBase64UrlString(
          new Uint8Array(randomBytes(32)).buffer,
        );

        await storeChallenge(attemptId, options.challenge);

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);

        span.attributes["success"] = true;
        return {
          requestOptions: options,
          attemptId,
        };
      },
      {
        onUnexpected: async (_error) => {
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
        },
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey authentication configuration failed: ${message}`,
            messageKey: "passkeys.authentication.config.failed",
            details: { hostname, credentialCount },
          };
        },
      },
    );
  }

  /**
   * Processes and verifies a WebAuthn authentication response for login
   *
   * @param params - Authentication parameters
   * @param params.credential - The stored credential to verify against
   * @param params.response - The authentication response from the client
   * @param params.attemptId - The attempt ID used to retrieve the stored challenge
   * @param params.url - The URL object for origin and hostname verification
   * @returns Promise that resolves to authentication info
   * @throws HTTPException with status 400 if verification fails or challenge not found
   */
  static async login({
    credential,
    response,
    attemptId,
    url,
  }: {
    credential: IAuthWebAuthnCredential;
    response: AuthenticationResponseJSON;
    attemptId: string;
    url: URL;
  }): Promise<
    { authenticationInfo: VerifiedAuthenticationResponse["authenticationInfo"] }
  > {
    const startTime = performance.now();

    return await tracedWithServiceErrorHandling(
      "AuthPasskeyAuthenticationService.login",
      {
        service: "AuthPasskeyAuthenticationService",
        method: "login",
        section: loggerAppSections.PASSKEYS,
        details: {
          credentialId: credential.id.substring(0, 8) + "...",
          attemptId: attemptId.substring(0, 8) + "...",
          hostname: url.hostname,
        },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["credential_id"] = credential.id.substring(0, 8) + "...";
        span.attributes["attempt_id"] = attemptId.substring(0, 8) + "...";
        span.attributes["hostname"] = url.hostname;

        // Retrieve and consume the stored challenge using attemptId
        const expectedChallenge = await consumeChallenge(attemptId);

        if (!expectedChallenge) {
          span.attributes["failure_reason"] = "challenge_not_found";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          throwHttpError("AUTH.SESSION_EXPIRED");
        }

        // Use base domain for RP ID so passkeys work across all subdomains.
        // The frontend runs on a subdomain, so origin
        // verification must accept any allow-listed origin under the base domain
        // rather than assuming the bare base-domain origin.
        const rpID = envConfig.baseDomain;
        const expectedOrigin = getWebAuthnExpectedOrigins();

        const verification = await verifyAuthenticationResponse({
          response: response,
          expectedChallenge,
          expectedOrigin: expectedOrigin,
          expectedRPID: rpID,
          requireUserVerification: false,
          credential: {
            id: credential.id,
            publicKey: new Uint8Array(
              TextTransformations.fromBase64URLStringToBuffer(
                credential.publicKey,
              ),
            ),
            counter: credential.counter,
            transports: credential.transports,
          },
        });

        if (!verification.verified) {
          span.attributes["failure_reason"] = "verification_failed";
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
          throwHttpError("AUTH.INVALID_CREDENTIALS");
        }

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);

        await ChallengeCleanupService.cleanupAttempt(attemptId);

        span.attributes["success"] = true;
        return {
          authenticationInfo: verification.authenticationInfo!,
        };
      },
      {
        onUnexpected: async (_error) => {
          await ChallengeCleanupService.cleanupAttempt(attemptId);
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
        },
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey authentication failed: ${message}`,
            messageKey: "passkeys.authentication.failed",
            details: {
              credentialId: credential.id.substring(0, 8) + "...",
              attemptId: attemptId.substring(0, 8) + "...",
            },
          };
        },
      },
    );
  }

  /**
   * Builds WebAuthn authentication configuration with PRF extension enabled
   * This allows passkey-only users to derive encryption keys during login
   *
   * @param params - Configuration parameters
   * @param params.hostname - The hostname of the relying party
   * @param params.storedCredentials - Array of stored credentials for the user
   * @param params.prfSalt - The PRF salt to use for key derivation
   * @returns Promise that resolves to request options, attempt ID, and PRF evaluation request
   * @throws HTTPException with status 500 if configuration generation fails
   */
  static async buildLoginConfigWithPRF({
    hostname,
    storedCredentials,
    prfSalt,
    prfSaltsByCredential,
  }: {
    hostname: string;
    storedCredentials:
      | { id: Base64URLString; transports?: AuthenticatorTransportFuture[] }[]
      | [];
    prfSalt?: string;
    prfSaltsByCredential?: Record<string, string>;
  }): Promise<
    {
      requestOptions: PublicKeyCredentialRequestOptionsJSON;
      attemptId: string;
      prfEvaluationRequest: IPRFEvaluationRequest;
    }
  > {
    const startTime = performance.now();
    const credentialCount = storedCredentials.length;

    return await tracedWithServiceErrorHandling(
      "AuthPasskeyAuthenticationService.buildLoginConfigWithPRF",
      {
        service: "AuthPasskeyAuthenticationService",
        method: "buildLoginConfigWithPRF",
        section: loggerAppSections.PASSKEYS,
        details: { hostname, credentialCount },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["hostname"] = hostname;
        span.attributes["credential_count"] = credentialCount;
        span.attributes["prf_enabled"] = true;

        // Use base domain for RP ID to allow passkeys to work across all subdomains
        const rpID = envConfig.baseDomain;

        const prfExtension = prfSaltsByCredential
          ? {
            prf: {
              evalByCredential: Object.fromEntries(
                Object.entries(prfSaltsByCredential).map(([credentialId, salt]) => [
                  credentialId,
                  { first: salt },
                ]),
              ),
            },
          }
          : {
            prf: {
              eval: {
                first: prfSalt,
              },
            },
          };

        const _config: GenerateAuthenticationOptionsOpts & {
          extensions?: Record<string, unknown>;
        } = {
          rpID: rpID,
          allowCredentials: storedCredentials,
          // Enable PRF extension for encryption key derivation
          extensions: prfExtension,
        };

        const options = await generateAuthenticationOptions(_config);
        const attemptId = TextTransformations.fromBufferToBase64UrlString(
          new Uint8Array(randomBytes(32)).buffer,
        );

        await storeChallenge(attemptId, options.challenge);

        // Store the PRF salt for retrieval during verification
        const cacheKey = AuthServiceCacheKeys.generatePasskeyChallengeKey(attemptId);
        if (prfSaltsByCredential) {
          await (await getCache()).set(
            CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
            `${cacheKey}:prf_salt_by_credential`,
            prfSaltsByCredential,
            { ttl: 120 }, // 2 minutes for login
          );
        } else if (prfSalt) {
          await (await getCache()).set(
            CACHE_NAMESPACES.AUTH.PASSKEY_CHALLENGE,
            `${cacheKey}:prf_salt`,
            prfSalt,
            { ttl: 120 }, // 2 minutes for login
          );
        }

        await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);

        span.attributes["success"] = true;
        return {
          requestOptions: options,
          attemptId,
          prfEvaluationRequest: prfSaltsByCredential ? { saltsByCredential: prfSaltsByCredential } : { salt: prfSalt },
        };
      },
      {
        onUnexpected: async (_error) => {
          await ensureMinimumProcessingTime(startTime, TIMING_PROFILES.AUTH);
        },
        logOverrides: (error) => {
          const message = error instanceof Error ? error.message : String(error);
          return {
            message: `Passkey authentication with PRF configuration failed: ${message}`,
            messageKey: "passkeys.authentication.prf_config.failed",
            details: { hostname, credentialCount },
          };
        },
      },
    );
  }
}
