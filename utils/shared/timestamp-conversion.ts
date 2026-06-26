/**
 * @file utils/shared/timestamp-conversion.ts
 * @description Timestamp conversion utilities
 */
/**
 * Timestamp format detection and conversion utilities
 * Handles both Unix seconds and milliseconds for API compatibility
 */

/**
 * Detects if a timestamp is in Unix seconds or milliseconds format
 * Uses 1,000,000,000,000 as the threshold (year 2001 in milliseconds)
 * @param timestamp - The timestamp to analyze
 * @returns 'seconds' or 'milliseconds'
 */
export const detectTimestampFormat = (timestamp: number): "seconds" | "milliseconds" => {
  return timestamp > 1_000_000_000_000 ? "milliseconds" : "seconds";
};

/**
 * Converts any timestamp format to storage format (Unix seconds)
 * @param timestamp - The timestamp to convert
 * @returns Unix timestamp in seconds
 */
export const convertToStorageFormat = (timestamp: number): number => {
  const format = detectTimestampFormat(timestamp);
  return format === "milliseconds" ? Math.floor(timestamp / 1000) : timestamp;
};

/**
 * Converts any timestamp format to API format (Unix milliseconds)
 * @param timestamp - The timestamp to convert
 * @returns Unix timestamp in milliseconds
 */
export const convertToApiFormat = (timestamp: number): number => {
  const format = detectTimestampFormat(timestamp);
  return format === "seconds" ? timestamp * 1000 : timestamp;
};

/**
 * Validates a timestamp against current time in the same format
 * @param timestamp - The timestamp to validate
 * @param format - The expected format ('seconds' or 'milliseconds')
 * @returns true if valid, false otherwise
 */
export const validateTimestamp = (timestamp: number, format: "seconds" | "milliseconds"): boolean => {
  if (typeof timestamp !== "number" || !isFinite(timestamp)) {
    return false;
  }

  const now = format === "milliseconds" ? Date.now() : Math.floor(Date.now() / 1000);
  return timestamp > now;
};
