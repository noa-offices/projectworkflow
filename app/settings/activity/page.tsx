import Link from "next/link";
import type { ReactNode } from "react";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import {
  activityDateInTimeZone,
  effectiveOpenActivityIntervalEnd,
} from "@/lib/activity-time/activity-time-calculation";
import {
  activityWeekStart,
  formatActivityDay,
  formatActivityDuration,
  formatActivityTimestamp,
  resolveActivityPeriod,
  shiftActivityDate,
  type ActivityPeriod,
} from "@/lib/activity-time/activity-time-view";
import { requireSystemOwner } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { saveActivityTrackingSettings } from "./actions";

export const dynamic = "force-dynamic";

const USER_LIMIT = 50;
const INTERVAL_LIMIT = 20;

type ActivityManagementPageProps = {
  searchParams?: Promise<{ message?: string; messageType?: string; period?: string; user?: string }>;
};

type ActivitySettingsRow = {
  activity_idle_timeout_minutes: number;
  organization_timezone: string;
};

type ProfileRow = {
  full_name: string | null;
  id: string;
};

type DailyRow = {
  active_minutes: number;
  activity_date: string;
  first_activity_at: string;
  interval_count: number;
  latest_activity_at: string;
  profile_id: string;
};

type IntervalRow = {
  activity_date: string;
  ended_at: string | null;
  last_activity_at: string;
  started_at: string;
};

type UserSummary = {
  activeMinutes: number;
  firstActivityAt: string | null;
  intervalCount: number;
  latestActivityAt: string | null;
  name: string;
  profileId: string;
};

function Card({ children }: { children: ReactNode }) {
  return <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">{children}</section>;
}

function periodHref(period: ActivityPeriod, userIndex?: number) {
  const params = new URLSearchParams();
  if (period !== "today") params.set("period", period);
  if (userIndex !== undefined) params.set("user", String(userIndex));
  const query = params.toString();
  return `/settings/activity${query ? `?${query}` : ""}`;
}

function validUserIndex(value: string | undefined, profileCount: number) {
  if (!value || !/^\d+$/.test(value)) return null;
  const index = Number(value);
  return Number.isSafeInteger(index) && index >= 0 && index < profileCount ? index : null;
}

function rangeForPeriod(today: string, period: ActivityPeriod) {
  if (period === "yesterday") {
    const yesterday = shiftActivityDate(today, -1) ?? today;
    return { from: yesterday, to: yesterday };
  }
  if (period === "week") return { from: activityWeekStart(today) ?? today, to: today };
  return { from: today, to: today };
}

function formatSummaryTimestamp(timestamp: string | null, timeZone: string) {
  if (!timestamp) return "—";
  const activityDate = activityDateInTimeZone(timestamp, timeZone);
  const time = formatActivityTimestamp(timestamp, timeZone);
  if (!activityDate || !time) return "—";
  return `${formatActivityDay(activityDate, timeZone)}, ${time}`;
}

function summarizeUsers(profiles: ProfileRow[], dailyRows: DailyRow[]): UserSummary[] {
  const dailyByProfile = new Map<string, DailyRow[]>();
  for (const row of dailyRows) {
    const rows = dailyByProfile.get(row.profile_id) ?? [];
    rows.push(row);
    dailyByProfile.set(row.profile_id, rows);
  }

  return profiles.map((profile) => {
    const rows = dailyByProfile.get(profile.id) ?? [];
    return {
      activeMinutes: rows.reduce((total, row) => total + row.active_minutes, 0),
      firstActivityAt: rows.reduce<string | null>((first, row) => !first || row.first_activity_at < first ? row.first_activity_at : first, null),
      intervalCount: rows.reduce((total, row) => total + row.interval_count, 0),
      latestActivityAt: rows.reduce<string | null>((latest, row) => !latest || row.latest_activity_at > latest ? row.latest_activity_at : latest, null),
      name: profile.full_name?.trim() || "Unknown user",
      profileId: profile.id,
    };
  });
}

