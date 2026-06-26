/**
 * @file services/token/token-helper.service.ts
 * @description Token Helper service (token)
 */
import { jwtSign, JwtTokenExpired, JwtTokenInvalid, JwtTokenNotBefore, JwtTokenSignatureMismatched, jwtVerify } from "@deps";
import { envConfig } from "@config/env.ts";
import { AppHttpException, throwHttpError } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { constantTimeMultiCompare, ensureMinimumProcessingTime, getTimeNow, TIMING_PROFILES } from "@utils/shared/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
import { traced, tracedSync } from "@services/tracing/index.ts";

// https://github.com/honojs/hono/blob/main/src/utils/jwt/jwa.ts
export enum JWTTokenAlgorithmTypes {
  HS256 = "HS256",
  HS384 = "HS384",
  HS512 = "HS512",
  RS256 = "RS256",
  RS384 = "RS384",
  RS512 = "RS512",
  PS256 = "PS256",
  PS384 = "PS384",
  PS512 = "PS512",
  ES256 = "ES256",
  ES384 = "ES384",
  ES512 = "ES512",
  EdDSA = "EdDSA",
}

const VALID_ALGORITHMS = Object.values(JWTTokenAlgorithmTypes);

interface IJWTConfig {
  privateKey: string | undefined;
  publicKey: string | undefined;
  algo: string;
  curve: string;
}

interface IPrivateJWK {
  kty: "OKP";
  crv: string;
  d: string;
}

interface IPublicJWK {
  kty: "OKP";
  crv: string;
  x: string;
}

/**
 * Converts a base64 key to URL-safe base64url format.
 */
