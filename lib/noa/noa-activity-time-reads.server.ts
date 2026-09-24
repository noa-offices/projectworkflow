import "server-only";

import {
  activityDateInTimeZone,
  activityIntervalMilliseconds,
  effectiveOpenActivityIntervalEnd,
} from "@/lib/activity-time/activity-time-calculation";
import {
  activityWeekStart,
  formatActivityDuration,
  formatActivityTimestamp,
  shiftActivityDate,
} from "@/lib/activity-time/activity-time-view";
import { createClient } from "@/lib/supabase/server";

const MAX_ACTIVITY_TIME_USERS = 20;
const MAX_ACTIVITY_TIME_INTERVALS = 20;

type SettingsRow = { activity_idle_timeout_minutes: number; organization_timezone: string };
type DailyRow = { active_minutes: number; activity_date: string; first_activity_at: string; interval_count: number; latest_activity_at: string; profile_id: string };
type IntervalRow = { ended_at: string | null; last_activity_at: string; started_at: string };
type ProfileRow = { full_name: string | null; id: string };

type ActivityTimePeriod = "today" | "yesterday" | "week";

function periodFor(message: string): ActivityTimePeriod {
  const normalized = message.toLowerCase();
  if (/\byesterday\b/.test(normalized)) return "yesterday";
  return /\bthis week\b/.test(normalized) ? "week" : "today";
}

function rangeFor(today: string, period: ActivityTimePeriod) {
  if (period === "yesterday") {
    const yesterday = shiftActivityDate(today, -1) ?? today;
    return { from: yesterday, label: "yesterday", to: yesterday };
  }
  if (period === "week") return { from: activityWeekStart(today) ?? today, label: "this week", to: today };
  return { from: today, label: "today", to: today };
}

function formatTime(value: string | null, timeZone: string) {
  return formatActivityTimestamp(value, timeZone) ?? "an unavailable time";
}

async function configuration(supabase: Awaited<ReturnType<typeof createClient>>) {
  const { data } = await supabase.from("projectworkflow_activity_settings")
    .select("organization_timezone,activity_idle_timeout_minutes").eq("id", 1).maybeSingle<SettingsRow>();
  const today = data ? activityDateInTimeZone(new Date(), data.organization_timezone) : null;
  return data && today ? { settings: data, today } : null;
}

export async function readActivityTimeForUser(
  supabase: Awaited<ReturnType<typeof createClient>>,
  profileId: string,
  message: string,
  options: { attendanceBoundary?: boolean; intervals?: boolean; recent?: boolean } = {},
) {
  const configured = await configuration(supabase);
  if (!configured) return { deterministicText: "ProjectWorkflow activity-time settings are unavailable right now.", kind: "activity_time_unavailable" };
  const { settings, today } = configured;
  const period = periodFor(message);
  const range = rangeFor(today, period);
  const { data: dailyData } = await supabase.from("projectworkflow_activity_daily")
    .select("profile_id,activity_date,first_activity_at,latest_activity_at,active_minutes,interval_count")
    .eq("profile_id", profileId).gte("activity_date", range.from).lte("activity_date", range.to)
    .order("activity_date", { ascending: true }).returns<DailyRow[]>();
  const dailyRows = dailyData ?? [];
  const todayRow = dailyRows.find((row) => row.activity_date === today);
  const { data: openData } = await supabase.from("projectworkflow_activity_intervals")
    .select("started_at,last_activity_at,ended_at").eq("profile_id", profileId).eq("activity_date", today)
    .is("ended_at", null).limit(1).returns<IntervalRow[]>();
  const openInterval = (openData ?? [])[0] ?? null;
  const openExtraMinutes = openInterval && todayRow
    ? Math.floor((effectiveOpenActivityIntervalEnd(openInterval.last_activity_at, new Date(), settings.activity_idle_timeout_minutes)?.getTime() ?? new Date(openInterval.last_activity_at).getTime()) / 60_000) - Math.floor(new Date(openInterval.last_activity_at).getTime() / 60_000)
    : 0;
  const activeMinutes = dailyRows.reduce((total, row) => total + row.active_minutes, 0) + Math.max(0, openExtraMinutes);
  const first = dailyRows[0]?.first_activity_at ?? null;
  const latest = dailyRows.at(-1)?.latest_activity_at ?? null;
  const intervalCount = dailyRows.reduce((total, row) => total + row.interval_count, 0);
  const recent = latest ? new Date().getTime() <= new Date(latest).getTime() + settings.activity_idle_timeout_minutes * 60_000 : false;
  const subject = "You";
  let deterministicText = intervalCount === 0
    ? `${subject} have no recorded ProjectWorkflow activity ${range.label}.`
    : `${subject} have ${formatActivityDuration(activeMinutes)} of ProjectWorkflow active time ${range.label} across ${intervalCount} activity interval${intervalCount === 1 ? "" : "s"}.`;
  if (/\bfirst (?:recorded |projectworkflow )?activity\b/i.test(message) && first) deterministicText = `Your first recorded ProjectWorkflow activity ${range.label} was at ${formatTime(first, settings.organization_timezone)}.`;
  if (/\b(?:latest|last) activity\b/i.test(message) && latest) deterministicText = `Your latest ProjectWorkflow activity was at ${formatTime(latest, settings.organization_timezone)}.`;
  if (options.recent) deterministicText = recent ? `You have recent ProjectWorkflow activity within the last ${settings.activity_idle_timeout_minutes} minutes.` : `You don't have recent ProjectWorkflow activity within the last ${settings.activity_idle_timeout_minutes} minutes.`;
  if (/\b(?:how many|count)\b[^?]*\b(?:activity|active)?\s*intervals?\b|\bmy interval count\b/i.test(message)) {
    deterministicText = `You have ${intervalCount} ProjectWorkflow activity interval${intervalCount === 1 ? "" : "s"} ${range.label}.`;
  }
  if (options.intervals) {
    const { data: intervalsData } = await supabase.from("projectworkflow_activity_intervals")
      .select("started_at,last_activity_at,ended_at").eq("profile_id", profileId).gte("activity_date", range.from).lte("activity_date", range.to)
      .order("started_at", { ascending: true }).limit(MAX_ACTIVITY_TIME_INTERVALS).returns<IntervalRow[]>();
    const intervals = intervalsData ?? [];
    deterministicText = intervals.length === 0 ? `You have no recorded ProjectWorkflow activity intervals ${range.label}.` : `${subject} have ${intervals.length} ProjectWorkflow activity interval${intervals.length === 1 ? "" : "s"} ${range.label}: ${intervals.map((row) => `${formatTime(row.started_at, settings.organization_timezone)}–${formatTime(row.ended_at ?? effectiveOpenActivityIntervalEnd(row.last_activity_at, new Date(), settings.activity_idle_timeout_minutes)?.toISOString() ?? null, settings.organization_timezone)} (${formatActivityDuration(Math.floor(activityIntervalMilliseconds({ endedAt: row.ended_at, lastActivityAt: row.last_activity_at, startedAt: row.started_at }, new Date(), settings.activity_idle_timeout_minutes) / 60_000))})`).join("; ")}.`;
  }
  if (options.attendanceBoundary) {
    deterministicText = `ProjectWorkflow recorded ${formatActivityDuration(activeMinutes)} of active application time for you ${range.label}. This is ProjectWorkflow activity time, not verified attendance or your total working hours.`;
  }
  return { activeMinutes, deterministicText, firstActivityAt: first, intervalCount, kind: "activity_time", latestActivityAt: latest, period, recent };
}

