import { inArray } from "@deps";
import { type LibSQLDatabase } from "drizzle-orm/libsql";
import * as tenantSchema from "../schema/tenant/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";

type TenantDB = LibSQLDatabase<typeof tenantSchema>;

const defaultPermissionStructure = <N extends string, G extends string>(name: N, groupKey: G) =>
  [
    { name: `${name}.list`, description: `List ${name}s`, level: 1, groupKey },
    { name: `${name}.read`, description: `View ${name} information`, level: 2, groupKey },
    { name: `${name}.update`, description: `Update ${name} information`, level: 3, groupKey },
    { name: `${name}.create`, description: `Create new ${name}`, level: 4, groupKey },
    { name: `${name}.delete`, description: `Delete ${name}`, level: 5, groupKey },
  ] as const;

const usersPermissions = defaultPermissionStructure("users", "users");

const apiKeysPermissions = [
  { name: "apiKey.create", description: "Create new API keys", level: 1, groupKey: "apiKeys" },
] as const;

const permissionGroupsPermissions = [
  ...defaultPermissionStructure("permissionGroups", "permissionGroups"),
  {
    name: "permissionGroupsExtra.assign",
    description: "Assign permissions to users and permission groups",
    level: 1,
    groupKey: "permissionGroups",
  },
  { name: "permissionGroupsExtra.archive", description: "Archive default permission groups", level: 1, groupKey: "permissionGroups" },
] as const;

const documentPermissions = [
  { name: "documents.upload", description: "Upload new documents", groupKey: "documents" },
  { name: "documents.download", description: "Download documents", groupKey: "documents" },
  { name: "documents.share", description: "Share documents with others", groupKey: "documents" },
  { name: "documents.comment", description: "Comment on documents", groupKey: "documents" },
  { name: "documents.version", description: "Manage document versions", groupKey: "documents" },
  { name: "documents.admin", description: "Full administrative access to documents", groupKey: "documents" },
] as const;

const documentPublicSharePermissions = [
  { name: "documentPublicShares.view", description: "View document shares", level: 1, groupKey: "documentPublicShares" },
  { name: "documentPublicShares.manage", description: "Manage document shares", level: 2, groupKey: "documentPublicShares" },
  {
    name: "documentPublicShares.manageCreatedByOthers",
    description: "Manage document shares created by others",
    level: 3,
    groupKey: "documentPublicShares",
  },
  { name: "documentPublicShares.revoke", description: "Revoke document shares", level: 4, groupKey: "documentPublicShares" },
] as const;

const environmentConfigPermissions = [
  {
    name: "environmentConfigPermissions.canEdit",
    description: "Access to manage environment configurations",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigBrandingPermissions.view",
    description: "View environment branding configuration",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigBrandingPermissions.edit",
    description: "Edit environment branding configuration",
    level: 2,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigSecurityPermissions.view",
    description: "View environment security configuration",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigSecurityPermissions.edit",
    description: "Edit environment security configuration",
    level: 2,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigSecurityPermissions.create",
    description: "Create environment security configuration",
    level: 3,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigSecurityPermissions.delete",
    description: "Delete environment security configuration",
    level: 4,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigAuthPermissions.view",
    description: "View environment auth configuration",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigAuthPermissions.manage",
    description: "Manage environment auth configuration",
    level: 2,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigPrivacyPermissions.view",
    description: "View environment privacy configuration",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigPrivacyPermissions.manage",
    description: "Manage environment privacy configuration",
    level: 2,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigDocumentStoragePermissions.view",
    description: "View environment document storage configuration",
    level: 1,
    groupKey: "environmentConfigPermissions",
  },
  {
    name: "environmentConfigDocumentStoragePermissions.manage",
    description: "Manage environment document storage configuration",
    level: 2,
    groupKey: "environmentConfigPermissions",
  },
] as const;

// ---------------------------------------------------------------------------
// Task management permissions
// ---------------------------------------------------------------------------

// Cards: one groupKey per "card" in the admin UI. Within each card, the UI
// creates a subsection per distinct permission-name prefix (the segment before
// the first dot), matching the permissionGroups / permissionGroupsExtra pattern.

const TASK_INITIATIVES_GROUP = "taskInitiatives";
const TASK_ITEMS_GROUP = "taskItems";
const TASK_PROJECTS_GROUP = "taskProjects";
const TASK_SETTINGS_GROUP = "taskSettings";

