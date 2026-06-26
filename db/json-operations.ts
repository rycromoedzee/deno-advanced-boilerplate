/**
 * @file db/json-operations.ts
 * @description JSON column read/write operation helpers
 */
import { type SQL, sql } from "drizzle-orm";
export interface JsonColumn<T = unknown> {
  _: {
    brand: "JsonColumn";
    type: T;
  };
}

export interface JsonOperations<T = unknown> {
  contains(value: Record<string, unknown>): SQL<unknown>;
  equals(path: string, value: unknown): SQL<unknown>;
  exists(path: string): SQL<unknown>;
  extract(path: string): SQL<unknown>;
  arrayContains(value: unknown): SQL<unknown>;
  length(): SQL<unknown>;
  isEmpty(): SQL<unknown>;
  keys(): SQL<unknown>;
}

/**
 * Create JSON operations for a column - Main JSONPath API
 * @param column - The JSON column to operate on
 * @returns JSON operations object with SQLite JSON methods
 */
export function json<T = unknown>(column: SQL<unknown>): JsonOperations<T> {
  return {
    contains(value: Record<string, unknown>): SQL<unknown> {
      // Approximate contains for simple objects in SQLite
      return sql`json_patch(${column}, ${JSON.stringify(value)}) = ${column}`;
    },

    equals(path: string, value: unknown): SQL<unknown> {
      return sql`json_extract(${column}, ${path}) = ${value}`;
    },

    exists(path: string): SQL<unknown> {
      return sql`json_extract(${column}, ${path}) IS NOT NULL`;
    },

    extract(path: string): SQL<unknown> {
      return sql`json_extract(${column}, ${path})`;
    },

    arrayContains(value: unknown): SQL<unknown> {
      return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${value})`;
    },

    length(): SQL<unknown> {
      return sql`json_array_length(${column})`;
    },

    isEmpty(): SQL<unknown> {
      return sql`(${column} IS NULL OR ${column} = 'null' OR json_type(${column}) = 'null' OR json_array_length(${column}) = 0)`;
    },

    keys(): SQL<unknown> {
      return sql`(SELECT json_group_array(key) FROM json_each(${column}))`;
    },
  };
}

/**
 * Helper function to create typed JSON operations
 * @param column - The JSON column to operate on
 * @returns Typed JSON operations object
 */
export function typedJson<T>(column: SQL<unknown>): JsonOperations<T> {
  return json<T>(column);
}

/**
 * Type-safe JSON path builder
 * @param segments - Path segments to join
 * @returns JSONPath expression (e.g., '$.user.profile.email')
 * @example jsonPath('user', 'profile', 'email') => '$.user.profile.email'
 */
export function jsonPath(...segments: string[]): string {
  return "$." + segments.join(".");
}

/**
 * Check if JSON array contains a specific value
 * @param column - The JSON column to check
 * @param value - The value to search for in the array
 * @returns SQL condition for array containment
 * @example .where(arrayContains(apiKeys.ipRestrictions, '192.168.1.1'))
 */
export function arrayContains(
  column: SQL<unknown>,
  value: string,
): SQL<unknown> {
  return sql`EXISTS (SELECT 1 FROM json_each(${column}) WHERE value = ${value})`;
}

/**
 * Extract value at JSON path as text (for SELECT clauses)
 * @param column - The JSON column to extract from
 * @param path - The JSON path to extract (e.g., '$.country')
 * @returns SQL expression for text extraction
 * @example .select({ country: extractText(threatIPs.metadata, '$.country') })
 */
export function extractText(
  column: SQL<unknown>,
  path: string,
): SQL<string> {
  // Ensure path starts with $. if it's just a key
  const fullPath = path.startsWith("$") ? path : `$.${path}`;
  return sql<string>`json_extract(${column}, ${fullPath})`;
}
