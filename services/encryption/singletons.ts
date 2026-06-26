/**
 * @file services/encryption/singletons.ts
 * @description Singleton management for encryption services
 * Separated from index.ts to prevent circular dependencies
 */

import { KeySharingService } from "./key-sharing.service.ts";
import { PermissionService } from "./permission.service.ts";
import { SharingService } from "./sharing.service.ts";
import { EncryptionSharingService } from "./encryption-sharing.service.ts";
import type { IEncryptionTableConfig } from "@interfaces/encryption.ts";

// ============================================================================
// KeySharingService
// ============================================================================

let keySharingServiceInstance: KeySharingService | null = null;

export function getEncryptionKeySharingService(): KeySharingService {
  if (!keySharingServiceInstance) {
    keySharingServiceInstance = new KeySharingService();
  }
  return keySharingServiceInstance;
}

/** @deprecated Use getEncryptionKeySharingService() instead */
export const getKeySharingService = getEncryptionKeySharingService;

// ============================================================================
// Generic Table-Agnostic Services
//
// These services are parameterized per table config, so we don't store a fixed
// singleton. Instead callers pass their tableConfig and get a fresh instance.
// The pattern here mirrors how other services accept optional dependencies.
// ============================================================================

/**
 * Creates a PermissionService for a given table config.
 */
export function getPermissionService(
  tableConfig: IEncryptionTableConfig,
): PermissionService {
  return new PermissionService(tableConfig);
}

/**
 * Creates a SharingService for a given table config.
 */
export function getSharingService(
  tableConfig: IEncryptionTableConfig,
): SharingService {
  return new SharingService(tableConfig);
}

/**
 * Creates an EncryptionSharingService for a given table config.
 */
export function getEncryptionSharingService(
  tableConfig: IEncryptionTableConfig,
): EncryptionSharingService {
  return new EncryptionSharingService(tableConfig);
}