// Initiatives card — 2 subsections: task-initiatives, task-initiatives-members
const taskInitiativesPermissions = [
  ...defaultPermissionStructure("task-initiatives", TASK_INITIATIVES_GROUP),
  { name: "task-initiatives-members.manage", description: "Add and remove initiative members", level: 1, groupKey: TASK_INITIATIVES_GROUP },
] as const;

// Tasks card — 1 subsection: task-items
const taskItemsPermissions = [
  ...defaultPermissionStructure("task-items", TASK_ITEMS_GROUP),
] as const;

// Projects card — 4 subsections: task-projects, task-projects-members,
// task-projects-labels-and-workflows, task-projects-documents
const taskProjectsPermissions = [
  ...defaultPermissionStructure("task-projects", TASK_PROJECTS_GROUP),
  { name: "task-projects-members.manage", description: "Add and remove project members", level: 1, groupKey: TASK_PROJECTS_GROUP },
  {
    name: "task-projects-labels-and-workflows.labels",
    description: "Create, update, and delete project labels",
    level: 1,
    groupKey: TASK_PROJECTS_GROUP,
  },
  { name: "task-projects-labels-and-workflows.states", description: "Manage project item states", level: 2, groupKey: TASK_PROJECTS_GROUP },
  { name: "task-projects-documents.upload", description: "Upload project documents", level: 1, groupKey: TASK_PROJECTS_GROUP },
  { name: "task-projects-documents.delete", description: "Delete project documents", level: 2, groupKey: TASK_PROJECTS_GROUP },
] as const;

// Settings card — 3 subsections: task-teams, task-views, task-templates
const taskSettingsPermissions = [
  ...defaultPermissionStructure("task-teams", TASK_SETTINGS_GROUP),
  { name: "task-teams.members.manage", description: "Add and remove team members", level: 6, groupKey: TASK_SETTINGS_GROUP },
  { name: "task-views.manage", description: "Create, update, and delete saved views", level: 1, groupKey: TASK_SETTINGS_GROUP },
  {
    name: "task-templates.manage",
    description: "Create, update, delete, and apply item templates",
    level: 1,
    groupKey: TASK_SETTINGS_GROUP,
  },
] as const;

const taskManagementPermissions = [
  ...taskInitiativesPermissions,
  ...taskItemsPermissions,
  ...taskProjectsPermissions,
  ...taskSettingsPermissions,
] as const;

const REQUIRED_PERMISSIONS = [
  ...usersPermissions,
  ...apiKeysPermissions,
  ...permissionGroupsPermissions,
  ...documentPermissions,
  ...documentPublicSharePermissions,
  ...environmentConfigPermissions,
  ...taskManagementPermissions,
] as const;

const PERMISSION_GROUPS = [
  { name: "Admin", description: "Full system access and control", isSystem: true },
  { name: "User Manager", description: "Manage users and their permissions", isSystem: true },
  { name: "API Key Manager", description: "Manage API keys and their permissions", isSystem: true },
  { name: "Environment Manager", description: "Manage environments", isSystem: true },
  { name: "Read Only", description: "View-only access to all resources", isSystem: true },
  { name: "Document Admin", description: "Full administrative access to document management", isSystem: false },
  { name: "Document Manager", description: "Manage documents, folders, and shares", isSystem: false },
  { name: "Document Editor", description: "Create, edit, and organize documents", isSystem: false },
  { name: "Document Viewer", description: "View and download documents", isSystem: false },
  { name: "Document Collaborator", description: "View, comment, and share documents", isSystem: false },
  { name: "Task Admin", description: "Full access to task management features", isSystem: false },
  { name: "Task Member", description: "Create and manage task items, views, and templates", isSystem: false },
  { name: "Task Viewer", description: "View-only access to task management features", isSystem: false },
];

export type PermissionName = typeof REQUIRED_PERMISSIONS[number]["name"];

