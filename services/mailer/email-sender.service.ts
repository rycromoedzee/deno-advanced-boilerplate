/**
 * @file services/mailer/email-sender.service.ts
 * @description Email Sender service (mailer)
 */
import { and, createTransport, eq, htmlToText, inArray, Resend } from "@deps";
import { envConfig } from "@config/env.ts";
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";
import { traced } from "@services/tracing/index.ts";
import { EmailSendConfig, EmailSendResult, EmailTemplateData, EmailTemplateName, EmailTransportConfig } from "@interfaces/email.ts";
import { getTokenHelperService, TokenHelperService } from "../token/index.ts";
import { EmailStatusService } from "./email-status.service.ts";
import { EmailTemplateService } from "./email-template.service.ts";
// Remove direct import to break circular dependency

import { getGlobalDB, globalTables } from "@db/index.ts";
import { generateIdRandom } from "@utils/database/id-generation/index.ts";
import { DB_ENUM_JOB_STATUS } from "@db/enums/index.ts";
import { JWT_TOKEN_CONFIG, JWT_TOKEN_TYPES } from "@constants/token.ts";
// Remove direct import to break circular dependency

// Remove local singletons to break circular dependencies

/**
 * Email sender service for handling email delivery
 */
export class EmailSenderService {
  private templateService: EmailTemplateService;
  private statusService: EmailStatusService;
  private mailer: ReturnType<typeof createTransport> | null = null;
  private resend: Resend | null = null;
  private tokenHelperService: TokenHelperService;
  private isProcessing = false;
  private db = getGlobalDB();

  constructor(
    templateService: EmailTemplateService,
    statusService: EmailStatusService,
    tokenHelperService?: TokenHelperService,
  ) {
    this.templateService = templateService;
    this.statusService = statusService;
    this.tokenHelperService = tokenHelperService || getTokenHelperService();
  }

  /**
   * Initialize email transports based on environment
   */
  private initializeTransports(): void {
    if (!this.resend && envConfig.isProduction) {
      this.resend = new Resend(envConfig.mail.key);
    }

    if (!this.mailer && envConfig.isDevelopment) {
      this.mailer = createTransport({
        host: envConfig.mail.devHost,
        port: envConfig.mail.devPort,
        secure: false,
      } as EmailTransportConfig);
    }
  }

  /**
   * Generate unsubscribe URL with JWT token
   */
  private async generateUnsubscribeURL(
    userId: string,
    email: string,
    emailTemplateName: string,
    emailCategory: string,
  ): Promise<string> {
    return `https://${envConfig.public.frontURL}/unsubscribe/${await this
      .tokenHelperService.signTokenJWT(
        JWT_TOKEN_CONFIG.tokenTTL.email,
        userId, // sub - empty for unsubscribe tokens
        JWT_TOKEN_TYPES.EMAIL, // type
        JWT_TOKEN_CONFIG.audiences.email, // audience
        {
          email,
          emailTemplateName,
          emailCategory,
        },
      )}`;
  }

  /**
   * Send email using the specified template and configuration
   */
  private async sendEmail(
    userId: string,
    userLang: string,
    dbEmailId: string,
    config: EmailSendConfig,
  ): Promise<EmailSendResult | undefined> {
    return await traced("EmailSenderService.sendEmail", "service", async (span) => {
      span.attributes["template_name"] = config.templateName;
      span.attributes["recipient"] = config.to;
      span.attributes["user_id"] = userId;

      const { templateName, htmlData, to, replyToName = "Moedzee" } = config;

      this.initializeTransports();

      const { subject, emailCategory } = await this.templateService.getEmailMetadata(
        templateName,
        userLang,
      );

      const unsubscribeURL = await this.generateUnsubscribeURL(
        userId,
        config.to,
        config.templateName,
        emailCategory,
      );

      try {
        const template = await this.templateService.getEmailTemplate(
          templateName,
        );

        const projectVars = await this.templateService.getProjectVariables();
        const t = await this.templateService.createTranslationFunction(userLang);

        const templateData: EmailTemplateData = {
          ...htmlData,
          vars: projectVars,
          t,
          unsubscribeURL,
        };

        let html = template(templateData);
        html = this.templateService.rewriteImgSrcToBunny(html);
        const text = htmlToText(html, { wordwrap: 130 });

        span.attributes["environment"] = envConfig.isDevelopment ? "development" : "production";

        if (envConfig.isDevelopment) {
          if (!this.mailer) {
            throw new Error(
              "Mailer transport not initialized for development environment",
            );
          }

          const info = await this.mailer.sendMail({
            from: `${replyToName} <${envConfig.mail.fromEmail}>`,
            to: "it@moedzee.dev",
            subject,
            text,
            html,
          });

          if (info.messageId) {
            await this.statusService.updateEmailStatus({
              status: DB_ENUM_JOB_STATUS.COMPLETED,
              emailId: dbEmailId,
              eventType: "email.sent",
            });

            span.attributes["success"] = true;
            span.attributes["message_id"] = info.messageId;

            return {
              success: true,
            };
          }

          await this.statusService.updateEmailStatus({
            status: DB_ENUM_JOB_STATUS.FAILED,
            emailId: dbEmailId,
            eventType: "email.failed",
          });

          span.attributes["success"] = false;

          return {
            success: false,
          };
        }

        if (!this.resend) {
          throw new Error(
            "Resend client not initialized for production environment",
          );
        }

        const data = await this.resend.emails.send({
          headers: {
            "List-Unsubscribe": unsubscribeURL,
          },
          from: `${replyToName} <${envConfig.mail.fromEmail}>`,
          to: [to],
          replyTo: envConfig.mail.replyToEmail,
          subject: subject,
          html,
          text,
        });

        const emailId = data.data?.id;

        if (emailId) {
          await this.statusService.updateEmailStatus({
            status: DB_ENUM_JOB_STATUS.COMPLETED,
            emailId: dbEmailId,
            eventType: "email.sent",
          }, emailId);

          span.attributes["success"] = true;
          span.attributes["provider_email_id"] = emailId;

          return {
            success: emailId ?? true,
            providerEmailId: emailId,
          };
        }

        await this.statusService.updateEmailStatus({
          status: DB_ENUM_JOB_STATUS.FAILED,
          emailId: dbEmailId,
          eventType: "email.failed",
        }, emailId);

        await useLogger(LoggerLevels.error, {
          message: "Email => Email failed to send",
          messageKey: "email.error.sending",
          section: loggerAppSections.EMAIL,
          details: {
            templateName,
            to,
          },
        });

        span.attributes["success"] = false;

        return {
          success: false,
        };
      } catch (error) {
        await useLogger(LoggerLevels.error, {
          message: "Email => Email failed to send",
          messageKey: "email.error.sending",
          section: loggerAppSections.EMAIL,
          details: {
            templateName,
            to,
          },
          meta: {
            errorName: error instanceof Error ? error.name : "unknown",
            errorMessage: error instanceof Error ? error.message : String(error),
            errorCode: (error as Record<string, unknown>)?.code ?? "N/A",
            errorStack: error instanceof Error ? error.stack?.split("\n").slice(0, 5).join("\n") : "N/A",
            isDev: envConfig.isDevelopment,
            smtpHost: envConfig.isDevelopment ? envConfig.mail.devHost : "production/resend",
          },
          raw: error,
        });
        return;
      }
    });
  }

