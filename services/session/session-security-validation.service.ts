/**
 * @file services/session/session-security-validation.service.ts
 * @description Shared security event logging utility for session services
 */
import { loggerAppSections, LoggerLevels, useLogger } from "@logger/index.ts";

/**
 * Synchronous fallback logger for when the async useLogger fails.
 * Outputs to stderr in a structured JSON format that can be captured by log aggregators.
 */
function logSecurityEventFallback(
  sessionServiceName: string,
  severity: string,
  eventName: string,
  meta: Record<string, unknown>,
  loggerError: unknown,
): void {
  // Use JSON.stringify for structured output that log aggregators can parse
  // Writing to stderr is synchronous and won't fail if the async logger is broken
  const fallbackEntry = JSON.stringify({
    timestamp: new Date().toISOString(),
    level: "error",
    type: "security_event_fallback",
    component: sessionServiceName,
    severity,
    eventName,
    meta,
    loggerError: loggerError instanceof Error ? loggerError.message : "Unknown error",
  });
  console.error(fallbackEntry);
}

/**
 * Logs security events related to session management
 * @param logLevel - The log level to use
 * @param sessionServiceName - The name of the service logging the event
 * @param severity - The severity of the event (low, medium, high, critical)
 * @param eventName - The name of the security event
 * @param meta - Additional metadata about the event
 */
export async function useSessionLogSecurityEvent(
  logLevel: LoggerLevels,
  sessionServiceName: string,
  severity: string,
  eventName: string,
  meta: Record<string, unknown>,
): Promise<void> {
  try {
    await useLogger(logLevel, {
      message: `Session security event: ${eventName}`,
      section: loggerAppSections.AUTH,
      messageKey: `SESSION_${eventName}`,
      details: {
        eventName,
        timestamp: new Date().toISOString(),
        ...meta,
      },
      meta: {
        component: sessionServiceName,
        severity,
      },
    });
  } catch (error) {
    // Fallback to synchronous JSON-structured stderr output
    // This ensures security events are never silently lost even if the async logger fails
    logSecurityEventFallback(sessionServiceName, severity, eventName, meta, error);
  }
}
