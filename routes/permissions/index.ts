/**
 * @file routes/permissions/index.ts
 * @description Permissions and permission groups routes
 *
 * Operation-heavy domain (rule 7 documented exception): this feature keeps
 * its routes split into one route file per CRUD/permission operation
 * (list-permissions, list-groups, read-group, create-group, update-group,
 * delete-group, update-user-permissions) rather than collapsing them into a
 * single permissions.route.ts. Each file maps 1:1 to a single OpenAPI
 * operation, which keeps the operation handlers and their route definitions
 * easy to locate and review independently. No single-aspect consolidation is
 * intended here.
 */

import { OpenAPIHono } from "@deps";
import { listPermissionsRoute } from "./list-permissions.route.ts";
import { listGroupsRoute } from "./list-groups.route.ts";
import { readGroupRoute } from "./read-group.route.ts";
import { createGroupRoute } from "./create-group.route.ts";
import { updateGroupRoute } from "./update-group.route.ts";
import { deleteGroupRoute } from "./delete-group.route.ts";
import { updateUserPermissionsRoute } from "./update-user-permissions.route.ts";
import {
  createGroupHandler,
  deleteGroupHandler,
  listGroupsHandler,
  listPermissionsHandler,
  readGroupHandler,
  updateGroupHandler,
  updateUserPermissionsHandler,
} from "@handlers/permissions/index.ts";

const permissionsApp = new OpenAPIHono();

permissionsApp.openapi(listPermissionsRoute, listPermissionsHandler);
permissionsApp.openapi(listGroupsRoute, listGroupsHandler);
permissionsApp.openapi(readGroupRoute, readGroupHandler);
permissionsApp.openapi(createGroupRoute, createGroupHandler);
permissionsApp.openapi(updateGroupRoute, updateGroupHandler);
permissionsApp.openapi(deleteGroupRoute, deleteGroupHandler);
permissionsApp.openapi(updateUserPermissionsRoute, updateUserPermissionsHandler);

export default permissionsApp;
