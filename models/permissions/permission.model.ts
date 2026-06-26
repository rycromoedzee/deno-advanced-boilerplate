/**
 * @file models/permissions/permission.model.ts
 * @description Response schemas for permission group operations
 */

import { z } from "@deps";

export const SchemaPermissionListResponse = z.array(z.record(z.string(), z.unknown()));

export const SchemaPermissionGroupListResponse = z.record(z.string(), z.unknown());

export const SchemaPermissionGroupReadResponse = z.object({
  data: z.record(z.string(), z.unknown()),
});

export const SchemaPermissionGroupCreateResponse = z.object({
  group: z.record(z.string(), z.unknown()),
});

export const SchemaPermissionGroupUpdateResponse = z.object({
  group: z.record(z.string(), z.unknown()),
});

export const SchemaUserPermissionsUpdateResponse = z.record(z.string(), z.unknown());

export type IPermissionListResponse = z.infer<typeof SchemaPermissionListResponse>;
export type IPermissionGroupListResponse = z.infer<typeof SchemaPermissionGroupListResponse>;
export type IPermissionGroupReadResponse = z.infer<typeof SchemaPermissionGroupReadResponse>;
export type IPermissionGroupCreateResponse = z.infer<typeof SchemaPermissionGroupCreateResponse>;
export type IPermissionGroupUpdateResponse = z.infer<typeof SchemaPermissionGroupUpdateResponse>;
export type IUserPermissionsUpdateResponse = z.infer<typeof SchemaUserPermissionsUpdateResponse>;
