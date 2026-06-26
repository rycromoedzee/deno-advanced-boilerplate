/**
 * @file utils/openapi/tags.ts
 * @description Global OpenAPI tag definitions
 *
 * This file centralizes all OpenAPI tag names to ensure consistency
 * and make it easy to maintain tag ordering in the documentation.
 *
 * `openApiTagsSpec` is the array that reaches the rendered spec — every entry
 * carries a one-line `description` so the Scalar sidebar groups are explained.
 * Tags not used by any route are omitted here (the `main.ts` /docs handler also
 * filters unused tags at render time, but the source stays consistent).
 */

/**
 * OpenAPI tag names as constants
 * Use these in route definitions to ensure consistency
 */
export const OpenAPITags = {
  // Auth & Security
  auth: "Auth",
  security: "Security",

  // Configuration & identity
  userEncryption: "User Encryption",
  users: "Users",
  environmentConfig: "Environment Configuration",

  // System
  debug: "Debug",

  // Media & Webhooks
  mediaStreaming: "Media Streaming",
  webhooks: "Webhooks",

  // Permissions
  permissions: "Permissions",
  permissionGroups: "Permission Groups",

  // Notifications
  notifications: "Notifications",

  // Jobs
  jobs: "Jobs",

  // Documents
  documents: "Documents",
  documentSharing: "Document Sharing",
  documentFolders: "Document Folders",
  documentFolderSharing: "Document Folder Sharing",
  documentSettings: "Document Settings",
  documentTags: "Document Tags",

  // Notes
  notes: "Notes",
  noteAttachments: "Note Attachments",
  noteCollections: "Note Collections",
  noteEvents: "Note Events",
  noteSharing: "Note Sharing",
  noteTags: "Note Tags",
  notePublicAccess: "Note Public Access",
  noteVersions: "Note Versions",

  // Internal / admin
  admin: "Admin",
  superAdmin: "Super Admin",
} as const;

/**
 * OpenAPI tag names for the Notes feature
 * Grouped for convenience so route files can import a single constant
 */
export const OpenAPITagsNotesFeature = {
  notes: OpenAPITags.notes,
  attachments: OpenAPITags.noteAttachments,
  collections: OpenAPITags.noteCollections,
  events: OpenAPITags.noteEvents,
  sharing: OpenAPITags.noteSharing,
  tags: OpenAPITags.noteTags,
  publicAccess: OpenAPITags.notePublicAccess,
  versions: OpenAPITags.noteVersions,
} as const;

/**
 * OpenAPI tag names for the Documents feature
 * Grouped for convenience so route files can import a single constant
 *
 * Note: a few sub-features intentionally alias to a broader tag
 * (`comments`/`metadataSchemas` → Documents, `publicAccess` → Document Sharing)
 * to keep the sidebar grouping meaningful for low-volume sub-features.
 */
export const OpenAPITagsDocumentFeature = {
  documents: OpenAPITags.documents,
  folders: OpenAPITags.documentFolders,
  documentSharing: OpenAPITags.documentSharing,
  folderSharing: OpenAPITags.documentFolderSharing,
  tags: OpenAPITags.documentTags,
  settings: OpenAPITags.documentSettings,
  comments: OpenAPITags.documents,
  metadataSchemas: OpenAPITags.documents,
  publicAccess: OpenAPITags.documentSharing,
} as const;

/**
 * OpenAPI tags array for the OpenAPI spec tags section.
 * The order here determines the order in the documentation sidebar.
 * Every entry carries a one-line description rendered by Scalar.
 */
export const openApiTagsSpec = [
  {
    name: OpenAPITags.auth,
    description:
      "Authentication & session lifecycle: login, logout, registration, password, passkey, two-factor, magic-link, and refresh flows.",
  },
  {
    name: OpenAPITags.security,
    description: "Security reporting endpoints such as CSP violation ingestion.",
  },
  {
    name: OpenAPITags.userEncryption,
    description: "Per-user end-to-end encryption key management.",
  },
  {
    name: OpenAPITags.users,
    description: "Authenticated user account profile, settings, and API-key management.",
  },
  {
    name: OpenAPITags.environmentConfig,
    description: "Per-environment application configuration surfaced to the authenticated user.",
  },
  {
    name: OpenAPITags.debug,
    description: "Development and debug introspection endpoints (dev-only, or super-admin in production).",
  },
  {
    name: OpenAPITags.mediaStreaming,
    description: "Range-request media streaming endpoints.",
  },
  {
    name: OpenAPITags.webhooks,
    description: "Inbound webhook receivers for third-party integrations.",
  },
  {
    name: OpenAPITags.permissions,
    description: "Role-based permission definitions and assignments.",
  },
  {
    name: OpenAPITags.permissionGroups,
    description: "Permission group membership and management.",
  },
  {
    name: OpenAPITags.notifications,
    description: "User notification inbox, preferences, environment defaults, and real-time delivery.",
  },
  {
    name: OpenAPITags.jobs,
    description: "Background scheduled-job introspection and management.",
  },
  {
    name: OpenAPITags.documents,
    description: "Document CRUD, upload (incl. chunked and thumbnail), bulk operations, comments, and metadata schemas.",
  },
  {
    name: OpenAPITags.documentSharing,
    description: "User-level and public (zero-knowledge) document sharing, and public-share access.",
  },
  {
    name: OpenAPITags.documentFolders,
    description: "Document folder hierarchy and management.",
  },
  {
    name: OpenAPITags.documentFolderSharing,
    description: "Sharing document folders with other users.",
  },
  {
    name: OpenAPITags.documentSettings,
    description: "Per-folder and per-document settings.",
  },
  {
    name: OpenAPITags.documentTags,
    description: "Tag management for documents.",
  },
  {
    name: OpenAPITags.notes,
    description: "Note CRUD, events, sharing, tags, and versioning.",
  },
  {
    name: OpenAPITags.noteAttachments,
    description: "Attachments uploaded to notes.",
  },
  {
    name: OpenAPITags.noteCollections,
    description: "Collections for grouping notes.",
  },
  {
    name: OpenAPITags.noteEvents,
    description: "Real-time and historical note events.",
  },
  {
    name: OpenAPITags.noteSharing,
    description: "Sharing notes with other users.",
  },
  {
    name: OpenAPITags.noteTags,
    description: "Tag management for notes.",
  },
  {
    name: OpenAPITags.notePublicAccess,
    description: "Public (zero-knowledge) access to shared notes.",
  },
  {
    name: OpenAPITags.noteVersions,
    description: "Note version history.",
  },
  {
    name: OpenAPITags.admin,
    description: "Internal admin tooling — cache, threat-intelligence, and trace visualizers (internal tool key required).",
  },
  {
    name: OpenAPITags.superAdmin,
    description: "Super-admin platform administration (super-admin session required).",
  },
];
