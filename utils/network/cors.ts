/**
 * @file utils/network/cors.ts
 * @description CORS allowed-origins resolution
 */
import { envConfig } from "@config/env.ts";

export const getAllowedOrigins = (): string[] => {
  const configured = Deno.env.get("ALLOWED_ORIGINS")?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (configured && configured.length > 0) {
    return configured;
  }

  if (envConfig.isDevelopment) {
    return [
      "http://localhost:5173",
      "http://localhost:55555",
      "http://localhost:3000",
      "http://192.168.1.115:3000",
      "http://127.0.0.1:3000",
      "http://192.168.50.236:3000",
      "http://192.168.50.124:3000",
      "http://localhost:42101",
    ];
  }

  return [`https://${envConfig.baseDomain}`];
};

export const resolveAllowedOrigin = (origin?: string | null): string | null => {
  if (!origin) return null;
  const allowed = getAllowedOrigins();
  return allowed.includes(origin) ? origin : null;
};

/**
 * Resolves the set of origins that are valid for WebAuthn ceremonies.
 *
 * The WebAuthn RP ID is the base domain so that passkeys
 * work across all subdomains. The browser, however, reports the *exact* origin
 * where the ceremony ran. Verification must
 * therefore accept any allow-listed origin whose effective domain has the base
 * domain as a registrable suffix — i.e. the base domain itself or one of its
 * subdomains. This narrows the trusted CORS allow-list to origins that actually
 * belong to the RP ID, never accepting unrelated cross-domain origins.
 *
 * @returns Array of acceptable WebAuthn origins (may be empty if none match).
 */
export const getWebAuthnExpectedOrigins = (): string[] => {
  const baseDomain = envConfig.baseDomain;
  return getAllowedOrigins().filter((origin) => {
    let hostname: string;
    try {
      hostname = new URL(origin).hostname;
    } catch {
      return false;
    }
    return hostname === baseDomain || hostname.endsWith(`.${baseDomain}`);
  });
};
