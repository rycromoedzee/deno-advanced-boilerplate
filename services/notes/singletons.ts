/**
 * @file services/notes/singletons.ts
 * @description Singleton getters for notes services.
 */

import { NoteCreateService } from "./note-create.service.ts";
import { NoteReadService } from "./note-read.service.ts";
import { NoteUpdateService } from "./note-update.service.ts";
import { NoteArchiveService } from "./note-archive.service.ts";
import { NoteDeleteService } from "./note-delete.service.ts";
import { NoteEventsSSEService } from "./note-events-sse.service.ts";
import { NoteEncryptionService } from "./note-encryption.service.ts";

let noteCreateService: NoteCreateService;
let noteReadService: NoteReadService;
let noteUpdateService: NoteUpdateService;
let noteArchiveService: NoteArchiveService;
let noteDeleteService: NoteDeleteService;
let noteEventsSSEService: NoteEventsSSEService;
let noteEncryptionService: NoteEncryptionService;

/**
 * Gets the singleton instance of NoteCreateService
 * @returns {NoteCreateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteCreateService(): NoteCreateService {
  if (!noteCreateService) {
    try {
      noteCreateService = new NoteCreateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteCreateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteCreateService;
}

/**
 * Gets the singleton instance of NoteReadService
 * @returns {NoteReadService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteReadService(): NoteReadService {
  if (!noteReadService) {
    try {
      noteReadService = new NoteReadService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteReadService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteReadService;
}

/**
 * Gets the singleton instance of NoteUpdateService
 * @returns {NoteUpdateService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteUpdateService(): NoteUpdateService {
  if (!noteUpdateService) {
    try {
      noteUpdateService = new NoteUpdateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteUpdateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteUpdateService;
}

/**
 * Gets the singleton instance of NoteArchiveService
 * @returns {NoteArchiveService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteArchiveService(): NoteArchiveService {
  if (!noteArchiveService) {
    try {
      noteArchiveService = new NoteArchiveService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteArchiveService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteArchiveService;
}

/**
 * Gets the singleton instance of NoteDeleteService
 * @returns {NoteDeleteService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteDeleteService(): NoteDeleteService {
  if (!noteDeleteService) {
    try {
      noteDeleteService = new NoteDeleteService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteDeleteService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteDeleteService;
}

/**
 * Gets the singleton instance of NoteEventsSSEService
 * @returns {NoteEventsSSEService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteEventsSSEService(): NoteEventsSSEService {
  if (!noteEventsSSEService) {
    try {
      noteEventsSSEService = new NoteEventsSSEService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteEventsSSEService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteEventsSSEService;
}

/**
 * Gets the singleton instance of NoteEncryptionService
 * @returns {NoteEncryptionService} The singleton instance
 * @throws {Error} If service initialization fails
 */
export function getNoteEncryptionService(): NoteEncryptionService {
  if (!noteEncryptionService) {
    try {
      noteEncryptionService = new NoteEncryptionService();
    } catch (error) {
      throw new Error(
        `Failed to initialize NoteEncryptionService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return noteEncryptionService;
}
