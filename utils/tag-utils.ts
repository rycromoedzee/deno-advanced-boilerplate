/**
 * @file utils/tag-utils.ts
 * @description Utility functions for document tag operations
 */

/**
 * Generate a random hex color string
 * @returns A hex color string like "#FF5733"
 */
export function generateRandomColor(): string {
  const hex = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  return `#${hex.toUpperCase()}`;
}

/**
 * Normalize a tag name by trimming whitespace, lowercasing, and collapsing internal whitespace
 * @param name - Raw tag name
 * @returns Normalized tag name
 */
export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Deduplicate tag IDs and filter out empty strings
 * @param tagIds - Array of tag IDs (may contain duplicates or empties)
 * @returns Array of unique, non-empty tag IDs
 */
export function getUniqueTagIds(tagIds: string[]): string[] {
  return [...new Set(tagIds.filter((id) => id !== ""))];
}
