/**
 * @file config/notification-catalog.ts
 * @description Notification catalog - single source of truth for all notification types
 *
 * scope: "user" = all users (including admins) can customize their own preferences
 * scope: "admin" = admin users can customize their own preferences; regular users never see these
 */

// Categories
export const NOTIFICATION_CATEGORIES = {
  // User-scope: All users receive these, each controls own preferences
  SECURITY: "security",
  STORAGE: "storage",
  SYSTEM: "system",
  SHARING: "sharing",
  COMMENTS: "comments",
  TASK_MANAGEMENT: "task-management",

  // Admin-scope: Only admin users receive these
  USER_MANAGEMENT: "user-management",
  DOCUMENTS: "documents",
} as const;

export const NOTIFICATION_SCOPES = {
  USER: "user",
  ADMIN: "admin",
} as const;

export type NotificationCategory = typeof NOTIFICATION_CATEGORIES[keyof typeof NOTIFICATION_CATEGORIES];
export type NotificationScope = typeof NOTIFICATION_SCOPES[keyof typeof NOTIFICATION_SCOPES];

export interface NotificationTypeDefinition {
  id: string;
  category: NotificationCategory;
  scope: NotificationScope;
  label: string;
  description?: string;
  availableChannels: ("email" | "inApp" | "push")[];
  defaults: {
    email: boolean;
    inApp: boolean;
    push: boolean;
  };
}

/**
 * Complete catalog of notification types
 * This matches the frontend mockup structure
 */