const PERMISSION_GROUP_MAPPINGS: Record<string, PermissionName[]> = {
  "Admin": REQUIRED_PERMISSIONS.map((p) => p.name),
  "User Manager": [
    "users.list",
    "users.read",
    "users.update",
    "users.create",
    "users.delete",
    "permissionGroups.list",
    "permissionGroups.read",
    "permissionGroupsExtra.assign",
  ],
  "API Key Manager": [
    "apiKey.create",
    "permissionGroups.list",
    "permissionGroups.read",
    "permissionGroupsExtra.assign",
  ],
  "Environment Manager": environmentConfigPermissions.map((p) => p.name),
  "Read Only": [
    "users.list",
    "users.read",
    "permissionGroups.list",
    "permissionGroups.read",
    "documents.download",
    "documentPublicShares.view",
    "task-teams.list",
    "task-teams.read",
    "task-initiatives.list",
    "task-initiatives.read",
    "task-projects.list",
    "task-projects.read",
    "task-items.list",
    "task-items.read",
  ],
  "Document Admin": [
    ...documentPermissions.map((p) => p.name),
    ...documentPublicSharePermissions.map((p) => p.name),
  ],
  "Document Manager": [
    "documents.upload",
    "documents.download",
    "documents.share",
    "documents.comment",
    "documents.version",
    "documentPublicShares.view",
    "documentPublicShares.manage",
    "documentPublicShares.revoke",
  ],
  "Document Editor": [
    "documents.upload",
    "documents.download",
    "documents.comment",
    "documentPublicShares.view",
  ],
  "Document Viewer": [
    "documents.download",
    "documentPublicShares.view",
  ],
  "Document Collaborator": [
    "documents.download",
    "documents.share",
    "documents.comment",
    "documentPublicShares.view",
    "documentPublicShares.manage",
  ],
  "Task Admin": taskManagementPermissions.map((p) => p.name),
  "Task Member": [
    // Teams: read-only
    "task-teams.list",
    "task-teams.read",
    // Initiatives: read-only
    "task-initiatives.list",
    "task-initiatives.read",
    // Projects: full CRUD + sub-resources
    "task-projects.list",
    "task-projects.read",
    "task-projects.create",
    "task-projects.update",
    "task-projects-labels-and-workflows.labels",
    "task-projects-documents.upload",
    // Items: full CRUD
    "task-items.list",
    "task-items.read",
    "task-items.create",
    "task-items.update",
    "task-items.delete",
    // Views and templates
    "task-views.manage",
    "task-templates.manage",
  ],
  "Task Viewer": [
    "task-teams.list",
    "task-teams.read",
    "task-initiatives.list",
    "task-initiatives.read",
    "task-projects.list",
    "task-projects.read",
    "task-items.list",
    "task-items.read",
  ],
};

export async function seedPermissions(db: TenantDB): Promise<void> {
  await db
    .insert(tenantSchema.permissions)
    .values(
      REQUIRED_PERMISSIONS.map((perm) => ({
        id: generateIdRandom(),
        ...perm,
      })),
    )
    .onConflictDoNothing();

  const permissionNames = REQUIRED_PERMISSIONS.map((p) => p.name);
  const permissionRows = await db
    .select({ id: tenantSchema.permissions.id, name: tenantSchema.permissions.name })
    .from(tenantSchema.permissions)
    .where(inArray(tenantSchema.permissions.name, permissionNames));

  const permissionMap = new Map(permissionRows.map((row) => [row.name, row.id]));

  const groupNames = PERMISSION_GROUPS.map((g) => g.name);
  const existingGroups = await db
    .select({ id: tenantSchema.permissionGroups.id, name: tenantSchema.permissionGroups.name })
    .from(tenantSchema.permissionGroups)
    .where(inArray(tenantSchema.permissionGroups.name, groupNames));

  const existingGroupNames = new Set(existingGroups.map((g) => g.name));
  const newGroups = PERMISSION_GROUPS
    .filter((g) => !existingGroupNames.has(g.name))
    .map((group) => ({
      id: generateIdRandom(),
      ...group,
    }));

  if (newGroups.length > 0) {
    await db.insert(tenantSchema.permissionGroups).values(newGroups);
  }

  const allGroups = await db
    .select({ id: tenantSchema.permissionGroups.id, name: tenantSchema.permissionGroups.name })
    .from(tenantSchema.permissionGroups)
    .where(inArray(tenantSchema.permissionGroups.name, groupNames));

  const groupMap = new Map(allGroups.map((g) => [g.name, g.id]));

  const groupPermissions: { groupId: string; permissionId: string }[] = [];

  for (const [groupName, permNames] of Object.entries(PERMISSION_GROUP_MAPPINGS)) {
    const groupId = groupMap.get(groupName);
    if (!groupId) {
      console.warn(`Group ${groupName} not found; skipping`);
      continue;
    }

    for (const permName of permNames) {
      const permissionId = permissionMap.get(permName);
      if (!permissionId) {
        console.warn(`Permission ${permName} not found; skipping`);
        continue;
      }
      groupPermissions.push({ groupId, permissionId });
    }
  }

  if (groupPermissions.length > 0) {
    await db
      .insert(tenantSchema.permissionGroupPermissions)
      .values(groupPermissions)
      .onConflictDoNothing();
  }

  console.log(
    `Seeded permissions (${permissionRows.length}), groups (${allGroups.length}), and group mappings (${groupPermissions.length})`,
  );
}
