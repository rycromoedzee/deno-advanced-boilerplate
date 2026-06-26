/**
 * @file services/cache/cache.config.ts
 * @description Single home for the cache layer's per-namespace OPERATIONAL CONFIG
 * (runtime values, not types). Co-located in the cache infra dir so all
 * namespace-driven policy lives in one audited place:
 *
 *   - CACHE_NAMESPACES           — the canonical namespace registry.
 *   - CACHE_NAMESPACES_DO_NOT_LOG / CACHE_LOG_REDACTED_KEYS — logging redaction.
 *   - DURABLE_CACHE_POLICY (+ policyFor/isDurable) — which namespaces are
 *     DB-backed (durable) and how (scope + write mode).
 *
 * Types (shapes) live in `interfaces/cache.ts`; this module holds only runtime
 * values. It is a leaf module (imports types only), so both the facade
 * (`cache.service.ts`) and the barrel (`index.ts`) can import it without forming
 * the `index -> cache.service -> index` circular import that previously forced
 * the durable policy into its own file.
 */
import type { DurableNamespacePolicy } from "@interfaces/cache.ts";

/**
 * Predefined cache namespaces for consistent organization.
 *
 * The single source of truth for namespace strings. Consumers should import this
 * via the cache barrel (`@services/cache/index.ts`) rather than reaching in here
 * directly.
 */
export const CACHE_NAMESPACES = {
  PERMISSIONS: {
    ALL: "permissions",
    GROUPS: "permission_groups",
    USER: "user_permissions",
    API_KEY: "api_key_permissions",
    ADMIN: "user_admin_status",
  },
  AUTH: {
    MAGIC_USER: "tokens_magic",
    MAGIC_TOKEN: "tokens_magic_token",
    TOKEN_REVOKED: "tokens_revoked",
    USER_REVOKED: "revoked_users",
    JWT_SESSION: "jwt_sessions",
    USER_SESSIONS: "user_sessions",
    REFRESH_TOKENS: "refresh_tokens",
    PASSKEY_CHALLENGE: "passkeys_challenge",
    TOTP_RECENT_CODES: "totp_recent_codes",
    API_KEY: "api_key",
    CHALLENGE_TOKEN: "challenge_token",
    CHALLENGE_GRACE: "challenge_grace",
    PASSWORD_RESET: "password_reset_tokens",
    PROGRESSIVE_DELAY: "progressive_delay_attempts",
    REAUTH_TOKENS: "reauth_tokens",
    RECOVERY_TOKENS: "recovery_tokens",
  },
  DOCUMENTS: {
    DOCUMENTS: "documents",
    FOLDERS: "document_folders",
    PERMISSIONS: "document_permissions",
    FOLDER_HIERARCHY: "document_folder_hierarchy",
    FOLDER_CONTENTS: "document_folder_contents",
    FOLDER_STATISTICS: "document_folder_statistics",
    POPULAR_DOCUMENTS: "document_popular_documents",
    METADATA_SCHEMAS: "document_metadata_schemas",
  },
  THREAT_INTELLIGENCE: {
    LOOKUP_CACHE: "ip_lookup_cache",
  },
  TRACING: {
    SPANS: "tracing_spans",
    CONTEXTS: "tracing_contexts",
  },
  WEBHOOKS: {
    EMAIL_STATUS: "email_status_webhook_ids",
  },
  RATE_LIMITS: "rate_limits",
  MOVE_OPERATIONS: {
    OPERATIONS: "move_operations",
    PROGRESS: "move_progress",
    BATCH_STATUS: "move_batch_status",
    BATCH_ITEMS: "move_batch_items",
    FOLDER_TREES: "move_folder_trees",
    ROLLBACK_STATES: "move_rollback_states",
  } as const,
  BACKGROUND_TASKS: {
    QUEUE: "background_task_queue",
    STATUS: "background_task_status",
  } as const,
  ENVIRONMENT: {
    CONTEXT: "environment_context",
  } as const,
  TASK_MANAGEMENT: {
    SETTINGS: "task_management_settings",
  } as const,
} as const;

/**
 * Namespaces whose VALUES must never be logged/visualized (auth/permission/PII).
 * The cache visualizer and population mapper skip these entirely.
 */
export const CACHE_NAMESPACES_DO_NOT_LOG = new Set([
  "permissions",
  "permission_groups",
  "user_permissions",
  "api_key_permissions",
  "user_admin_status",
  "passkeys_challenge",
  "reauth_tokens",
  "tokens_magic",
  "tokens_magic_token",
  "tracing_spans",
  "tracing_contexts",
]);

/**
 * Sub-string keys that are redacted from any logged cache payload regardless of
 * namespace (defense-in-depth alongside CACHE_NAMESPACES_DO_NOT_LOG).
 */
export const CACHE_LOG_REDACTED_KEYS = new Set([
  "password",
  "token",
  "secret",
  "private",
  "encryptedPasswordDerivedKey",
]);

/**
 * Per-namespace durability policy registry.
 *
 * Default = NOT durable. Only namespaces explicitly listed here are persisted to
 * the durable_cache backing table(s) by the cache facade. Scope (global vs tenant)
 * and write mode (sync vs async write-behind) are decided HERE, by policy — never
 * inferred from the cache key. This is the single audited place that decides scope;
 * a misclassified `scope` is a cross-tenant bleed.
 *
 * NEVER add high-churn / ephemeral namespaces (RATE_LIMITS, PASSKEY_CHALLENGE,
 * TRACING.*, THREAT_INTELLIGENCE.LOOKUP_CACHE, PROGRESSIVE_DELAY, MOVE_OPERATIONS.*,
 * BACKGROUND_TASKS.*) — they would hammer the DB and be replicated globally by Turso.
 * A `scope: "tenant"` entry must not be added until the tenant durable_cache table +
 * store routing exist (phase 5).
 */
export const DURABLE_CACHE_POLICY: Readonly<Record<string, DurableNamespacePolicy>> = {
  [CACHE_NAMESPACES.AUTH.REFRESH_TOKENS]: { scope: "global", writeMode: "sync" }, // phase 1
  // candidates after phase 1 proves the path:
  // [CACHE_NAMESPACES.AUTH.JWT_SESSION]:    { scope: "global", writeMode: "sync"  },
  // [CACHE_NAMESPACES.ENVIRONMENT.CONTEXT]: { scope: "global", writeMode: "async" },
  // [CACHE_NAMESPACES.PERMISSIONS.USER]:    { scope: "tenant", writeMode: "async" }, // requires tenant table (phase 5)
};

/** Returns the durability policy for a namespace, or undefined if it is not durable. */
export function policyFor(namespace: string): DurableNamespacePolicy | undefined {
  return DURABLE_CACHE_POLICY[namespace];
}

/** True iff the namespace is opted into durable persistence. */
export function isDurable(namespace: string): boolean {
  return DURABLE_CACHE_POLICY[namespace] !== undefined;
}