  private async processEmailQueue() {
    if (this.isProcessing) {
      return;
    }

    this.isProcessing = true;

    try {
      let hasMoreEmails = true;

      while (hasMoreEmails) {
        const batch = await this.db.transaction(async (tx) => {
          // First, mark emails as processing using SELECT FOR UPDATE SKIP LOCKED
          const [emailsToProcess] = await Promise.all([
            tx
              .select()
              .from(globalTables.emails)
              .where(
                and(
                  eq(globalTables.emails.status, DB_ENUM_JOB_STATUS.PENDING),
                ),
              )
              .orderBy(globalTables.emails.createdAt)
              .limit(10),
          ]);

          if (emailsToProcess.length === 0) {
            return [];
          }

          // Mark them as processing
          const emailIds = emailsToProcess.map((email) => email.id);
          await tx
            .update(globalTables.emails)
            .set({
              status: DB_ENUM_JOB_STATUS.PROCESSING,
            })
            .where(inArray(globalTables.emails.id, emailIds));

          return emailsToProcess;
        });

        if (batch.length === 0) {
          hasMoreEmails = false;
          break;
        }

        const promises = batch.map((email) => {
          return this.sendEmail(
            email.userId,
            email.emailLanguage,
            email.id,
            {
              // The DB column is string, but useSendEmail (the only writer)
              // guarantees a registered EmailTemplateName, so this read-boundary
              // cast is type-honest.
              templateName: email.emailTemplate as EmailTemplateName,
              htmlData: email.data as JSON,
              to: email.to,
            },
          );
        });

        const results = await Promise.allSettled(promises);

        // Handle results and log failures
        for (let i = 0; i < results.length; i++) {
          const result = results[i];
          const email = batch[i];

          if (result.status === "rejected") {
            // Log the failure
            await useLogger(LoggerLevels.error, {
              message: `Email => Failed to send email`,
              messageKey: "email.error.send_failed",
              section: loggerAppSections.EMAIL,
              raw: {
                error: result.reason,
                emailId: email.id,
                userId: email.userId,
                to: email.to,
                type: email.type,
              },
            });

            // Optionally update email status to 'failed'
            try {
              await this.db
                .update(globalTables.emails)
                .set({ status: DB_ENUM_JOB_STATUS.FAILED })
                .where(eq(globalTables.emails.id, email.id));
            } catch (updateError) {
              await useLogger(LoggerLevels.error, {
                message: "Email => Failed to update email status to failed",
                messageKey: "email.error.status_update_failed",
                section: loggerAppSections.EMAIL,
                raw: { updateError, emailId: email.id },
              });
            }
          }
        }
      }
    } catch (error) {
      await useLogger(LoggerLevels.error, {
        message: "Email => Error processing email queue",
        messageKey: "email.error.processing",
        section: loggerAppSections.EMAIL,
        raw: error,
      });
    } finally {
      this.isProcessing = false;
    }
  }
  /**
   * Clears all email template caches (L1 in-memory and L2 DenoKV).
   * Call this after updating email template files to avoid serving stale templates.
   */
  public async clearTemplateCache(): Promise<void> {
    await this.templateService.clearTemplateCache();
  }

  public async useSendEmail(
    userId: string,
    to: string,
    data: JSON,
    templateName: EmailTemplateName,
    language: string,
  ): Promise<string> {
    const { emailCategory } = await this.templateService.getEmailMetadata(
      templateName,
      language,
    );

    if (emailCategory === "") {
      throw new Error(`Email ${templateName} not found`);
    }

    const [insertedEmail] = await this.db
      .insert(globalTables.emails)
      .values({
        id: generateIdRandom(32),
        userId: userId,
        to: to,
        status: DB_ENUM_JOB_STATUS.PENDING,
        data: data,
        type: emailCategory.toString(),
        emailTemplate: templateName,
        emailLanguage: language,
      })
      .returning({ id: globalTables.emails.id });

    this.processEmailQueue().catch(console.error);
    return insertedEmail.id;
  }
}
