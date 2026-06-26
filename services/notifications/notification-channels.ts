/**
 * @file services/notifications/notification-channels.ts
 * @description Single source of truth for notification-channel parsing/coercion/validation.
 *   Shared by environment-config and user notification preference flows.
 */

/** The three notification channels supported by the system. */
export type NotificationChannel = "email" | "inApp" | "push";

export interface PreferenceInputBase {
  emailEnabled: boolean;
  inAppEnabled: boolean;
  pushEnabled: boolean;
}

const VALID_CHANNELS: ReadonlySet<string> = new Set(["email", "inApp", "push"]);

/** Parse a comma-separated available channels string into a Set of valid channels. */
export function parseAvailableChannels(raw: string): Set<NotificationChannel> {
  const channels = raw
    .split(",")
    .map((value) => value.trim())
    .filter((value): value is NotificationChannel => VALID_CHANNELS.has(value));
  return new Set(channels);
}

/** Coerce input to only allow available channels, silently setting unavailable ones to false. */
export function coerceToAvailableChannels(
  availableChannels: Set<NotificationChannel>,
  input: PreferenceInputBase,
): PreferenceInputBase {
  return {
    emailEnabled: availableChannels.has("email") ? input.emailEnabled : false,
    inAppEnabled: availableChannels.has("inApp") ? input.inAppEnabled : false,
    pushEnabled: availableChannels.has("push") ? input.pushEnabled : false,
  };
}

/** Validate that enabled channels are available for the notification type. */
export function validateEnabledChannels(
  availableChannels: Set<NotificationChannel>,
  input: PreferenceInputBase,
): string[] {
  const invalid: string[] = [];
  if (input.emailEnabled && !availableChannels.has("email")) invalid.push("email");
  if (input.inAppEnabled && !availableChannels.has("inApp")) invalid.push("inApp");
  if (input.pushEnabled && !availableChannels.has("push")) invalid.push("push");
  return invalid;
}
