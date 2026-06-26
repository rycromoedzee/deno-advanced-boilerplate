/**
 * @file services/mailer/index.ts
 * @description Barrel exports for mailer services
 */
// Main exports for the mailer service module
// This file maintains backward compatibility with existing imports

// Re-export email interfaces and types from centralized location
export type {
  CachedTemplateFunction,
  EmailSendConfig,
  EmailSendResult,
  EmailStatusUpdate,
  EmailTemplateData,
  EmailTemplateOptions,
  EmailTemplateStorageConfig,
  EmailTransportConfig,
  IEmailTemplateStorage,
  IncludeLookup,
  ResendWebhookPayload,
  WebhookTokenConfig,
  WebhookValidationResult,
} from "@interfaces/email.ts";

// Export service classes
export { EmailTemplateService, EmailTemplateStorage } from "./email-template.service.ts";
export { EmailSenderService } from "./email-sender.service.ts";
export { EmailStatusService } from "./email-status.service.ts";

// Import classes for creating instances
import { EmailTemplateService } from "./email-template.service.ts";
import { EmailSenderService } from "./email-sender.service.ts";
import { getTokenHelperService } from "../token/index.ts";
import { EmailStatusService } from "./email-status.service.ts";

// Singleton instances
let emailTemplateInstance: EmailTemplateService | null = null;
let emailStatusInstance: EmailStatusService | null = null;
let emailSenderInstance: EmailSenderService | null = null;

/**
 * Gets the singleton instance of EmailTemplateService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns EmailTemplateService The singleton instance
 * @throws Error If initialization fails
 */
export function getEmailTemplateService(): EmailTemplateService {
  if (!emailTemplateInstance) {
    try {
      emailTemplateInstance = new EmailTemplateService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EmailTemplateService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return emailTemplateInstance;
}

/**
 * Gets the singleton instance of EmailStatusService.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns EmailStatusService The singleton instance
 * @throws Error If initialization fails
 */
export function getEmailStatusService(): EmailStatusService {
  if (!emailStatusInstance) {
    try {
      emailStatusInstance = new EmailStatusService();
    } catch (error) {
      throw new Error(
        `Failed to initialize EmailStatusService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return emailStatusInstance;
}

/**
 * Gets the singleton instance of EmailSenderService with singleton dependencies.
 * Creates a new instance on first call and reuses it for subsequent calls.
 * @returns EmailSenderService The singleton instance
 * @throws Error If initialization fails
 */
export function getEmailSenderService(): EmailSenderService {
  if (!emailSenderInstance) {
    try {
      emailSenderInstance = new EmailSenderService(
        getEmailTemplateService(),
        getEmailStatusService(),
        getTokenHelperService(),
      );
    } catch (error) {
      throw new Error(
        `Failed to initialize EmailSenderService: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
  }
  return emailSenderInstance;
}

// Ensure the services are properly wired together for seamless operation
// The EmailSenderService uses the EmailTemplateService for template processing
// This maintains the same functionality as the original monolithic service

/**
 * Test utility function to reset singleton instances.
 * This should only be used in test environments.
 * @internal
 */
export function resetMailerSingletons(): void {
  emailTemplateInstance = null;
  emailStatusInstance = null;
  emailSenderInstance = null;
}

export enum EmailCategories {
  FORGET_PASSWORD = "FORGET_PASSWORD",
  SIGN_UP = "sign-up",
  MAGIC = "MAGIC",
}