export default async function ActivityManagementPage({ searchParams }: ActivityManagementPageProps) {
  const { profile, displayName } = await requireSystemOwner();
  const params = (await searchParams) ?? {};
  const period = resolveActivityPeriod(params.period);
  const supabase = await createClient();

  const [{ data: settings }, { count: profileCount, data: profileData, error: profilesError }] = await Promise.all([
    supabase
      .from("projectworkflow_activity_settings")
      .select("organization_timezone,activity_idle_timeout_minutes")
      .eq("id", 1)
      .maybeSingle<ActivitySettingsRow>(),
    supabase
      .from("profiles")
      .select("id,full_name", { count: "exact" })
      .eq("account_status", "active")
      .order("full_name", { ascending: true, nullsFirst: false })
      .limit(USER_LIMIT),
  ]);

  const timeZone = settings?.organization_timezone?.trim() ?? "";
  const now = new Date();
  const today = activityDateInTimeZone(now, timeZone);
  const profiles = (profileData as ProfileRow[] | null) ?? [];

  if (!settings || !today || profilesError) {
    return (
      <ErpAppShell title="ProjectWorkflow Activity" description="Review user active application time." role={profile?.role ?? null} userDisplayName={displayName} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
        <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6 sm:px-8">
          <Link href="/settings" className="text-sm font-semibold text-emerald-900 hover:text-emerald-800">Back to settings</Link>
          <Card><p className="text-sm text-zinc-600">Activity-time reporting is unavailable right now. ProjectWorkflow remains available.</p></Card>
          <Card><p className="text-sm leading-6 text-zinc-600">This shows ProjectWorkflow active application time. It is not verified attendance or total working hours.</p></Card>
        </div>
      </ErpAppShell>
    );
  }

  const range = rangeForPeriod(today, period);
  const profileIds = profiles.map((candidate) => candidate.id);
  const recentCutoff = new Date(now.getTime() - settings.activity_idle_timeout_minutes * 60_000).toISOString();
  const [dailyResult, recentResult] = profileIds.length > 0 ? await Promise.all([
    supabase
      .from("projectworkflow_activity_daily")
      .select("profile_id,activity_date,first_activity_at,latest_activity_at,active_minutes,interval_count")
      .in("profile_id", profileIds)
      .gte("activity_date", range.from)
      .lte("activity_date", range.to)
      .order("activity_date", { ascending: true })
      .limit(USER_LIMIT * 7),
    supabase
      .from("projectworkflow_activity_intervals")
      .select("profile_id,last_activity_at")
      .in("profile_id", profileIds)
      .gte("last_activity_at", recentCutoff)
      .order("last_activity_at", { ascending: false })
      .limit(USER_LIMIT),
  ]) : [{ data: [] }, { data: [] }];

  const dailyRows = (dailyResult.data as DailyRow[] | null) ?? [];
  const recentProfileIds = new Set(((recentResult.data as Array<{ profile_id: string }> | null) ?? []).map((row) => row.profile_id));
  const summaries = summarizeUsers(profiles, dailyRows);
  const selectedIndex = validUserIndex(params.user, profiles.length);
  const selectedSummary = selectedIndex === null ? null : summaries[selectedIndex];
  const selectedDailyRows = selectedSummary
    ? dailyRows.filter((row) => row.profile_id === selectedSummary.profileId)
    : [];
  const { data: selectedIntervalData } = selectedSummary
    ? await supabase
        .from("projectworkflow_activity_intervals")
        .select("activity_date,started_at,last_activity_at,ended_at")
        .eq("profile_id", selectedSummary.profileId)
        .gte("activity_date", range.from)
        .lte("activity_date", range.to)
        .order("started_at", { ascending: false })
        .limit(INTERVAL_LIMIT)
    : { data: [] };
  const selectedIntervals = (selectedIntervalData as IntervalRow[] | null) ?? [];

  return (
    <ErpAppShell title="ProjectWorkflow Activity" description="Review user active application time." role={profile?.role ?? null} userDisplayName={displayName} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
      <div className="mx-auto grid max-w-6xl gap-5 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/settings" className="text-sm font-semibold text-emerald-900 hover:text-emerald-800">Back to settings</Link>
          <div className="flex flex-wrap gap-2" aria-label="Activity period">
            {(["today", "yesterday", "week"] as const).map((value) => (
              <Link key={value} href={periodHref(value, selectedIndex ?? undefined)} className={`rounded-md px-3 py-2 text-sm font-semibold transition ${period === value ? "bg-emerald-900 text-white" : "border border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"}`}>
                {value === "today" ? "Today" : value === "yesterday" ? "Yesterday" : "This Week"}
              </Link>
            ))}
          </div>
        </div>

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><h2 className="text-lg font-semibold text-zinc-950">User summaries</h2><p className="mt-1 text-sm text-zinc-500">Showing {profiles.length} of {profileCount ?? profiles.length} active users (maximum {USER_LIMIT} per view).</p></div>
            <p className="text-xs font-medium text-zinc-500">Timezone: {timeZone}</p>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-left text-sm">
              <thead className="bg-zinc-50 text-xs font-semibold uppercase tracking-[0.12em] text-zinc-500"><tr><th className="px-3 py-2">User</th><th className="px-3 py-2">First activity</th><th className="px-3 py-2">Latest activity</th><th className="px-3 py-2">ProjectWorkflow active time</th><th className="px-3 py-2">Intervals</th><th className="px-3 py-2">Recent activity state</th></tr></thead>
              <tbody className="divide-y divide-zinc-100">
                {summaries.map((summary, index) => (
                  <tr key={summary.profileId} className="text-zinc-700">
                    <td className="px-3 py-3"><Link href={periodHref(period, index)} className="font-semibold text-emerald-900 hover:text-emerald-700">{summary.name}</Link></td>
                    <td className="px-3 py-3">{formatSummaryTimestamp(summary.firstActivityAt, timeZone)}</td>
                    <td className="px-3 py-3">{formatSummaryTimestamp(summary.latestActivityAt, timeZone)}</td>
                    <td className="px-3 py-3 font-semibold text-zinc-950">{formatActivityDuration(summary.activeMinutes)}</td>
                    <td className="px-3 py-3">{summary.intervalCount}</td>
                    <td className="px-3 py-3">{recentProfileIds.has(summary.profileId) ? `Recent ProjectWorkflow activity within the last ${settings.activity_idle_timeout_minutes} minutes` : "No recent activity"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {summaries.length === 0 ? <p className="mt-4 text-sm text-zinc-600">No active users are available.</p> : null}
        </Card>

        {selectedSummary ? (
          <Card>
            <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">User detail</p><h2 className="mt-1 text-lg font-semibold text-zinc-950">{selectedSummary.name}</h2></div><Link href={periodHref(period)} className="text-sm font-semibold text-emerald-900 hover:text-emerald-700">Close detail</Link></div>
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <div><h3 className="text-sm font-semibold text-zinc-950">Daily summaries</h3>{selectedDailyRows.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No ProjectWorkflow activity was recorded in this period.</p> : <div className="mt-2 divide-y divide-zinc-100">{selectedDailyRows.map((row) => <div key={row.activity_date} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"><div><p className="font-medium text-zinc-800">{formatActivityDay(row.activity_date, timeZone)}</p><p className="mt-1 text-xs text-zinc-500">{formatActivityTimestamp(row.first_activity_at, timeZone) ?? "—"} – {formatActivityTimestamp(row.latest_activity_at, timeZone) ?? "—"} · {row.interval_count} intervals</p></div><p className="font-semibold text-zinc-950">{formatActivityDuration(row.active_minutes)}</p></div>)}</div>}</div>
              <div><h3 className="text-sm font-semibold text-zinc-950">Interval detail</h3>{selectedIntervals.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No intervals are available for this period.</p> : <div className="mt-2 divide-y divide-zinc-100">{selectedIntervals.map((interval, index) => { const end = interval.ended_at ?? effectiveOpenActivityIntervalEnd(interval.last_activity_at, now, settings.activity_idle_timeout_minutes)?.toISOString() ?? null; return <div key={`${interval.started_at}-${index}`} className="py-3 text-sm text-zinc-700"><p className="font-medium">{formatActivityDay(interval.activity_date, timeZone)}</p><p className="mt-1 text-xs text-zinc-500">{formatActivityTimestamp(interval.started_at, timeZone) ?? "—"} – {formatActivityTimestamp(end, timeZone) ?? "—"}{interval.ended_at === null ? " (capped at idle boundary)" : ""}</p></div>; })}</div>}</div>
            </div>
          </Card>
        ) : null}

        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">Activity Tracking Settings</h2>
              <p className="mt-1 text-sm text-zinc-500">Configure how ProjectWorkflow records active application time.</p>
            </div>
            {params.message ? (
              <p className={`rounded-md border px-3 py-2 text-sm ${params.messageType === "error" ? "border-red-200 bg-red-50 text-red-900" : "border-emerald-200 bg-emerald-50 text-emerald-950"}`}>
                {params.message}
              </p>
            ) : null}
          </div>
          <form action={saveActivityTrackingSettings} className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Organization timezone</span>
              <input name="organization_timezone" defaultValue={settings.organization_timezone} required className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10" />
              <span className="text-xs text-zinc-500">Use a valid IANA timezone, such as Asia/Dubai.</span>
            </label>
            <label className="grid gap-1.5">
              <span className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Idle timeout</span>
              <select name="activity_idle_timeout_minutes" defaultValue={String(settings.activity_idle_timeout_minutes)} className="h-10 rounded-md border border-zinc-200 bg-white px-3 text-sm text-zinc-900 outline-none focus:border-emerald-800 focus:ring-2 focus:ring-emerald-900/10">
                {[5, 10, 15, 20, 30, 45, 60].map((minutes) => <option key={minutes} value={minutes}>{minutes} minutes</option>)}
              </select>
              <span className="text-xs text-zinc-500">Controls how long an interaction interval may count after the latest recorded activity.</span>
            </label>
            <div className="sm:col-span-2"><button type="submit" className="rounded-md bg-emerald-900 px-4 py-2 text-sm font-semibold text-white transition hover:bg-emerald-800">Save activity tracking settings</button></div>
          </form>
        </Card>

        <Card><p className="text-sm leading-6 text-zinc-600">This shows ProjectWorkflow active application time. It is not verified attendance or total working hours.</p></Card>
      </div>
    </ErpAppShell>
  );
}
