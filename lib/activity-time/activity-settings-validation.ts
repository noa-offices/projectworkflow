export type ActivityTrackingSettingsInput = {
  idleTimeoutMinutes: number;
  organizationTimeZone: string;
};

export type ActivityTrackingSettingsValidation =
  | { ok: true; value: ActivityTrackingSettingsInput }
  | { message: string; ok: false };

export function isValidActivityTimeZone(value: string) {
  const timeZone = value.trim();
  if (!timeZone) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format();
    return true;
  } catch {
    return false;
  }
}

export function validateActivityTrackingSettings(
  organizationTimeZone: string,
  idleTimeoutValue: string,
): ActivityTrackingSettingsValidation {
  const timeZone = organizationTimeZone.trim();
  if (!isValidActivityTimeZone(timeZone)) return { message: "Choose a valid timezone.", ok: false };
  if (!/^\d+$/.test(idleTimeoutValue.trim())) return { message: "Idle timeout must be between 5 and 60 minutes.", ok: false };
  const idleTimeoutMinutes = Number(idleTimeoutValue);
  if (!Number.isSafeInteger(idleTimeoutMinutes) || idleTimeoutMinutes < 5 || idleTimeoutMinutes > 60) {
    return { message: "Idle timeout must be between 5 and 60 minutes.", ok: false };
  }
  return { ok: true, value: { idleTimeoutMinutes, organizationTimeZone: timeZone } };
}
