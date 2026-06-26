/**
 * @file routes/auth/magic.route.ts
 * @description Magic-link authentication route definitions (request + consume).
 *
 * Security contract (plans/2026-06-20-magic-link-security-hardening.md):
 *   - G1 transport: POST /consume with the token in the request body (never in
 *     a URL) — immune to Referer/history/proxy-log leakage and email-scanner
 *     prefetch that would burn the single-use token (F13).
 *   - G4: the request endpoint returns an identical generic 202 whether or not
 *     the email exists (no account-enumeration leak) (F14).
 *   - F11: email is validated (format + length + CRLF/newline guard against
 *     SMTP header injection) at this route boundary.
 */
import { createRoute, z } from "@deps";
import { OpenAPITags } from "@utils/openapi/tags.ts";
import { withKey } from "@utils/validation/zod-message-key.ts";
import {
  httpResponseBadRequest,
  httpResponseConflict,
  httpResponseForbidden,
  httpResponseInternalServerError,
  httpResponseUnauthorized,
} from "@utils/openapi/open-api-shared.ts";
import { SchemaMagicLinkConsumeResponse, SchemaMagicLinkRequestResponse } from "@models/auth/index.ts";

// ============================================================================
// Request schemas (inline, matching login.route.ts)
// ============================================================================

const MagicLinkRequestSchema = z.object({
  email: z.string().trim()
    .email(withKey("validation.email-invalid", "Invalid email address"))
    .max(254, withKey("validation.email-too-long", "Email is too long"))
    // CRLF / newline guard — SMTP header-injection defense (F11 / PortSwigger).
    .regex(/^[^\r\n]*$/, withKey("validation.email-invalid", "Invalid email address"))
    .openapi({
      example: "user@example.com",
      description: "Email address to send the one-time magic sign-in link to",
    }),
});

const MagicLinkConsumeRequestSchema = z.object({
  token: z.string()
    .min(1, withKey("validation.token-required", "Magic link token is required"))
    .openapi({
      example: "eyJhbGciOiJFZERTQSIs...",
      description: "The one-time magic link token extracted from the email link",
    }),
});

// ============================================================================
// POST /api/auth/magic/request
// ============================================================================

export const magicLinkRequestRoute = createRoute({
  method: "post",
  path: "/magic/request",
  operationId: "authMagicLinkSend",
  summary: "Request a magic sign-in link",
  description:
    "Sends a one-time magic sign-in link to the email if the account exists. Always returns the same generic 202 response to prevent account enumeration (G4).\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: MagicLinkRequestSchema,
        },
      },
      description: "Email to send the magic sign-in link to",
    },
  },
  responses: {
    202: {
      description: "Magic link sent (or silently no-op if the email is unknown)",
      content: {
        "application/json": {
          schema: SchemaMagicLinkRequestResponse.openapi({
            description: "Generic acknowledgement — identical whether or not the email exists",
          }),
        },
      },
    },
    ...httpResponseBadRequest,
    ...httpResponseInternalServerError,
  },
});

// ============================================================================
// POST /api/auth/magic/consume
// ============================================================================

export const magicLinkConsumeRoute = createRoute({
  method: "post",
  path: "/magic/consume",
  operationId: "authMagicLinkVerify",
  summary: "Consume a magic sign-in link",
  description:
    "Redeems a one-time magic link token, verifying identity and recording consumption telemetry (F2). Completion is E2EE-conditional (G2-C): an E2EE-off account completes a key-less session now (no 2FA, 200) or via a 2FA challenge (2FA on, 202); an E2EE-on account with a passkey hands off to passkey-login for PRF unwrap (202). E2EE-on accounts without a wired unwrap path are honestly rejected (403/409) rather than minting a session that cannot read their data.\n\n**Auth:** public",
  security: [],
  tags: [OpenAPITags.auth],
  request: {
    body: {
      content: {
        "application/json": {
          schema: MagicLinkConsumeRequestSchema,
        },
      },
      description: "The magic link token to redeem",
    },
  },
  responses: {
    200: {
      description: "E2EE-off account — key-less session minted (direct login)",
      content: {
        "application/json": {
          schema: SchemaMagicLinkConsumeResponse.openapi({
            description: "Full key-less session set via cookies (identical to a passkey login)",
          }),
        },
      },
    },
    202: {
      description: "2FA challenge issued or passkey-login handoff (identity verified)",
      content: {
        "application/json": {
          schema: SchemaMagicLinkConsumeResponse.openapi({
            description: "Either a two-factor challenge (E2EE off) or a passkey-login handoff (E2EE on, PRF unwrap)",
          }),
        },
      },
    },
    ...httpResponseUnauthorized,
    ...httpResponseForbidden,
    ...httpResponseConflict,
    ...httpResponseInternalServerError,
  },
});
