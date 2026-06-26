/**
 * @file utils/database/collision-create.ts
 * @description Collision-resistant record creation helper
 */
import { generateRandomId } from "./id-generation/generator.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@services/logger/index.ts";

/**
 * Database create with retry on ID collision
 */
export async function databaseCreateWithRetry<T>(
  insertFn: (id: string) => Promise<T>,
  generateId: () => string = generateRandomId,
  maxRetries: number = 3,
): Promise<T> {
  let attempts = 0;
  while (attempts < maxRetries) {
    const id = generateId();

    try {
      const result = await insertFn(id);
      return result;
    } catch (error: unknown) {
      if (error instanceof Error && error.message?.includes("UNIQUE constraint failed")) {
        await useLogger(LoggerLevels.critical, {
          message: "ID collision detected",
          section: loggerAppSections.DEBUG,
          messageKey: "id_collision_detected",
          details: { id, attempt: attempts + 1, error },
        });
        attempts++;
        continue; // Retry with new ID
      }
      throw error; // Rethrow other errors
    }
  }

  throw new Error(`Failed to insert after ${maxRetries} attempts due to ID collisions`);
}
