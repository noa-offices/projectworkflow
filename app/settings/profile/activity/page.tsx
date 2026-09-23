import Link from "next/link";
import { ErpAppShell } from "@/components/layout/erp-app-shell";
import {
  effectiveOpenActivityIntervalEnd,
  summarizeActivityTime,
  activityDateInTimeZone,
} from "@/lib/activity-time/activity-time-calculation";
import {
  activityWeekStart,
  formatActivityDay,
  formatActivityDuration,
  formatActivityTimestamp,
  resolveActivityPeriod,
  shiftActivityDate,
} from "@/lib/activity-time/activity-time-view";
import { requireActiveUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ActivityPageProps = {
  searchParams?: Promise<{ period?: string }>;
};

type ActivitySettingsRow = {
  activity_idle_timeout_minutes: number;
  organization_timezone: string;
};

type ActivityIntervalRow = {
  activity_date: string;
  ended_at: string | null;
  last_activity_at: string;
  started_at: string;
};

type ActivityDailyRow = {
  active_minutes: number;
  activity_date: string;
  interval_count: number;
};

function ActivityCard({ children }: { children: React.ReactNode }) {
  return <section className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">{children}</section>;
}

function PeriodLink({ active, children, href }: { active: boolean; children: React.ReactNode; href: string }) {
  return (
    <Link
      href={href}
      className={`rounded-md px-3 py-2 text-sm font-semibold transition ${
        active ? "bg-emerald-900 text-white" : "border border-zinc-200 text-zinc-700 hover:bg-zinc-50"
      }`}
    >
      {children}
    </Link>
  );
}

export default async function ProjectWorkflowActivityPage({ searchParams }: ActivityPageProps) {
  const { user, profile, displayName } = await requireActiveUser();
  const period = resolveActivityPeriod((await searchParams)?.period);
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("projectworkflow_activity_settings")
    .select("organization_timezone,activity_idle_timeout_minutes")
    .eq("id", 1)
    .maybeSingle<ActivitySettingsRow>();

  const timeZone = settings?.organization_timezone?.trim() ?? "";
  const now = new Date();
  const today = activityDateInTimeZone(now, timeZone);

  if (!settings || !today) {
    return (
      <ErpAppShell title="ProjectWorkflow Activity" description="Review your own active application time." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
        <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6 sm:px-8">
          <Link href="/settings/profile" className="text-sm font-semibold text-emerald-900 hover:text-emerald-800">Back to My Profile</Link>
          <ActivityCard>
            <h2 className="text-lg font-semibold text-zinc-950">ProjectWorkflow Activity</h2>
            <p className="mt-2 text-sm text-zinc-600">Activity time settings are unavailable right now. ProjectWorkflow remains available.</p>
          </ActivityCard>
          <ActivityCard>
            <p className="text-sm leading-6 text-zinc-600">ProjectWorkflow records active application time automatically while you actively use the app. This measures ProjectWorkflow activity only and is not attendance or total working hours.</p>
          </ActivityCard>
        </div>
      </ErpAppShell>
    );
  }

  const yesterday = shiftActivityDate(today, -1);
  const weekStart = activityWeekStart(today);
  const [intervalsResult, dailyResult] = await Promise.all([
    supabase
      .from("projectworkflow_activity_intervals")
      .select("activity_date,started_at,last_activity_at,ended_at")
      .eq("profile_id", user.id)
      .eq("activity_date", today)
      .order("started_at", { ascending: true }),
    supabase
      .from("projectworkflow_activity_daily")
      .select("activity_date,active_minutes,interval_count")
      .eq("profile_id", user.id)
      .gte("activity_date", weekStart ?? today)
      .lte("activity_date", today)
      .order("activity_date", { ascending: true }),
  ]);

  const intervals = (intervalsResult.data as ActivityIntervalRow[] | null) ?? [];
  const displayIntervals = intervals.slice(0, 20);
  const dailyRows = (dailyResult.data as ActivityDailyRow[] | null) ?? [];
  const todaySummary = summarizeActivityTime(intervals.map((interval) => ({
    endedAt: interval.ended_at,
    lastActivityAt: interval.last_activity_at,
    startedAt: interval.started_at,
  })), now, settings.activity_idle_timeout_minutes);
  const latestActivity = todaySummary.latestActivityAt;
  const latestActivityTime = latestActivity ? new Date(latestActivity).getTime() : Number.NaN;
  const isRecent = Number.isFinite(latestActivityTime)
    && now.getTime() <= latestActivityTime + settings.activity_idle_timeout_minutes * 60_000;
  const dailyByDate = new Map(dailyRows.map((row) => [row.activity_date, row]));
  const selectedDay = period === "yesterday" ? yesterday : today;
  const selectedTotal = period === "today"
    ? todaySummary.activeMinutes
    : selectedDay ? dailyByDate.get(selectedDay)?.active_minutes ?? 0 : 0;
  const weekTotal = dailyRows.reduce((total, row) => total + row.active_minutes, 0);

  return (
    <ErpAppShell title="ProjectWorkflow Activity" description="Review your own active application time." role={profile?.role ?? null} userDisplayName={displayName} userEmail={user.email} userAvatarUrl={profile?.avatar_url ?? null} userRole={profile?.role ?? null}>
      <div className="mx-auto grid max-w-4xl gap-5 px-5 py-6 sm:px-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Link href="/settings/profile" className="text-sm font-semibold text-emerald-900 hover:text-emerald-800">Back to My Profile</Link>
          <div className="flex flex-wrap gap-2" aria-label="Activity period">
            <PeriodLink href="/settings/profile/activity" active={period === "today"}>Today</PeriodLink>
            <PeriodLink href="/settings/profile/activity?period=yesterday" active={period === "yesterday"}>Yesterday</PeriodLink>
            <PeriodLink href="/settings/profile/activity?period=week" active={period === "week"}>This Week</PeriodLink>
          </div>
        </div>

        <ActivityCard>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-zinc-500">Today</p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-950">ProjectWorkflow Activity</h2>
            </div>
            <p className="text-sm font-semibold text-emerald-900">ProjectWorkflow active time: {formatActivityDuration(todaySummary.activeMinutes)}</p>
          </div>
          {todaySummary.intervalCount === 0 ? (
            <p className="mt-5 text-sm text-zinc-600">No ProjectWorkflow activity has been recorded for you today.</p>
          ) : (
            <dl className="mt-5 grid gap-4 sm:grid-cols-3">
              <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">First activity</dt><dd className="mt-1 text-sm font-medium text-zinc-950">{formatActivityTimestamp(todaySummary.firstActivityAt, timeZone) ?? "—"}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Latest activity</dt><dd className="mt-1 text-sm font-medium text-zinc-950">{formatActivityTimestamp(todaySummary.latestActivityAt, timeZone) ?? "—"}</dd></div>
              <div><dt className="text-xs font-semibold uppercase tracking-[0.14em] text-zinc-500">Intervals</dt><dd className="mt-1 text-sm font-medium text-zinc-950">{todaySummary.intervalCount}</dd></div>
            </dl>
          )}
          <p className="mt-5 rounded-md bg-zinc-50 px-3 py-2 text-sm text-zinc-600">
            {isRecent ? `Recent ProjectWorkflow activity within the last ${settings.activity_idle_timeout_minutes} minutes.` : "No recent ProjectWorkflow activity."}
          </p>
        </ActivityCard>

        <ActivityCard>
          <h2 className="text-base font-semibold text-zinc-950">{period === "week" ? "This Week" : period === "yesterday" ? "Yesterday" : "Today"}</h2>
          {period === "week" ? (
            dailyRows.length === 0 ? <p className="mt-3 text-sm text-zinc-600">No ProjectWorkflow activity has been recorded for you this week.</p> : (
              <div className="mt-3 divide-y divide-zinc-100">
                {dailyRows.map((row) => <div key={row.activity_date} className="flex justify-between gap-4 py-3 text-sm"><span className="text-zinc-700">{formatActivityDay(row.activity_date, timeZone)}</span><span className="font-semibold text-zinc-950">{formatActivityDuration(row.active_minutes)}</span></div>)}
                <div className="flex justify-between gap-4 pt-3 text-sm font-semibold text-zinc-950"><span>Total ProjectWorkflow active time</span><span>{formatActivityDuration(weekTotal)}</span></div>
              </div>
            )
          ) : (
            <p className="mt-3 text-sm text-zinc-700">ProjectWorkflow active time: <span className="font-semibold text-zinc-950">{formatActivityDuration(selectedTotal)}</span></p>
          )}
        </ActivityCard>

        {displayIntervals.length > 0 ? (
          <ActivityCard>
            <h2 className="text-base font-semibold text-zinc-950">Today&apos;s intervals</h2>
            <div className="mt-3 divide-y divide-zinc-100">
              {displayIntervals.map((interval, index) => {
                const effectiveEnd = interval.ended_at ?? effectiveOpenActivityIntervalEnd(interval.last_activity_at, now, settings.activity_idle_timeout_minutes)?.toISOString() ?? null;
                return <p key={`${interval.started_at}-${index}`} className="py-3 text-sm text-zinc-700">{formatActivityTimestamp(interval.started_at, timeZone) ?? "—"} – {formatActivityTimestamp(effectiveEnd, timeZone) ?? "—"}{interval.ended_at === null ? " (open interval capped at idle boundary)" : ""}</p>;
              })}
            </div>
          </ActivityCard>
        ) : null}

        <ActivityCard>
          <p className="text-sm leading-6 text-zinc-600">ProjectWorkflow records active application time automatically while you actively use the app. This measures ProjectWorkflow activity only and is not attendance or total working hours.</p>
        </ActivityCard>
      </div>
    </ErpAppShell>
  );
}
