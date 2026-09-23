export type ActivityPeriod = "today" | "yesterday" | "week";

function parseActivityDate(activityDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(activityDate)) return null;
  const date = new Date(`${activityDate}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function formatActivityDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function shiftActivityDate(activityDate: string, days: number) {
  const date = parseActivityDate(activityDate);
  if (!date || !Number.isInteger(days)) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return formatActivityDate(date);
}

export function activityWeekStart(activityDate: string) {
  const date = parseActivityDate(activityDate);
  if (!date) return null;
  const mondayOffset = (date.getUTCDay() + 6) % 7;
  return shiftActivityDate(activityDate, -mondayOffset);
}

export function resolveActivityPeriod(value: string | undefined): ActivityPeriod {
  return value === "yesterday" || value === "week" ? value : "today";
}

export function formatActivityDuration(activeMinutes: number) {
  const minutes = Number.isFinite(activeMinutes) ? Math.max(0, Math.floor(activeMinutes)) : 0;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  if (hours === 0) return `${remainder}m`;
  return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
}

export function formatActivityTimestamp(timestamp: string | null, timeZone: string) {
  if (!timestamp || !timeZone.trim()) return null;
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
}

export function formatActivityDay(activityDate: string, timeZone: string) {
  const date = parseActivityDate(activityDate);
  if (!date || !timeZone.trim()) return activityDate;
  try {
    return new Intl.DateTimeFormat("en-US", {
      day: "numeric",
      month: "short",
      timeZone,
      weekday: "short",
    }).format(new Date(`${activityDate}T12:00:00.000Z`));
  } catch {
    return activityDate;
  }
}
