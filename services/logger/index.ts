/**
 * @file services/logger/index.ts
 * @description Barrel exports for logger services
 */
/**
 * Logger module exports for external services
 *
 * This index provides a clean API for external services to import
 * logger functionality, types, and interfaces.
 */

// Export all types and interfaces
export type { LogContext, LogEntry, LoggerOptions } from "./types.ts";

// Export enums
export { loggerAppSections, LoggerLevels } from "./types.ts";

// Export main logger functions
export { useLogger, useLoggerGenerateLogContext, useLogPerformance, useLogSecurityEvent } from "./logger.ts";

// Export formatter service
export { LogFormatterService, resetLogFormatterSingleton, useLogFormatter } from "./log-formatter.service.ts";

// Export context service
export { createLogContextMiddleware, LogContextService, useLogContext } from "./log-context.service.ts";
