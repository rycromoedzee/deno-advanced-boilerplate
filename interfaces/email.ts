/**
 * @file interfaces/email.ts
 * @description Email provider interfaces and types
 * These interfaces define the structure for email operations and configuration
 */

import { TemplateFunction } from "@deps";

/**
 * Configuration for email template storage
 */
export interface EmailTemplateStorageConfig {
  basePath?: string;
}

/**
 * Interface for email template storage operations
 */
export interface IEmailTemplateStorage {
  /**
   * Get all available template keys
   * @returns Array of template keys
   */
  getKeys(): Promise<string[]>;

  /**
   * Get template item by key
   * @param key Template key
   * @returns Template content or null
   */
  getItem<T = string>(key: string): Promise<T | null>;
}

/**
 * Email template compilation options
 */
export interface EmailTemplateOptions {
  includer?: (originalPath: string) => { template: string };
}

/**
 * Email sending configuration
 */
export interface EmailSendConfig {
  templateName: EmailTemplateName;
  htmlData: JSON;
  to: string;
  replyToName?: string;
}

/**
 * Email sending result
 */
export interface EmailSendResult {
  success: boolean | string;
  providerEmailId?: string;
}

/**
 * Email transport configuration
 */
export interface EmailTransportConfig {
  host: string;
  port: number;
  secure: boolean;
}

/**
 * Cached template function type
 */
export type CachedTemplateFunction = TemplateFunction;

/**
 * Include lookup cache type
 */
export type IncludeLookup = Record<string, string>;

/**
 * Email template data with unsubscribe URL
 */
export interface EmailTemplateData extends Record<string, unknown> {
  vars?: Record<string, string>;
  t?: TranslationFunction;
  unsubscribeURL?: string;
}

/**
 * Nested locale data structure (supports dot-path keys like "reset.reset-password")
 */
export type LocaleData = Record<string, unknown>;

/**
 * Locales configuration from _locales.json
 */
export interface LocalesConfig {
  defaultLocale: string;
  locales: string[];
  activePreviewLocale: string;
}

/**
 * Translation helper function type
 */
export type TranslationFunction = (key: string) => string;

/**
 * Webhook security validation result
 */
export interface WebhookValidationResult {
  isValid: boolean;
  error?: string;
}

/**
 * Webhook token configuration
 */
export interface WebhookTokenConfig {
  token: string;
  isValid: boolean;
}

/**
 * Resend webhook payload structure
 */
export interface ResendWebhookPayload {
  type:
    | "email.sent"
    | "email.opened"
    | "email.delivered"
    | "email.bounced"
    | "email.complained"
    | "email.delivery_delayed";
  created_at: string;
  data: {
    email_id: string;
    to: string;
    subject: string;
    from: string;
    reply_to?: string;
    bounce?: {
      type: string;
      message: string;
    };
    complaint?: {
      type: string;
      message: string;
    };
    [key: string]: unknown;
  };
}

/**
 * Email status update data
 */
export interface EmailStatusUpdate {
  emailId: string;
  status: string;
  eventType: string;
  last_event?: string;
}

/**
 * Valid Resend event types
 */
export const RESEND_VALID_EVENT_TYPES = [
  "email.sent",
  "email.delivered",
  "email.bounced",
  "email.complained",
  "email.delivery_delayed",
];

/**
 * Email type configurations.
 *
 * `as const` enables the derived {@link EmailTemplateName} union (compile-time
 * intellisense for useSendEmail's templateName), mirroring how throwHttpError's
 * errorKey is typed as AllErrorKeys (keyof-typeof → union). Each entry's `name`
 * MUST match an EJS file in static/mail/views/<name>.ejs.
 */
export const EMAIL_TYPES = [
  {
    name: "sign-up",
    subjectKey: "sign-up.subject",
    category: "AUTH",
  },
  {
    name: "password-reset",
    subjectKey: "password-reset.subject",
    category: "AUTH",
  },
  {
    name: "magic-link",
    subjectKey: "magic-link.subject",
    category: "AUTH",
  },
] as const;

/**
 * The set of registered email template names. Add a new template by extending
 * EMAIL_TYPES above; this union (and every useSendEmail call site's
 * intellisense) updates automatically.
 */
export type EmailTemplateName = (typeof EMAIL_TYPES)[number]["name"];

/**
 * Resend webhook IP addresses for validation
 */
export const RESEND_IP_LIST = [
  "44.228.126.217",
  "50.112.21.217",
  "52.24.126.164",
  "54.148.139.208",
  "2600:1f24:64:8000::/52",
];
