import { AUTH_HEADER_NAMING } from "@services/session/index.ts";
import { openApiTagsSpec } from "@utils/openapi/tags.ts";

/**
 * Multi-paragraph API overview rendered at the top of the Scalar/Redoc UI.
 * Markdown is supported by OpenAPI 3.0 `info.description`.
 */
const API_DESCRIPTION = `# Deno Advanced Boilerplate API

A security-first, multi-tenant backend: **Deno + Hono + Drizzle ORM over libSQL/Turso**.
Every endpoint is documented below with its purpose, auth posture, inputs, and
the errors it can return.

## Authentication

Two credential schemes are accepted. Most endpoints require one of them; truly
public endpoints (login, registration, magic-link verification, public shares,
webhooks, health, CSP reporting) are marked \`security: []\` and show **no** lock
icon.

- **Cookie session (browser clients).** The server sets an HttpOnly,
  \`SameSite=Strict\`, \`Secure\` cookie named \`${AUTH_HEADER_NAMING.access}\` after
  login. Browsers send it automatically; no header to manage. A separate
  \`${AUTH_HEADER_NAMING.refresh}\` cookie is used to rotate the session.
- **API key (service-to-service / programmatic clients).** Send
  \`Api-Key: <key>\` in the request header. API keys are environment-scoped.
- **Internal tool key.** Admin tooling under \`/api/internal/*\` requires
  \`Api-Auth: <key>\` and is not part of the public API surface.

## Tenancy

Each deployment serves multiple isolated **environments** (the tenant). The
tenant identifier (\`environmentId\`) is derived server-side from the validated
session or API key and carried in request context — it is **never** read from a
client-controlled body or query parameter. All data is scoped to the caller's
environment.

## Base URL

- Local development: \`http://localhost:<port>\`
- The spec is served at \`GET /docs\` (JSON) and browsed at \`GET /openapi\` (Scalar).
- In production only the public-facing surface is exposed via \`/docs\`.

## Conventions

- All JSON bodies are validated with Zod; validation errors return \`400\` with a
  \`messageKey\` for i18n.
- Error responses share one shape: \`{ message, messageKey, statusCode }\`.
- Missing or unauthorized resources return \`404\`, not \`403\`.`;

export const openApiBaseSpec = {
  openapi: "3.0.0" as const,
  info: {
    title: "Deno Advanced Boilerplate API",
    version: "1.0.0",
    description: API_DESCRIPTION,
    contact: {
      name: "Deno Advanced Boilerplate",
      url: "https://github.com/",
    },
    license: {
      name: "MIT",
      url: "https://opensource.org/license/mit",
    },
  },
  externalDocs: {
    url: "./README.md",
    description: "Project README — setup, architecture, and feature guides",
  },
  tags: openApiTagsSpec,
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey" as const,
        in: "cookie" as const,
        name: AUTH_HEADER_NAMING.access,
        description: `**Cookie-based authentication**

The server sets this cookie after successful login.

**In requests, the browser automatically includes:**
\`\`\`
Cookie: ${AUTH_HEADER_NAMING.access}=<token_value>
\`\`\`

**The server responds with Set-Cookie on login:**
\`\`\`
Set-Cookie: ${AUTH_HEADER_NAMING.access}=<token>; HttpOnly; Secure; SameSite=Strict
\`\`\``,
      },
      apiKeyAuth: {
        type: "apiKey" as const,
        in: "header" as const,
        name: AUTH_HEADER_NAMING.api,
        description: `**API Key authentication**

For service-to-service authentication, include the API key in the request header:
\`\`\`
Api-Key: <your_api_key>
\`\`\`

API keys are scoped to a single environment.`,
      },
      internalToolKeyAuth: {
        type: "apiKey" as const,
        in: "header" as const,
        name: AUTH_HEADER_NAMING.internalToolAccess,
        description: `**Internal tool authentication**

Admin/internal tooling mounted under \`/api/internal/*\` requires this key:
\`\`\`
Api-Auth: <internal_tool_key>
\`\`\`

Not part of the public API surface.`,
      },
    },
  },
  security: [
    { cookieAuth: [] },
    { apiKeyAuth: [] },
  ] as Array<Record<string, string[]>>,
};
