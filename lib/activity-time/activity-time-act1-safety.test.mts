import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/108_projectworkflow_activity_time.sql", "utf8");
const helper = readFileSync("lib/activity-time/activity-time-calculation.ts", "utf8");

test("ACT-1 activity-time schema keeps privacy, bounded settings, and no direct mutations", () => {
  for (const table of ["projectworkflow_activity_settings", "projectworkflow_activity_intervals", "projectworkflow_activity_daily"]) {
    assert.ok(migration.includes(`alter table public.${table} enable row level security`));
  }
  assert.ok(migration.includes("profile_id = auth.uid() and public.current_user_is_active()"));
  assert.ok(migration.includes("public.current_user_role() = 'system_owner'"));
  assert.ok(!migration.includes("admin_manager"));
  assert.ok(migration.includes("activity_idle_timeout_minutes between 5 and 60"));
  assert.ok(migration.includes("projectworkflow_activity_one_open_interval_per_profile_idx"));
  assert.ok(migration.includes("where ended_at is null"));
  assert.ok(migration.includes("references public.profiles(id) on delete restrict"));
  assert.ok(migration.includes("grant select on public.projectworkflow_activity_intervals to authenticated"));
  assert.ok(migration.includes("grant select on public.projectworkflow_activity_daily to authenticated"));
  assert.ok(!migration.includes("grant insert") && !migration.includes("grant delete"));
  assert.doesNotMatch(
    migration,
    /grant\s+[^;]*(?:insert|update|delete)[^;]*\s+on public\.projectworkflow_activity_(?:intervals|daily)/i,
  );
  assert.ok(!/worker_id|audit_activity_log|service_role|attendance|worked_hours/i.test(migration));
});

test("ACT-1 helpers are pure activity-time calculations with native timezone support", () => {
  assert.ok(helper.includes("effectiveOpenActivityIntervalEnd"));
  assert.ok(helper.includes("mergeActivityTimeIntervals"));
  assert.ok(helper.includes("activityDateInTimeZone"));
  assert.ok(helper.includes("Intl.DateTimeFormat"));
  assert.ok(!/from \"@\/|server-only|attendance|workedMinutes|audit_activity_log/i.test(helper));
});