export async function resolveActivityTimeProfile(supabase: Awaited<ReturnType<typeof createClient>>, name: string) {
  const safeName = name.replace(/[%_,().?!]/g, " ").trim();
  const { data } = await supabase.from("profiles").select("id,full_name").ilike("full_name", `%${safeName}%`).limit(2).returns<ProfileRow[]>();
  if (!data?.length) return { kind: "not_found" as const };
  if (data.length > 1) return { kind: "ambiguous" as const };
  return { fullName: data[0].full_name?.trim() || name, id: data[0].id, kind: "found" as const };
}

// C2: `forceRecent` lets a caller that already knows (via the C1 semantic layer) that a message
// means "recent_presence" force the idle-window interpretation even when the raw text has none of
// the literal trigger words below (e.g. "who online"/"anyone using projectworkflow now") - the
// underlying query/wording logic itself is unchanged, this only decides which of the two existing
// branches (idle-window vs. today-listing) runs.
export async function readRecentActivityTimeUsers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  message: string,
  options: { forceRecent?: boolean } = {},
) {
  const configured = await configuration(supabase);
  if (!configured) return { deterministicText: "ProjectWorkflow activity-time settings are unavailable right now.", kind: "activity_time_unavailable" };
  const isRecent = options.forceRecent || /\brecent\b|\bworking now\b/i.test(message);
  const cutoff = new Date(Date.now() - configured.settings.activity_idle_timeout_minutes * 60_000).toISOString();
  const baseQuery = supabase.from("projectworkflow_activity_daily").select("profile_id,latest_activity_at", { count: "exact" })
    .order("latest_activity_at", { ascending: false }).limit(MAX_ACTIVITY_TIME_USERS);
  const { count, data } = isRecent
    ? await baseQuery.gte("latest_activity_at", cutoff)
    : await baseQuery.eq("activity_date", configured.today);
  const rows = (data ?? []) as Array<{ latest_activity_at: string; profile_id: string }>;
  const ids = rows.map((row) => row.profile_id);
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("id,full_name").in("id", ids).returns<ProfileRow[]>() : { data: [] };
  const names = new Map((profiles ?? []).map((row) => [row.id, row.full_name?.trim() || "Unknown user"]));
  const total = count ?? rows.length;
  const description = isRecent
    ? `recent ProjectWorkflow activity within the last ${configured.settings.activity_idle_timeout_minutes} minutes`
    : "recorded ProjectWorkflow activity today";
  // Product semantics (PART 7): "who is online"-style questions are deliberately answered as
  // recent ProjectWorkflow interaction, never a presence/attendance claim - this qualifier makes
  // that explicit every time the idle-window branch is used, regardless of how it was triggered.
  const presenceNote = isRecent ? " This reflects recent ProjectWorkflow interaction, not verified attendance." : "";
  return { deterministicText: total === 0 ? `No users have ${description}.` : `${total} user${total === 1 ? " has" : "s have"} ${description}.${total > rows.length ? ` Showing ${rows.length}.` : ""} ${rows.map((row) => names.get(row.profile_id) ?? "Unknown user").join(", ")}.${presenceNote}`, kind: "activity_time_recent_users", returnedUserCount: rows.length, totalUserCount: total };
}
