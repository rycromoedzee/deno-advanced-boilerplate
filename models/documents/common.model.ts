/**
 * @file models/documents/common.model.ts
 * @description Common model/types
 */
import { z } from "@deps";

/**
 * Metadata object validation schema
 */
export const SCHEMA_VALIDATION_METADATA = z.record(z.string(), z.unknown()).default({}).openapi({
  description: "Arbitrary user-supplied metadata key/value pairs",
  example: { source: "web", department: "legal" },
});

/**
 * MIME type validation schema
 */
export const SCHEMA_VALIDATION_MIME_TYPE = z.string().regex(/^[a-z]+\/[a-z0-9\-\+\.]+$/i).openapi({
  description: "IANA MIME type (e.g. application/pdf)",
  example: "application/pdf",
});

export const SCHEMA_DOCUMENT_ID = z.string().nonoptional().openapi({
  description: "Document ID",
  example: "ij37qzl5ouk6jejr",
});

export const SCHEMA_DOCUMENT_FOLDER_ID = z.string().nonoptional().openapi({
  description: "Document Folder ID",
  example: "dYY4qHC4otwc",
});

export const SCHEMA_DOCUMENT_TAG_ID = z.string().nonoptional().openapi({
  description: "Document Tag ID",
  example: "ij37qzl5ouk6jejr",
});

/**
 * Content type enum validation schema
 */
export const SCHEMA_VALIDATION_CONTENT_TYPE = z.enum([
  "pdf",
  "image",
  "video",
  "audio",
  "text",
  "spreadsheet",
  "presentation",
  "archive",
  "other",
]).optional().openapi({
  description: "Document content category",
  example: "pdf",
});

export type IContentType = z.infer<typeof SCHEMA_VALIDATION_CONTENT_TYPE>;
