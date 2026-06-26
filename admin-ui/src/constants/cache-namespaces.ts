/**
 * UI-local copy of the backend cache namespace registry.
 *
 * The backend `services/cache/cache.config.ts` module cannot be imported from
 * admin-ui (it transitively pulls `@interfaces/cache.ts`, a backend-only import
 * alias vue-tsc cannot resolve). The cache visualizer only needs the namespace
 * registry to map a cache-entry namespace string onto its top-level GROUP for
 * display, so a UI-local copy is maintained here. Keep this in sync with the
 * backend `CACHE_NAMESPACES` constant when namespaces change.
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
  },
  BACKGROUND_TASKS: {
    QUEUE: "background_task_queue",
    STATUS: "background_task_status",
  },
  ENVIRONMENT: {
    CONTEXT: "environment_context",
  },
  TASK_MANAGEMENT: {
    SETTINGS: "task_management_settings",
  },
} as const;