export const NOTIFICATION_TYPES: Record<string, NotificationTypeDefinition> = {
  // === SECURITY (User scope) ===
  "security.login.new-device": {
    id: "security.login.new-device",
    category: NOTIFICATION_CATEGORIES.SECURITY,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Login from new device",
    description: "Alert when someone signs in from an unrecognized device",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "security.login.failed-attempts": {
    id: "security.login.failed-attempts",
    category: NOTIFICATION_CATEGORIES.SECURITY,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Failed login attempts",
    description: "Alert when there are multiple failed login attempts",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "security.2fa.changed": {
    id: "security.2fa.changed",
    category: NOTIFICATION_CATEGORIES.SECURITY,
    scope: NOTIFICATION_SCOPES.USER,
    label: "2FA settings changed",
    description: "Alert when two-factor authentication is enabled or disabled",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "security.password.changed": {
    id: "security.password.changed",
    category: NOTIFICATION_CATEGORIES.SECURITY,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Password changed",
    description: "Alert when account password is changed",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },

  // === STORAGE (User scope) ===
  "storage.quota.warning": {
    id: "storage.quota.warning",
    category: NOTIFICATION_CATEGORIES.STORAGE,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Quota warning",
    description: "Alert when storage usage reaches 80%",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "storage.quota.reached": {
    id: "storage.quota.reached",
    category: NOTIFICATION_CATEGORIES.STORAGE,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Storage limit reached",
    description: "Alert when storage quota is exceeded",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },

  // === SYSTEM (User scope) ===
  "system.maintenance.scheduled": {
    id: "system.maintenance.scheduled",
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "Scheduled maintenance",
    description: "Notifications about upcoming maintenance windows",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "system.updates.available": {
    id: "system.updates.available",
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "System updates",
    description: "Alert when new system updates are available",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "system.backup.completed": {
    id: "system.backup.completed",
    category: NOTIFICATION_CATEGORIES.SYSTEM,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "Backup completed",
    description: "Notification when system backups complete",
    availableChannels: ["email"],
    defaults: { email: false, inApp: false, push: false },
  },

  // === USER MANAGEMENT (Admin scope) ===
  "user.created": {
    id: "user.created",
    category: NOTIFICATION_CATEGORIES.USER_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "User created",
    description: "Alert when a new user account is created",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "user.deactivated": {
    id: "user.deactivated",
    category: NOTIFICATION_CATEGORIES.USER_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "User deactivated",
    description: "Alert when a user account is deactivated",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "user.role-changed": {
    id: "user.role-changed",
    category: NOTIFICATION_CATEGORIES.USER_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "Role changes",
    description: "Alert when user roles or permissions are modified",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },

  // === DOCUMENTS (Environment scope) ===
  "document.uploaded": {
    id: "document.uploaded",
    category: NOTIFICATION_CATEGORIES.DOCUMENTS,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "Document uploaded",
    description: "Alert when new documents are uploaded",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: false, push: false },
  },
  "document.deleted": {
    id: "document.deleted",
    category: NOTIFICATION_CATEGORIES.DOCUMENTS,
    scope: NOTIFICATION_SCOPES.ADMIN,
    label: "Document deleted",
    description: "Alert when documents are deleted",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: false, push: false },
  },

  // === SHARING (User scope) ===
  "sharing.document.shared": {
    id: "sharing.document.shared",
    category: NOTIFICATION_CATEGORIES.SHARING,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Document shared with you",
    description: "Alert when someone shares a document with you",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "sharing.folder.shared": {
    id: "sharing.folder.shared",
    category: NOTIFICATION_CATEGORIES.SHARING,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Folder shared with you",
    description: "Alert when someone shares a folder with you",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: true, push: false },
  },

  // === COMMENTS (User scope) ===
  "comments.mention": {
    id: "comments.mention",
    category: NOTIFICATION_CATEGORIES.COMMENTS,
    scope: NOTIFICATION_SCOPES.USER,
    label: "@mention",
    description: "Alert when someone mentions you in a comment",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "comments.reply": {
    id: "comments.reply",
    category: NOTIFICATION_CATEGORIES.COMMENTS,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Comment reply",
    description: "Alert when someone replies to your comment",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },

  // === TASK MANAGEMENT (User scope) ===
  "task-project.member.added": {
    id: "task-project.member.added",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Added to project",
    description: "Alert when you are added as a member of a project",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: false },
  },
  "task-project.member.removed": {
    id: "task-project.member.removed",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Removed from project",
    description: "Alert when you are removed as a member of a project",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "task-item.created": {
    id: "task-item.created",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "New task item created",
    description: "Alert when a new task item is created in a project you are a member of",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-item.assigned": {
    id: "task-item.assigned",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item assigned",
    description: "Alert when a task item is assigned to you",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "task-item.unassigned": {
    id: "task-item.unassigned",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item unassigned",
    description: "Alert when you are unassigned from a task item",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "task-item.state-changed": {
    id: "task-item.state-changed",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item state changed",
    description: "Alert when the state of a task item you are subscribed to changes",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-item.priority-changed": {
    id: "task-item.priority-changed",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item priority changed",
    description: "Alert when the priority of a task item assigned to you changes",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-item.due-date-approaching": {
    id: "task-item.due-date-approaching",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Due date approaching",
    description: "Alert when a task item assigned to you is approaching its due date",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "task-item.overdue": {
    id: "task-item.overdue",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item overdue",
    description: "Alert when a task item assigned to you is past its due date",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "task-item.comment.added": {
    id: "task-item.comment.added",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "New comment on task item",
    description: "Alert when someone comments on a task item you are subscribed to",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-item.mentioned": {
    id: "task-item.mentioned",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "@mentioned in task item",
    description: "Alert when someone @mentions you in a task item comment or description",
    availableChannels: ["email", "inApp", "push"],
    defaults: { email: true, inApp: true, push: true },
  },
  "task-item.relation.added": {
    id: "task-item.relation.added",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "New relation on task item",
    description: "Alert when a relation (blocks, duplicates, etc.) is added to a task item assigned to you",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-item.completed": {
    id: "task-item.completed",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Task item completed",
    description: "Alert when a task item in your project is marked as completed",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-note.updated": {
    id: "task-note.updated",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Note updated",
    description: "Alert when a note you are subscribed to is edited by another user",
    availableChannels: ["inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-milestone.completed": {
    id: "task-milestone.completed",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Milestone completed",
    description: "Alert when a milestone in your project is marked as completed",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-cycle.started": {
    id: "task-cycle.started",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Cycle started",
    description: "Alert when a new cycle begins in your project",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
  "task-cycle.ending": {
    id: "task-cycle.ending",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Cycle ending soon",
    description: "Alert when a cycle in your project is approaching its end date",
    availableChannels: ["email", "inApp"],
    defaults: { email: true, inApp: true, push: false },
  },
  "task-item.stale": {
    id: "task-item.stale",
    category: NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
    scope: NOTIFICATION_SCOPES.USER,
    label: "Stale task item",
    description: "Alert when a task item assigned to you has had no activity for a while",
    availableChannels: ["email", "inApp"],
    defaults: { email: false, inApp: true, push: false },
  },
} as const;

/**
 * Category metadata for UI display
 */
export const NOTIFICATION_CATEGORY_META: Record<NotificationCategory, {
  title: string;
  description: string;
  icon: string;
}> = {
  [NOTIFICATION_CATEGORIES.SECURITY]: {
    title: "Security & Login Alerts",
    description: "Important security notifications for account protection",
    icon: "i-ph-shield-check",
  },
  [NOTIFICATION_CATEGORIES.STORAGE]: {
    title: "Storage & Quota Alerts",
    description: "Notifications about storage limits and quotas",
    icon: "i-ph-hard-drives",
  },
  [NOTIFICATION_CATEGORIES.SYSTEM]: {
    title: "System & Maintenance",
    description: "Important system updates and maintenance notifications",
    icon: "i-ph-wrench",
  },
  [NOTIFICATION_CATEGORIES.USER_MANAGEMENT]: {
    title: "User Management Events",
    description: "Notifications about user account changes",
    icon: "i-ph-users",
  },
  [NOTIFICATION_CATEGORIES.DOCUMENTS]: {
    title: "Document Activity",
    description: "Notifications about document changes and activity",
    icon: "i-ph-file-text",
  },
  [NOTIFICATION_CATEGORIES.SHARING]: {
    title: "Sharing & Access",
    description: "Notifications about file sharing and access requests",
    icon: "i-ph-share-network",
  },
  [NOTIFICATION_CATEGORIES.COMMENTS]: {
    title: "Comments & Mentions",
    description: "Notifications about comments and @mentions",
    icon: "i-ph-chat-circle",
  },
  [NOTIFICATION_CATEGORIES.TASK_MANAGEMENT]: {
    title: "Task Management",
    description: "Notifications about task items, projects, initiatives, and assignments",
    icon: "i-ph-check-square",
  },
};

/**
 * Helper to get all types by category
 */
export function getNotificationTypesByCategory(category: NotificationCategory): NotificationTypeDefinition[] {
  return Object.values(NOTIFICATION_TYPES).filter((t) => t.category === category);
}

/**
 * Helper to get all types by scope
 */
export function getNotificationTypesByScope(scope: NotificationScope): NotificationTypeDefinition[] {
  return Object.values(NOTIFICATION_TYPES).filter((t) => t.scope === scope);
}

/**
 * Check if category is user-scope (user-configurable)
 */
export function isUserDefaultCategory(category: NotificationCategory): boolean {
  const userCategories: NotificationCategory[] = [
    NOTIFICATION_CATEGORIES.SECURITY,
    NOTIFICATION_CATEGORIES.STORAGE,
    NOTIFICATION_CATEGORIES.SYSTEM,
    NOTIFICATION_CATEGORIES.SHARING, // Now user-scope
    NOTIFICATION_CATEGORIES.COMMENTS, // Now user-scope (any user can be @mentioned/receive replies)
    NOTIFICATION_CATEGORIES.TASK_MANAGEMENT,
  ];
  return userCategories.includes(category);
}
