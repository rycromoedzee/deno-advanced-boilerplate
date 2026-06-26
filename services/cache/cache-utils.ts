/**
 * @file services/cache/cache-utils.ts
 * @description Shared utility functions for cache providers
 */

/**
 * Calculate the byte size of a string using UTF-8 encoding
 */
export function getByteLength(str: string): number {
  return new TextEncoder().encode(str).length;
}

/**
 * Calculate the estimated size of a cache entry in bytes
 * @param key - The cache key
 * @param value - The cache value (will be JSON stringified)
 * @param overhead - Additional overhead in bytes (default: 200 for object metadata)
 */
export function calculateEntrySize(
  key: string,
  value: unknown,
  overhead = 200,
): number {
  try {
    const keySize = getByteLength(key);
    const valueSize = getByteLength(JSON.stringify(value));
    return keySize + valueSize + overhead;
  } catch {
    // Fallback size estimate if serialization fails
    return 1000;
  }
}

/**
 * Create a namespaced cache key
 */
export function createCacheKey(namespace: string, key: string): string {
  return `${namespace}:${key}`;
}

/**
 * Sanitize a glob pattern to prevent injection attacks
 * Converts glob wildcards to regex equivalents
 */
export function sanitizeGlobPattern(pattern: string): string {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&") // Escape regex chars except * and ?
    .replace(/\*/g, ".*") // Convert * to .*
    .replace(/\?/g, "."); // Convert ? to .
}

/**
 * Calculate hit rate as a percentage
 */
export function calculateHitRate(hits: number, misses: number): number {
  const total = hits + misses;
  return total > 0 ? (hits / total) * 100 : 0;
}

/**
 * Generate a unique instance ID for cache bus
 */
export function generateInstanceId(): string {
  return `instance_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

/**
 * Check if a cache entry has expired
 */
export function isExpired(expiresAt?: number): boolean {
  if (!expiresAt) return false;
  return Date.now() >= expiresAt;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0.00B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + sizes[i];
}

/**
 * Format a number as a percentage with specified decimal places
 */
export function formatPercentage(value: number, decimals = 2): string {
  return `${value.toFixed(decimals)}%`;
}

/**
 * Create namespace statistics object with default values
 */
export interface NamespaceStats {
  hits: number;
  misses: number;
  evictions?: number;
  createdTime: Date;
  lastResetTime: Date;
}

export function createNamespaceStats(): NamespaceStats {
  const now = new Date();
  return {
    hits: 0,
    misses: 0,
    evictions: 0,
    createdTime: now,
    lastResetTime: now,
  };
}

/**
 * Safe JSON parsing with fallback
 */
export function safeJsonParse<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Safe JSON stringification
 */
export function safeJsonStringify(value: unknown, fallback = "{}"): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

/**
 * Batch an array into smaller chunks
 */
export function batchArray<T>(array: T[], batchSize: number): T[][] {
  const batches: T[][] = [];
  for (let i = 0; i < array.length; i += batchSize) {
    batches.push(array.slice(i, i + batchSize));
  }
  return batches;
}

/**
 * Sleep for a specified number of milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
