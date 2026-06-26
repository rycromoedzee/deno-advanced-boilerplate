/**
 * @file utils/shared/timing.ts
 * @description Timing-attack protection (constant-time) utilities
 */
/**
 * Timing Attack Protection Utilities
 * ==================================
 *
 * Critical security utilities to prevent timing attacks through constant-time operations.
 * These functions ensure that sensitive comparisons take constant time regardless
 * of input values, preventing attackers from inferring correct values through
 * response time analysis.
 *
 * CRITICAL: Always use these functions for security-sensitive comparisons!
 */

import { Buffer, timingSafeEqual } from "@deps";
import { envConfig } from "@config/env.ts";

/**
 * Simplified timing profiles for common operation categories
 */
export const TIMING_PROFILES = {
  /** Fast operations (simple reads, cache hits) */
  FAST: { minimumMs: 50, jitterPercent: 15 },

  /** Standard CRUD operations */
  STANDARD: { minimumMs: 80, jitterPercent: 12 },

  /** Heavy operations (bulk, complex queries) */
  HEAVY: { minimumMs: 120, jitterPercent: 18 },

  /** Authentication/security-sensitive operations */
  AUTH: { minimumMs: 150, jitterPercent: 10 },

  /** Password hashing (uses env config for bcrypt timing) */
  PASSWORD: { minimumMs: envConfig.timingProtection.passwordOperation, jitterPercent: 5 },
} as const;

export type TimingProfile = (typeof TIMING_PROFILES)[keyof typeof TIMING_PROFILES];

/**
 * Ensures minimum processing time with jitter to prevent timing analysis
 */
export async function ensureMinimumProcessingTime(
  startTime: number,
  profile: TimingProfile,
): Promise<void> {
  if (!envConfig.timingProtection.enabled) {
    return;
  }

  const { minimumMs, jitterPercent } = profile;
  const jitterMs = minimumMs * (jitterPercent / 100);
  const processingTime = performance.now() - startTime;
  const targetTime = minimumMs + (Math.random() - 0.5) * 2 * jitterMs;

  if (processingTime < targetTime) {
    await new Promise((resolve) => setTimeout(resolve, targetTime - processingTime));
  } else {
    await new Promise((resolve) => setTimeout(resolve, Math.random() * jitterMs));
  }
}

// Type definitions for safe comparison values
type BufferSafeValue =
  | ArrayBuffer
  | SharedArrayBuffer
  | number[]
  | string
  | Uint8Array
  | { valueOf(): string | object }
  | { [Symbol.toPrimitive](hint: "string"): string };

/**
 * Universal timing-safe equality comparison using Node.js native timingSafeEqual
 * CRITICAL: Use for comparing sensitive data like tokens, signatures, JWT claims, etc.
 * This is the primary function that replaces all other timing-safe comparison functions.
 *
 * @param trustedValue - The trusted/expected value
 * @param userInput - The user-provided value to compare
 * @returns boolean - True if values are equal, false otherwise
 */
export function safeEqual<T extends BufferSafeValue, U extends BufferSafeValue>(
  trustedValue: T,
  userInput: U,
): boolean {
  if (typeof trustedValue === "string" && typeof userInput === "string") {
    // For strings, ensure both buffers are the same length to prevent timing leaks
    const trustedLength = Buffer.byteLength(trustedValue);
    const userLength = Buffer.byteLength(userInput);

    // Create buffers of the trusted length
    const trustedBuffer = Buffer.alloc(trustedLength, 0, "utf-8");
    trustedBuffer.write(trustedValue);

    const userBuffer = Buffer.alloc(trustedLength, 0, "utf-8");
    userBuffer.write(userInput);

    // Ensure values are same and also have same length
    return (
      timingSafeEqual(trustedBuffer, userBuffer) &&
      trustedLength === userLength
    );
  }

  // Handle Uint8Array comparisons
  if (trustedValue instanceof Uint8Array && userInput instanceof Uint8Array) {
    if (trustedValue.length !== userInput.length) {
      return false;
    }
    return timingSafeEqual(Buffer.from(trustedValue), Buffer.from(userInput));
  }

  // Handle other buffer types
  try {
    const trustedBuffer = Buffer.from(
      trustedValue as ArrayBuffer | SharedArrayBuffer,
    );
    const userBuffer = Buffer.from(
      userInput as ArrayBuffer | SharedArrayBuffer,
    );
    return timingSafeEqual(trustedBuffer, userBuffer);
  } catch {
    return false;
  }
}

/**
 * Secure timing-attack resistant validation for multiple string comparisons
 * Always performs all comparisons regardless of early failures to prevent timing leaks
 *
 * @param comparisons - Array of comparison objects with 'a' and 'b' properties
 * @returns boolean - True if all comparisons are equal, false otherwise
 */
export function constantTimeMultiCompare(
  comparisons: Array<{ a: string; b: string }>,
): boolean {
  let overallResult = true;

  // Perform ALL comparisons to prevent timing leaks
  for (const { a, b } of comparisons) {
    const comparisonResult = safeEqual(a, b);
    overallResult = overallResult && comparisonResult;
  }

  return overallResult;
}
