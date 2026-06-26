/**
 * @file utils/streaming/range-parser.ts
 * @description Utilities for parsing HTTP Range headers for streaming responses
 */

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

export interface ParsedRange {
  start: number;
  end: number;
}

/**
 * Default maximum chunk size for open-ended range requests (10 MB)
 * This prevents returning entire large files in a single response
 */
const DEFAULT_MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Parse an HTTP Range header into an array of byte ranges.
 *
 * Supports multiple range specifications but only validates ranges that fall
 * within the provided file size. Invalid ranges are skipped.
 *
 * For open-ended ranges (e.g., "bytes=1000-"), caps the response to maxChunkSize
 * to enable progressive streaming of large files.
 *
 * @param rangeHeader - Raw Range header value (e.g. "bytes=0-1023")
 * @param fileSize - Size of the file in bytes
 * @param maxChunkSize - Maximum chunk size for open-ended ranges (default: 10 MB)
 * @returns Array of parsed ranges or null if no valid ranges are found
 */
export function parseRangeHeader(
  rangeHeader: string,
  fileSize: number,
  maxChunkSize: number = DEFAULT_MAX_CHUNK_SIZE,
): ParsedRange[] | null {
  const ranges: ParsedRange[] = [];

  const rangeSpec = rangeHeader.replace(/^bytes=/, "");
  const rangeStrings = rangeSpec.split(",");

  for (const rangeString of rangeStrings) {
    const trimmed = rangeString.trim();

    if (!trimmed.includes("-")) {
      continue;
    }

    const [startStr, endStr] = trimmed.split("-");

    let start: number;
    let end: number;

    if (startStr === "") {
      const suffixLength = parseInt(endStr, 10);
      if (isNaN(suffixLength)) continue;
      start = Math.max(0, fileSize - suffixLength);
      end = fileSize - 1;
    } else if (endStr === "") {
      // Open-ended range: cap to maxChunkSize for better streaming performance
      start = parseInt(startStr, 10);
      if (isNaN(start)) continue;
      // Cap the chunk size but don't exceed file size
      end = Math.min(start + maxChunkSize - 1, fileSize - 1);
    } else {
      start = parseInt(startStr, 10);
      end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) continue;
    }

    if (start < 0 || end >= fileSize || start > end) {
      useLogger(LoggerLevels.warn, {
        message: "Range validation failed",
        messageKey: "range_parser.validation_failed",
        section: loggerAppSections.DOCUMENTS_DOWNLOAD,
        details: {
          start,
          end,
          fileSize,
          reasons: {
            startNegative: start < 0,
            endExceedsFile: end >= fileSize,
            startAfterEnd: start > end,
          },
        },
      }).catch((err) => console.error("Logging failed:", err));
      continue;
    }

    ranges.push({ start, end });
  }

  const result = ranges.length > 0 ? ranges : null;

  return result;
}
