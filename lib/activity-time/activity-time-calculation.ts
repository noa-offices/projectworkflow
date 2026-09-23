export type ActivityTimeInterval = {
  endedAt?: Date | string | null;
  lastActivityAt: Date | string;
  startedAt: Date | string;
};

type ResolvedActivityInterval = {
  end: Date;
  lastActivity: Date;
  start: Date;
};

export type ActivityTimeSummary = {
  activeMinutes: number;
  firstActivityAt: string | null;
  intervalCount: number;
  latestActivityAt: string | null;
};

function validDate(value: Date | string | null | undefined): Date | null {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value ?? "");
  return Number.isNaN(date.getTime()) ? null : date;
}

function validTimeoutMilliseconds(idleTimeoutMinutes: number) {
  return Number.isFinite(idleTimeoutMinutes) && idleTimeoutMinutes > 0
    ? idleTimeoutMinutes * 60_000
    : null;
}

export function effectiveOpenActivityIntervalEnd(
  lastActivityAt: Date | string,
  now: Date | string,
  idleTimeoutMinutes: number,
): Date | null {
  const lastActivity = validDate(lastActivityAt);
  const current = validDate(now);
  const timeout = validTimeoutMilliseconds(idleTimeoutMinutes);
  if (!lastActivity || !current || timeout === null) return null;
  return new Date(Math.min(current.getTime(), lastActivity.getTime() + timeout));
}

function resolveActivityInterval(
  interval: ActivityTimeInterval,
  now: Date | string,
  idleTimeoutMinutes: number,
): ResolvedActivityInterval | null {
  const start = validDate(interval.startedAt);
  const lastActivity = validDate(interval.lastActivityAt);
  if (!start || !lastActivity || lastActivity < start) return null;

  const endedAt = interval.endedAt == null ? null : validDate(interval.endedAt);
  if (interval.endedAt != null && (!endedAt || endedAt < lastActivity)) return null;
  const end = endedAt ?? effectiveOpenActivityIntervalEnd(lastActivity, now, idleTimeoutMinutes);
  if (!end || end < start) return null;
  return { end, lastActivity, start };
}

export function activityIntervalMilliseconds(
  interval: ActivityTimeInterval,
  now: Date | string,
  idleTimeoutMinutes: number,
) {
  const resolved = resolveActivityInterval(interval, now, idleTimeoutMinutes);
  return resolved ? Math.max(0, resolved.end.getTime() - resolved.start.getTime()) : 0;
}

export function mergeActivityTimeIntervals(
  intervals: ActivityTimeInterval[],
  now: Date | string,
  idleTimeoutMinutes: number,
) {
  const resolved = intervals
    .map((interval) => resolveActivityInterval(interval, now, idleTimeoutMinutes))
    .filter((interval): interval is ResolvedActivityInterval => interval !== null)
    .sort((left, right) => left.start.getTime() - right.start.getTime());
  const merged: Array<{ end: Date; start: Date }> = [];

  for (const interval of resolved) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) {
      if (interval.end > previous.end) previous.end = interval.end;
    } else {
      merged.push({ end: interval.end, start: interval.start });
    }
  }

  return merged;
}

export function summarizeActivityTime(
  intervals: ActivityTimeInterval[],
  now: Date | string,
  idleTimeoutMinutes: number,
): ActivityTimeSummary {
  const validIntervals = intervals
    .map((interval) => resolveActivityInterval(interval, now, idleTimeoutMinutes))
    .filter((interval): interval is ResolvedActivityInterval => interval !== null);
  const merged = mergeActivityTimeIntervals(intervals, now, idleTimeoutMinutes);
  const activeMilliseconds = merged.reduce((total, interval) => total + interval.end.getTime() - interval.start.getTime(), 0);
  const firstActivity = validIntervals.reduce<Date | null>((first, interval) => !first || interval.start < first ? interval.start : first, null);
  const latestActivity = validIntervals.reduce<Date | null>((latest, interval) => !latest || interval.lastActivity > latest ? interval.lastActivity : latest, null);

  return {
    activeMinutes: Math.floor(activeMilliseconds / 60_000),
    firstActivityAt: firstActivity?.toISOString() ?? null,
    intervalCount: validIntervals.length,
    latestActivityAt: latestActivity?.toISOString() ?? null,
  };
}

export function activityDateInTimeZone(timestamp: Date | string, timeZone: string): string | null {
  const date = validDate(timestamp);
  if (!date || !timeZone.trim()) return null;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    }).formatToParts(date);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
  } catch {
    return null;
  }
}
