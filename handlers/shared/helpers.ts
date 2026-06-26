/**
 * @file handlers/shared/helpers.ts
 * @description Helper functions for handler factories
 */

import type { EntityType } from "./types.ts";

function normalizeErrorKeySegment(value: string): string {
  return value.toUpperCase().replace(/-/g, "_");
}

/**
 * Get default error key based on operation name and entity type
 */
export function getDefaultErrorKey(operationName: string, entityType: EntityType): string {
  const entityUpper = normalizeErrorKeySegment(entityType);
  const operationUpper = normalizeErrorKeySegment(operationName);
  const prefix = `${entityUpper}_`;
  const operationSuffix = operationUpper.startsWith(prefix) ? operationUpper.slice(prefix.length) : operationUpper;
  return `${entityUpper}.${operationSuffix}_FAILED`;
}
