/**
 * @file services/mailer/email-status.service.ts
 * @description Email Status service (mailer)
 */
import { eq, or } from "@deps";

import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { EmailStatusUpdate, RESEND_VALID_EVENT_TYPES, ResendWebhookPayload } from "../../interfaces/email.ts";
import { throwHttpError } from "@utils/http-exception.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";
import { getGlobalDB, globalTables } from "@db/index.ts";

// Remove interface definitions to break circular dependencies

async function useLogError(erroredKey: string, correlationId: string) {
  return await useLogger(LoggerLevels.error, {
    section: loggerAppSections.EMAIL_WEBHOOK,
    messageKey: "webhook.payload.validation.failed",
    message: "Webhook => Payload validation failed",
    details: {
      correlationId,
      erroredKey,
    },
  });
}

/**
 * Service for handling email status updates from webhooks
 */
export class EmailStatusService {
  /**
   * Validates webhook payload structure and data
   */
  private async validatePayload(
    payload: unknown,
    correlationId: string,
  ): Promise<ResendWebhookPayload | null> {
    try {
      if (!payload || typeof payload !== "object") {
        await useLogError("Invalid payload type", correlationId);
        return null;
      }

      const data = payload as Record<string, unknown>;

      // Check required top-level fields
      if (!data.type || typeof data.type !== "string") {
        await useLogError("Missing or invalid type field", correlationId);
        return null;
      }

      if (!data.created_at || typeof data.created_at !== "string") {
        await useLogError("Missing or invalid created_at field", correlationId);
        return null;
      }

      if (!data.data || typeof data.data !== "object") {
        await useLogError("Missing or invalid data field", correlationId);
        return null;
      }

      const eventData = data.data as Record<string, unknown>;

      // Check required data fields
      if (!eventData.email_id || typeof eventData.email_id !== "string") {
        await useLogError("Missing or invalid email_id field", correlationId);
        return null;
      }

      if (!eventData.to || typeof eventData.to !== "string") {
        await useLogError("Missing or invalid to field", correlationId);
        return null;
      }

      if (!eventData.subject || typeof eventData.subject !== "string") {
        await useLogError("Missing or invalid subject field", correlationId);
        return null;
      }

      if (!eventData.from || typeof eventData.from !== "string") {
        await useLogError("Missing or invalid from field", correlationId);
        return null;
      }

      if (!RESEND_VALID_EVENT_TYPES.includes(data.type)) {
        await useLogError(`Invalid event type. ${data.type}`, correlationId);
        return null;
      }

      return data as unknown as ResendWebhookPayload;
    } catch (error) {
      await useLogError(`Unexpected exception \n ${error}`, correlationId);
      return null;
    }
  }

  /**
   * Maps Resend event types to database status values
   */
  private mapEventToStatus(
    eventType: string,
  ): DB_ENUM_JOB_STATUS {
    switch (eventType) {
      case "email.sent":
        return DB_ENUM_JOB_STATUS.COMPLETED;
      case "email.delivered":
        return DB_ENUM_JOB_STATUS.COMPLETED;
      case "email.opened":
        return DB_ENUM_JOB_STATUS.COMPLETED;
      case "email.bounced":
        return DB_ENUM_JOB_STATUS.FAILED;
      case "email.complained":
        return DB_ENUM_JOB_STATUS.FAILED;
      case "email.delivery_delayed":
        return DB_ENUM_JOB_STATUS.PROCESSING;
      default:
        return DB_ENUM_JOB_STATUS.PENDING;
    }
  }

  /**
   * Updates email status in the database
   */
  async updateEmailStatus(
    update: EmailStatusUpdate,
    providerEmailId?: string,
  ): Promise<boolean> {
    try {
      const data = {
        status: update.status,
        lastEvent: update.eventType,
      };
      if (providerEmailId) {
        // @ts-ignore only updating emailId if the email is sent from provider
        data["emailId"] = providerEmailId;
      }

      const db = getGlobalDB();
      const conditions = [
        eq(globalTables.emails.id, update.emailId),
      ];

      if (providerEmailId) {
        conditions.push(eq(globalTables.emails.emailId, providerEmailId));
      }

      const result = await db
        .update(globalTables.emails)
        .set({ ...data })
        .where(or(...conditions))
        .returning({ id: globalTables.emails.id });

      if (result.length === 0) {
        await useLogger(LoggerLevels.warn, {
          section: loggerAppSections.EMAIL_WEBHOOK,
          messageKey: "webhook.email.not.found",
          message: "Webhook => Email ID not found in database - No records updated",
          details: {
            emailId: update.emailId,
            eventType: update.eventType,
            attemptedStatus: update.status,
          },
          meta: {
            databaseOperation: "update",
            recordsAffected: 0,
          },
        });
        return false;
      }

      return true;
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        section: loggerAppSections.EMAIL_WEBHOOK,
        messageKey: "webhook.database.update.failed",
        message: "Webhook => Database update failed with exception",
        details: {
          emailId: update.emailId,
          attemptedStatus: update.status,
          eventType: update.eventType,
          error: error instanceof Error ? error.message : String(error),
          errorStack: error instanceof Error ? error.stack : undefined,
        },
        meta: {
          databaseOperation: "update",
          operationFailed: true,
        },
      });
      return false;
    }
  }

  /**
   * Processes a complete webhook event
   */
  async processWebhookEvent(payload: ResendWebhookPayload): Promise<void> {
    try {
      // Create status update
      const statusUpdate: EmailStatusUpdate = {
        emailId: payload.data.email_id,
        status: this.mapEventToStatus(payload.type),
        eventType: payload.type,
        last_event: payload.type,
      };

      // Update database
      await this.updateEmailStatus(statusUpdate, payload.data.email_id);

      await getGlobalDB().update(globalTables.emails).set({
        data: null,
      }).where(eq(globalTables.emails.emailId, payload.data.email_id));
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        section: loggerAppSections.EMAIL_WEBHOOK,
        messageKey: "webhook.event.processing.failed",
        message: "Webhook => Event processing failed",
        details: {
          payload,
          error,
        },
      });
      throwHttpError("COMMON.WEBHOOK_PROCESSING_ERROR");
    }
  }
}
