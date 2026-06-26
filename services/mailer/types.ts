/**
 * @file services/mailer/types.ts
 * @description Shared types for mailer services
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
  getKeys(): Promise<string[]>;
  getItem<T = string>(key: string): Promise<T | null>;
}

/**
 * Email template compilation options
 */
export interface EmailTemplateOptions {
  includer?: (originalPath: string) => { template: string };
}

// NOTE: EmailSendConfig lives in @interfaces/email.ts (the canonical, tightened
// definition with templateName: EmailTemplateName) and is re-exported via the
// mailer barrel. Do not re-declare it here — a loose `string` duplicate would
// silently bypass the useSendEmail intellisense contract.

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
  unsubscribeURL?: string;
}

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

export enum EmailCategories {
  FORGET_PASSWORD = "FORGET_PASSWORD",
  SIGN_UP = "sign-up",
  MAGIC = "MAGIC",
}