function toBase64Url(key: string): string {
  return key.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export class TokenHelperService {
  /**
   * Retrieves and validates JWT configuration from environment variables.
   *
   * @throws {Error} Configuration error - only thrown during application startup
   * when JWT configuration is missing or invalid. These are fatal configuration
   * errors that should crash the application rather than return HTTP errors,
   * as they indicate a deployment/environment problem that cannot be recovered
   * from at runtime.
   */
  private getJWTConfig(): IJWTConfig {
    const { jwtPrivate: privateKey, jwtPublic: publicKey, jwtAlgo: algo, jwtCurve: curve } = envConfig.auth;

    if (!algo?.trim() || !curve) {
      throw new Error("Missing JWT algorithm or curve configuration in ENV");
    }

    if (!privateKey && !publicKey) {
      throw new Error("Missing JWT key configuration in ENV");
    }

    // Validate algorithm against supported types
    if (!VALID_ALGORITHMS.includes(algo as JWTTokenAlgorithmTypes)) {
      // Log details server-side only (don't expose valid algorithms in error)
      useLogger(LoggerLevels.error, {
        message: "Invalid JWT algorithm in configuration",
        messageKey: "jwt.invalid_algorithm",
        section: loggerAppSections.JWT,
        details: { provided: algo },
      });
      throw new Error("Invalid JWT algorithm configuration");
    }

    return { privateKey, publicKey, algo, curve };
  }

  /**
   * Builds a private JWK from the configured private key.
   *
   * @throws {Error} Configuration error - only thrown during application startup
   * when JWT private key is not configured. This is a fatal configuration error.
   */
  private buildPrivateJWK(config: IJWTConfig): IPrivateJWK {
    if (!config.privateKey) {
      throw new Error("JWT private key not configured");
    }
    return {
      kty: "OKP",
      crv: config.curve,
      d: toBase64Url(config.privateKey),
    };
  }

  /**
   * Builds a public JWK from the configured public key.
   *
   * @throws {Error} Configuration error - only thrown during application startup
   * when JWT public key is not configured. This is a fatal configuration error.
   */
  private buildPublicJWK(config: IJWTConfig): IPublicJWK {
    if (!config.publicKey) {
      throw new Error("JWT public key not configured");
    }
    return {
      kty: "OKP",
      crv: config.curve,
      x: toBase64Url(config.publicKey),
    };
  }

  /**
   * CRITICAL: Secure JWT claims validation with timing-attack protection
   *
   * This prevents timing attacks that could leak information about valid
   * issuers, audiences, or other claims by using constant-time comparison.
   *
   * ALWAYS performs all validations regardless of early failures to prevent
   * attackers from using response time to determine which claim failed.
   *
   * @param payload - JWT payload to validate
   * @param expectedIssuer - Expected issuer value
   * @param expectedAudience - Expected audience value
   * @returns boolean - True if all claims are valid, false otherwise
   */
  private validateJWTClaims(
    payload: Record<string, unknown>,
    expectedIssuer: string,
    expectedAudience: string,
  ): boolean {
    return tracedSync("TokenHelperService.validateJWTClaims", "auth", (span) => {
      const now = Math.floor(getTimeNow() / 1000); // Convert to seconds for JWT comparison
      span.attributes["expected_issuer"] = expectedIssuer;
      span.attributes["expected_audience"] = expectedAudience;

      // Extract claims safely
      const actualIssuer = String(payload.iss || "");
      const actualAudience = String(payload.aud || "");
      const exp = typeof payload.exp === "number" ? payload.exp : 0;
      const iat = typeof payload.iat === "number" ? payload.iat : 0;
      const nbf = typeof payload.nbf === "number" ? payload.nbf : 0;

      span.attributes["exp"] = exp;
      span.attributes["iat"] = iat;
      span.attributes["nbf"] = nbf;
      span.attributes["now"] = now;

      // TIMING ATTACK PROTECTION: Use constant-time comparison for ALL string claims
      const claimComparisons = [
        { a: actualIssuer, b: expectedIssuer },
        { a: actualAudience, b: expectedAudience },
      ];

      const claimsValid = constantTimeMultiCompare(claimComparisons);
      span.attributes["claims_valid"] = claimsValid;

      // Time-based validations (these are typically not timing-sensitive)
      const notExpired = exp > now;
      const notBeforeValid = nbf <= now; // Token is not being used before nbf time
      const notTooEarly = iat <= (now + 60); // Allow 60 seconds clock skew

      span.attributes["not_expired"] = notExpired;
      span.attributes["not_before_valid"] = notBeforeValid;
      span.attributes["not_too_early"] = notTooEarly;

      // Return combined result - all validations must pass
      const isValid = claimsValid && notExpired && notBeforeValid && notTooEarly;
      span.attributes["is_valid"] = isValid;

      // Log validation attempt for security monitoring (without sensitive data)
      if (!isValid) {
        useLogger(LoggerLevels.warn, {
          message: "JWT claims validation failed",
          messageKey: "JWT.Claims_Validation_Failed",
          section: loggerAppSections.JWT,
          raw: {
            hasValidClaims: claimsValid,
            hasValidTiming: notExpired && notBeforeValid && notTooEarly,
            currentTime: now,
            tokenTimes: { nbf, iat, exp },
            issuerMatch: actualIssuer === expectedIssuer,
            audienceMatch: actualAudience === expectedAudience,
          },
        });
      }

      return isValid;
    });
  }

  /**
   * Signs a JWT token using the configured private key and algorithm with timing attack protection.
   * @param expiration - Token expiration in seconds.
   * @param sub - Subject (user ID).
   * @param type - JWT token type.
   * @param audience - Audience for the token.
   * @param meta - Optional additional payload fields.
   * @returns Promise<string> The signed JWT token.
   */
  async signTokenJWT(
    expiration: number,
    sub: string,
    type: JWT_TOKEN_TYPES,
    audience: (typeof JWT_TOKEN_CONFIG.audiences)[keyof typeof JWT_TOKEN_CONFIG.audiences],
    meta?: Record<string, unknown>,
  ) {
    return await traced("TokenHelperService.signTokenJWT", "service", async (span) => {
      const startTime = performance.now();
      span.attributes["expiration"] = expiration;
      span.attributes["subject"] = sub;
      span.attributes["token_type"] = type;
      span.attributes["audience"] = audience;
      span.attributes["has_meta"] = !!meta;

      try {
        const config = this.getJWTConfig();
        const jwk = this.buildPrivateJWK(config);
        span.attributes["algorithm"] = config.algo;

        const now = Math.floor(getTimeNow() / 1000); // Convert to seconds for JWT
        const fullPayload = {
          iss: JWT_TOKEN_CONFIG.issuer,
          aud: audience,
          sub,
          iat: now,
          nbf: now,
          exp: now + expiration,
          type,
          ...meta,
        };

        const token = await traced("signTokenJWT.jwtSign", "auth", async (signSpan) => {
          const result = await jwtSign(
            fullPayload,
            jwk,
            config.algo as JWTTokenAlgorithmTypes,
          );
          signSpan.attributes["success"] = true;
          return result;
        });

        span.attributes["success"] = true;
        return token;
      } catch (error) {
        // TIMING ATTACK PROTECTION: Ensure consistent processing time for signing errors
        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.STANDARD,
        );

        if (error instanceof AppHttpException) {
          throw error;
        }

        // caller owns logging
        throwHttpError("COMMON.INTERNAL_SERVER_ERROR", error);
      }
    });
  }

  /**
   * Verifies a JWT access token, checks session cache, and validates claims with timing attack protection.
   * @param token - The JWT token to verify.
   * @param expectedAudience - Expected audience value for the token.
   * @returns Promise<IJWTPayload|null> The decoded payload if valid, or null if verification fails.
   * @throws HTTPException if token is invalid or not authenticated.
   */
  async useVerifyTokenJWT(
    token: string,
    expectedAudience: string,
  ) {
    return await traced("TokenHelperService.useVerifyTokenJWT", "service", async (span) => {
      const startTime = performance.now();
      span.attributes["expected_audience"] = expectedAudience;

      try {
        const config = this.getJWTConfig();
        const jwk = this.buildPublicJWK(config);
        span.attributes["algorithm"] = config.algo;

        const payload = await jwtVerify(
          token,
          jwk,
          config.algo as JWTTokenAlgorithmTypes,
        );

        // Use secure validation with timing-attack protection
        const claimsValid = this.validateJWTClaims(
          payload,
          JWT_TOKEN_CONFIG.issuer,
          expectedAudience,
        );

        if (!claimsValid) {
          span.attributes["success"] = false;
          span.attributes["failure_reason"] = "claims_validation_failed";
          await ensureMinimumProcessingTime(
            startTime,
            TIMING_PROFILES.STANDARD,
          );

          throwHttpError("AUTH.UNAUTHORIZED");
        }

        span.attributes["success"] = true;
        span.attributes["token_type"] = payload.type as string;
        span.attributes["subject"] = payload.sub as string;
        return payload;
      } catch (error) {
        span.attributes["success"] = false;

        await ensureMinimumProcessingTime(
          startTime,
          TIMING_PROFILES.STANDARD,
        );

        if (error instanceof AppHttpException) {
          // Set failure reason based on error type if possible
          if (!span.attributes["failure_reason"]) {
            span.attributes["failure_reason"] = "token_verification_failed";
          }
          throw error;
        }

        // Hono's jwtVerify throws typed errors for the normal, expected
        // outcomes of token validation (expired / malformed / not-yet-valid /
        // bad signature). These are NOT internal failures — an expired access
        // token is routine and the client recovers via the refresh flow — so
        // they must not be logged at CRITICAL. Map them to a plain 401.
        if (
          error instanceof JwtTokenExpired ||
          error instanceof JwtTokenInvalid ||
          error instanceof JwtTokenNotBefore ||
          error instanceof JwtTokenSignatureMismatched
        ) {
          span.attributes["failure_reason"] = error instanceof JwtTokenExpired
            ? "token_expired"
            : error instanceof JwtTokenNotBefore
            ? "token_not_yet_valid"
            : error instanceof JwtTokenSignatureMismatched
            ? "token_signature_mismatch"
            : "token_invalid";

          throwHttpError("AUTH.UNAUTHORIZED");
        }

        span.attributes["failure_reason"] = "unexpected_error";

        useLogger(LoggerLevels.critical, {
          message: "JWT => Failed to run token validation function!",
          messageKey: "JWT.Token_Verification_Failed",
          section: loggerAppSections.JWT,
          raw: error,
        });

        throwHttpError("AUTH.UNAUTHORIZED");
      }
    });
  }
}
