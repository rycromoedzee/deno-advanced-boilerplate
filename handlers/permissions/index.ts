/**
 * @file handlers/permissions/index.ts
 * @description Barrel for permission handlers (mirrors routes/permissions/).
 *
 * Rule 7 divergence — operation-heavy domain, grouped (not 1:1):
 *   permission-groups.handler.ts backs list-groups, read-group, create-group,
 *     update-group, delete-group route files (cohesive group CRUD).
 *   permissions.handler.ts backs list-permissions + update-user-permissions
 *     route files (non-group operations).
 * Each route's handler is a thin permission-check + service call, so file-per-route
 * would spawn seven trivial files; they are grouped by aspect instead.
 */

export {
  createGroupHandler,
  deleteGroupHandler,
  listGroupsHandler,
  readGroupHandler,
  updateGroupHandler,
} from "./permission-groups.handler.ts";

export { listPermissionsHandler, updateUserPermissionsHandler } from "./permissions.handler.ts";
