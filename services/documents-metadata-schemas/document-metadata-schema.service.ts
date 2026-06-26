/**
 * @file services/documents/document-metadata-schema.service.ts
 * @description Document metadata schema service for CRUD operations and metadata validation
 *
 * This service handles:
 * - Metadata schema CRUD operations
 * - Schema validation for document metadata
 * - User-scoped schema management
 * - Type validation and conversion
 * - Automatic migration of document metadata when schemas change
 */

import { and, desc, eq, ilike, or, sql } from "@deps";
import { getTenantDB, tenantTables } from "@db/index.ts";
import { traced } from "@services/tracing/index.ts";
import { tracedWithServiceErrorHandling } from "@utils/exception-handler.ts";
import { AppHttpException, throwHttpError, throwHttpErrorWithCustomMessage } from "@utils/http-exception.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { getTimeNow, getTimeNowForStorage } from "@utils/shared/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { databaseCreateWithRetry } from "@utils/database/index.ts";
import type {
  ICreateMetadataSchemaInput,
  IDocumentMetadataSchema,
  IMetadataSchemaFilters,
  IMetadataSchemaType,
  IMetadataValidationResult,
  IUpdateMetadataSchemaInput,
} from "@models/documents/metadata-schema.model.ts";

export class DocumentMetadataSchemaService {
  /**
   * Creates a new metadata schema
   *
   * @param data - Schema creation data
   * @param userId - ID of the user creating the schema
   * @returns Promise<IDocumentMetadataSchema> - The created schema
   */
  async createSchema(
    data: ICreateMetadataSchemaInput,
    userId: string,
  ): Promise<IDocumentMetadataSchema> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.createSchema",
      {
        service: "DocumentMetadataSchemaService",
        method: "createSchema",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["schema_key"] = data.key;
        span.attributes["user_id"] = userId;

        // Check for existing schema with same key (case-insensitive)
        const existing = await this.findSchemaByKey(data.key, userId);
        if (existing) {
          span.attributes["duplicate_found"] = true;
          throwHttpErrorWithCustomMessage(
            "VALIDATION.DUPLICATE_VALUE",
            `Metadata schema with key "${data.key}" already exists for this user`,
          );
        }

        // Validate default value if provided
        if (data.defaultValue !== null && data.defaultValue !== undefined) {
          this.validateValueForType(data.defaultValue, data.type, data.key);
        }

        const now = Math.floor(getTimeNow() / 1000);

        const schema = await databaseCreateWithRetry(
          async (generatedSchemaId) => {
            const [created] = await (await getTenantDB())
              .insert(tenantTables.documentMetadataSchemas)
              .values({
                id: generatedSchemaId,
                userId,
                name: data.name.trim(),
                key: data.key.trim(),
                type: data.type,
                isRequired: data.isRequired ?? false,
                defaultValue: data.defaultValue || null,
                createdAt: now,
                updatedAt: now,
              })
              .returning();

            if (!created) {
              throw throwHttpError("DATABASE.CREATE_WITH_RETRY_FAILED");
            }
            return created;
          },
          () => generateIdRandom(14),
        );

        span.attributes["schema_id"] = schema.id;
        span.attributes["success"] = true;

        // Migrate existing documents if schema has a default value
        if (data.defaultValue !== null && data.defaultValue !== undefined) {
          await this.migrateDocumentsOnSchemaCreate(schema as IDocumentMetadataSchema, userId);
        }

        return schema as IDocumentMetadataSchema;
      },
    );
  }

  /**
   * Finds a metadata schema by ID
   *
   * @param id - Schema ID
   * @param userId - User ID for scope validation
   * @returns Promise<IDocumentMetadataSchema | null> - The schema if found
   */
  async findSchemaById(
    id: string,
    userId: string,
  ): Promise<IDocumentMetadataSchema | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.findSchemaById",
      {
        service: "DocumentMetadataSchemaService",
        method: "findSchemaById",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["schema_id"] = id;

        const [schema] = await (await getTenantDB())
          .select()
          .from(tenantTables.documentMetadataSchemas)
          .where(
            and(
              eq(tenantTables.documentMetadataSchemas.id, id),
              eq(tenantTables.documentMetadataSchemas.userId, userId),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!schema;
        return schema ? (schema as IDocumentMetadataSchema) : null;
      },
    );
  }

  /**
   * Finds a metadata schema by key (case-insensitive)
   *
   * @param key - Schema key
   * @param userId - User ID for scope
   * @returns Promise<IDocumentMetadataSchema | null> - The schema if found
   */
  async findSchemaByKey(
    key: string,
    userId: string,
  ): Promise<IDocumentMetadataSchema | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.findSchemaByKey",
      {
        service: "DocumentMetadataSchemaService",
        method: "findSchemaByKey",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["schema_key"] = key;

        const normalizedKey = key.trim().toLowerCase();

        const [schema] = await (await getTenantDB())
          .select()
          .from(tenantTables.documentMetadataSchemas)
          .where(
            and(
              sql`LOWER(${tenantTables.documentMetadataSchemas.key}) = ${normalizedKey}`,
              eq(tenantTables.documentMetadataSchemas.userId, userId),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!schema;
        return schema ? (schema as IDocumentMetadataSchema) : null;
      },
    );
  }

  /**
   * Finds schema by ID or key
   *
   * @param idOrKey - Schema ID or key
   * @param userId - User ID
   * @returns Promise<IDocumentMetadataSchema | null> - The schema if found
   */
  async findSchemaByIdOrKey(
    idOrKey: string,
    userId: string,
  ): Promise<IDocumentMetadataSchema | null> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.findSchemaByIdOrKey",
      {
        service: "DocumentMetadataSchemaService",
        method: "findSchemaByIdOrKey",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["id_or_key"] = idOrKey;
        span.attributes["user_id"] = userId;

        const normalizedKey = idOrKey.trim().toLowerCase();

        const [schema] = await (await getTenantDB())
          .select()
          .from(tenantTables.documentMetadataSchemas)
          .where(
            and(
              eq(tenantTables.documentMetadataSchemas.userId, userId),
              or(
                eq(tenantTables.documentMetadataSchemas.id, idOrKey),
                sql`LOWER(${tenantTables.documentMetadataSchemas.key}) = ${normalizedKey}`,
              ),
            ),
          )
          .limit(1);

        span.attributes["found"] = !!schema;
        return schema ? (schema as IDocumentMetadataSchema) : null;
      },
    );
  }

  /**
   * Updates a metadata schema
   *
   * @param idOrSchema - Schema ID or pre-fetched schema object
   * @param data - Update data
   * @param userId - ID of user performing update
   * @returns Promise<IDocumentMetadataSchema> - The updated schema
   */
  async updateSchema(
    idOrSchema: string | IDocumentMetadataSchema,
    data: IUpdateMetadataSchemaInput,
    userId: string,
  ): Promise<IDocumentMetadataSchema> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.updateSchema",
      {
        service: "DocumentMetadataSchemaService",
        method: "updateSchema",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const schemaId = typeof idOrSchema === "string" ? idOrSchema : idOrSchema.id;
        span.attributes["schema_id"] = schemaId;
        span.attributes["user_id"] = userId;

        // Get existing schema - either from parameter or lookup
        const existing = typeof idOrSchema === "string" ? await this.findSchemaById(idOrSchema, userId) : idOrSchema;

        if (!existing) {
          span.attributes["schema_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Validate default value if provided and type hasn't changed
        if (data.defaultValue !== undefined && data.defaultValue !== null) {
          this.validateValueForType(data.defaultValue, existing.type, existing.key);
        }

        const now = getTimeNowForStorage();

        const updateData: Record<string, unknown> = {
          updatedAt: now,
        };

        if (data.name !== undefined) updateData.name = data.name.trim();
        if (data.isRequired !== undefined) updateData.isRequired = data.isRequired;
        if (data.defaultValue !== undefined) updateData.defaultValue = data.defaultValue;

        const [updated] = await (await getTenantDB())
          .update(tenantTables.documentMetadataSchemas)
          .set(updateData)
          .where(
            and(
              eq(tenantTables.documentMetadataSchemas.id, schemaId),
              eq(tenantTables.documentMetadataSchemas.userId, userId),
            ),
          )
          .returning();

        const updatedSchema = updated as IDocumentMetadataSchema;

        // Migrate existing documents if default value changed or required flag changed
        if (data.defaultValue !== undefined || data.isRequired !== undefined) {
          await this.migrateDocumentsOnSchemaUpdate(updatedSchema, userId);
        }

        span.attributes["success"] = true;
        return updatedSchema;
      },
    );
  }

  /**
   * Deletes a metadata schema
   *
   * @param idOrSchema - Schema ID or pre-fetched schema object
   * @param userId - ID of user performing deletion
   */
  async deleteSchema(
    idOrSchema: string | IDocumentMetadataSchema,
    userId: string,
  ): Promise<void> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.deleteSchema",
      {
        service: "DocumentMetadataSchemaService",
        method: "deleteSchema",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        const schemaId = typeof idOrSchema === "string" ? idOrSchema : idOrSchema.id;
        span.attributes["schema_id"] = schemaId;
        span.attributes["user_id"] = userId;

        // Get schema - either from parameter or lookup
        const schema = typeof idOrSchema === "string" ? await this.findSchemaById(idOrSchema, userId) : idOrSchema;

        if (!schema) {
          span.attributes["schema_found"] = false;
          throwHttpError("COMMON.NOT_FOUND");
        }

        // Migrate documents to remove this metadata field
        await this.migrateDocumentsOnSchemaDelete(schema, userId);

        // Delete the schema
        await (await getTenantDB())
          .delete(tenantTables.documentMetadataSchemas)
          .where(
            and(
              eq(tenantTables.documentMetadataSchemas.id, schemaId),
              eq(tenantTables.documentMetadataSchemas.userId, userId),
            ),
          );

        span.attributes["success"] = true;
      },
    );
  }

  /**
   * Lists all metadata schemas for a user
   *
   * @param userId - User ID
   * @param filters - Optional filters
   * @returns Promise<IDocumentMetadataSchema[]> - Array of schemas
   */
  async listSchemas(
    userId: string,
    filters: IMetadataSchemaFilters = {},
  ): Promise<IDocumentMetadataSchema[]> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.listSchemas",
      {
        service: "DocumentMetadataSchemaService",
        method: "listSchemas",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["has_filters"] = Object.keys(filters).length > 0;

        const conditions = [eq(tenantTables.documentMetadataSchemas.userId, userId)];

        // Apply search filter (searches both name and key)
        if (filters.search) {
          conditions.push(
            or(
              ilike(tenantTables.documentMetadataSchemas.name, `%${filters.search}%`),
              ilike(tenantTables.documentMetadataSchemas.key, `%${filters.search}%`),
            )!,
          );
        }

        // Apply type filter
        if (filters.type) {
          conditions.push(eq(tenantTables.documentMetadataSchemas.type, filters.type));
        }

        // Build and execute query with sorting
        const sortBy = filters.sortBy || "name";
        const sortOrder = filters.sortOrder || "asc";

        const sortColumn = sortBy === "key"
          ? tenantTables.documentMetadataSchemas.key
          : sortBy === "createdAt"
          ? tenantTables.documentMetadataSchemas.createdAt
          : tenantTables.documentMetadataSchemas.name;

        const schemas = sortOrder === "desc"
          ? await (await getTenantDB())
            .select()
            .from(tenantTables.documentMetadataSchemas)
            .where(and(...conditions))
            .orderBy(desc(sortColumn))
          : await (await getTenantDB())
            .select()
            .from(tenantTables.documentMetadataSchemas)
            .where(and(...conditions))
            .orderBy(sortColumn);

        const result = schemas as IDocumentMetadataSchema[];

        span.attributes["result_count"] = result.length;
        return result;
      },
    );
  }

  /**
   * Validates a value against a type
   *
   * @param value - Value to validate (as string)
   * @param type - Expected type
   * @param fieldName - Field name for error messages
   * @throws AppHttpException if validation fails
   */
  private validateValueForType(value: string, type: IMetadataSchemaType, fieldName: string): void {
    switch (type) {
      case "text":
        // Text is always valid (already a string)
        break;
      case "number":
        if (isNaN(Number(value))) {
          throwHttpErrorWithCustomMessage(
            "VALIDATION.INVALID_FORMAT",
            `Field "${fieldName}" must be a valid number`,
          );
        }
        break;
      case "boolean":
        if (value !== "true" && value !== "false") {
          throwHttpErrorWithCustomMessage(
            "VALIDATION.INVALID_FORMAT",
            `Field "${fieldName}" must be "true" or "false"`,
          );
        }
        break;
      default:
        throwHttpErrorWithCustomMessage(
          "VALIDATION.INVALID_FORMAT",
          `Unknown type for field "${fieldName}"`,
        );
    }
  }

  /**
   * Validates document metadata against user's schemas
   * This is a helper function to ensure metadata conforms to defined schemas
   *
   * @param metadata - Metadata object to validate
   * @param userId - User ID to get schemas for
   * @returns Promise<IMetadataValidationResult> - Validation result
   */
  async validateDocumentMetadata(
    metadata: Record<string, unknown>,
    userId: string,
  ): Promise<IMetadataValidationResult> {
    return await tracedWithServiceErrorHandling(
      "DocumentMetadataSchemaService.validateDocumentMetadata",
      {
        service: "DocumentMetadataSchemaService",
        method: "validateDocumentMetadata",
        section: loggerAppSections.DOCUMENTS,
        details: { userId },
      },
      "COMMON.INTERNAL_SERVER_ERROR",
      async (span) => {
        span.attributes["user_id"] = userId;
        span.attributes["metadata_keys"] = Object.keys(metadata).join(",");

        const schemas = await this.listSchemas(userId);

        const errors: Array<{ key: string; error: string }> = [];

        // Check required fields
        for (const schema of schemas) {
          if (schema.isRequired && !(schema.key in metadata)) {
            errors.push({
              key: schema.key,
              error: `Required field "${schema.name}" (${schema.key}) is missing`,
            });
          }
        }

        // Validate types for provided metadata
        const schemaMap = new Map(schemas.map((s) => [s.key, s]));

        for (const [key, value] of Object.entries(metadata)) {
          const schema = schemaMap.get(key);

          // If schema doesn't exist for this key, skip validation (allow extra fields)
          if (!schema) {
            continue;
          }

          // Validate type
          if (value !== null && value !== undefined) {
            const stringValue = String(value);
            try {
              this.validateValueForType(stringValue, schema.type, schema.name);
            } catch (error) {
              if (error instanceof AppHttpException) {
                errors.push({
                  key,
                  error: error.message,
                });
              }
            }
          }
        }

        const valid = errors.length === 0;
        span.attributes["valid"] = valid;
        span.attributes["error_count"] = errors.length;

        return { valid, errors };
      },
    );
  }

  /**
   * Helper to validate and throw if metadata is invalid
   * Convenience method for use in document create/update
   *
   * @param metadata - Metadata to validate
   * @param userId - User ID
   * @throws AppHttpException if validation fails
   */
  async validateDocumentMetadataOrThrow(
    metadata: Record<string, unknown>,
    userId: string,
  ): Promise<void> {
    const result = await this.validateDocumentMetadata(metadata, userId);
    if (!result.valid) {
      const errorMessages = result.errors.map((e) => `${e.key}: ${e.error}`).join("; ");
      throwHttpErrorWithCustomMessage(
        "VALIDATION.SCHEMA_VALIDATION_FAILED",
        `Metadata validation failed: ${errorMessages}`,
      );
    }
  }

  /**
   * Migrates existing documents when a new schema is created with a default value
   * Adds the default value to all documents that don't have this metadata field
   *
   * @param schema - The newly created schema
   * @param userId - User ID
   */
  private async migrateDocumentsOnSchemaCreate(
    schema: IDocumentMetadataSchema,
    userId: string,
  ): Promise<void> {
    return await traced("DocumentMetadataSchemaService.migrateDocumentsOnSchemaCreate", "service", async (span) => {
      span.attributes["schema_key"] = schema.key;
      span.attributes["user_id"] = userId;

      try {
        // Only migrate if schema has a default value
        if (schema.defaultValue === null || schema.defaultValue === undefined) {
          span.attributes["documents_updated"] = 0;
          return;
        }

        const now = getTimeNowForStorage();

        const db = await getTenantDB();
        const result = await db
          .update(tenantTables.documents)
          .set({
            metadata: sql`json_insert(COALESCE(${tenantTables.documents.metadata}, '{}'), '$.' || ${schema.key}, ${schema.defaultValue})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(tenantTables.documents.ownerId, userId),
              sql`json_type(COALESCE(${tenantTables.documents.metadata}, '{}'), '$.' || ${schema.key}) IS NULL`,
            ),
          )
          .returning({ id: tenantTables.documents.id });

        const updatedCount = result.length;
        span.attributes["documents_migrated"] = updatedCount;
        span.attributes["documents_updated"] = updatedCount;
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Error migrating documents on schema creation",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "metadata_schema.migrate_create.error",
          details: { schemaKey: schema.key },
          raw: error,
        });
        // Don't throw - schema was created successfully, migration is best-effort
      }
    });
  }

  /**
   * Migrates existing documents when a schema is updated
   * Updates documents based on changes to default value or required flag
   *
   * @param schema - The updated schema
   * @param userId - User ID
   */
  private async migrateDocumentsOnSchemaUpdate(
    schema: IDocumentMetadataSchema,
    userId: string,
  ): Promise<void> {
    return await traced("DocumentMetadataSchemaService.migrateDocumentsOnSchemaUpdate", "service", async (span) => {
      span.attributes["schema_key"] = schema.key;
      span.attributes["user_id"] = userId;

      try {
        if (schema.defaultValue === null || schema.defaultValue === undefined) {
          span.attributes["documents_updated"] = 0;
          return;
        }

        const now = getTimeNowForStorage();

        const db = await getTenantDB();
        const result = await db
          .update(tenantTables.documents)
          .set({
            metadata: sql`json_insert(COALESCE(${tenantTables.documents.metadata}, '{}'), '$.' || ${schema.key}, ${schema.defaultValue})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(tenantTables.documents.ownerId, userId),
              sql`json_type(COALESCE(${tenantTables.documents.metadata}, '{}'), '$.' || ${schema.key}) IS NULL`,
            ),
          )
          .returning({ id: tenantTables.documents.id });

        const updatedCount = result.length;
        span.attributes["documents_migrated"] = updatedCount;
        span.attributes["documents_updated"] = updatedCount;
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Error migrating documents on schema update",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "metadata_schema.migrate_update.error",
          details: { schemaKey: schema.key },
          raw: error,
        });
        // Don't throw - schema was updated successfully, migration is best-effort
      }
    });
  }

  /**
   * Migrates existing documents when a schema is deleted
   * Removes the metadata field from all documents
   *
   * @param schema - The schema being deleted
   * @param userId - User ID
   */
  private async migrateDocumentsOnSchemaDelete(
    schema: IDocumentMetadataSchema,
    userId: string,
  ): Promise<void> {
    return await traced("DocumentMetadataSchemaService.migrateDocumentsOnSchemaDelete", "service", async (span) => {
      span.attributes["schema_key"] = schema.key;
      span.attributes["user_id"] = userId;

      try {
        const now = getTimeNowForStorage();

        // Single batch update using SQLite JSON operations
        // Remove the key from metadata JSON for all documents that have it
        const db = await getTenantDB();
        const result = await db
          .update(tenantTables.documents)
          .set({
            metadata: sql`json_remove(${tenantTables.documents.metadata}, '$.' || ${schema.key})`,
            updatedAt: now,
          })
          .where(
            and(
              eq(tenantTables.documents.ownerId, userId),
              sql`json_type(${tenantTables.documents.metadata}, '$.' || ${schema.key}) IS NOT NULL`,
            ),
          )
          .returning({ id: tenantTables.documents.id });

        const updatedCount = result.length;
        span.attributes["documents_migrated"] = updatedCount;
        span.attributes["documents_updated"] = updatedCount;
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Error migrating documents on schema deletion",
          section: loggerAppSections.DOCUMENTS,
          messageKey: "metadata_schema.migrate_delete.error",
          details: { schemaKey: schema.key },
          raw: error,
        });
        // Don't throw - we still want to delete the schema even if migration fails
      }
    });
  }
}
