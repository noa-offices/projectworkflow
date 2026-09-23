import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/109_projectworkflow_activity_touch.sql", "utf8");
const route = readFileSync("app/api/activity-time/touch/route.ts", "utf8");
const tracker = readFileSync("components/activity-time/projectworkflow-activity-tracker.tsx", "utf8");

test("ACT-2 touch RPC derives identity/time/settings and serializes concurrent tabs", () => {
  assert.ok(migration.includes("current_profile_id uuid := auth.uid()"));
  assert.ok(migration.includes("clock_timestamp()"));
  assert.ok(migration.includes("pg_advisory_xact_lock"));
  assert.ok(migration.includes("current_user_is_active()"));
  assert.ok(migration.includes("projectworkflow_activity_settings"));
  assert.ok(migration.includes("organization_timezone"));
  assert.ok(migration.includes("activity_idle_timeout_minutes"));
  assert.ok(migration.includes("last_activity_at + timeout_interval"));
  assert.ok(migration.includes("open_interval.activity_date <> current_activity_date"));
  assert.ok(migration.includes("refresh_projectworkflow_activity_daily"));
  assert.ok(migration.includes("on conflict (profile_id, activity_date) do update"));
  assert.ok(migration.includes("where profile_id = current_profile_id and ended_at is null"));
  assert.ok(!/createAdminClient|service_role|audit_activity_log|attendance|worked_hours/i.test(migration));
});

test("ACT-2 endpoint accepts no identity, timestamps, duration, or payload", () => {
  assert.match(route, /export async function POST\(\)/);
  assert.ok(route.includes("supabase.auth.getUser()"));
  assert.ok(route.includes('supabase.rpc("touch_projectworkflow_activity")'));
  assert.ok(!/request\.json|profile_id|started_at|ended_at|active_minutes|duration|createAdminClient|service_role/i.test(route));
});

test("ACT-2 tracker uses intentional visible interactions, empty requests, and no heartbeat", () => {
  for (const event of ['"click"', '"keydown"', '"pointerdown"', '"submit"']) {
    assert.ok(tracker.includes(`addEventListener(${event}`));
  }
  assert.ok(tracker.includes('document.visibilityState === "visible"'));
  assert.ok(tracker.includes('method: "POST"'));
  assert.ok(!/setInterval|request\.json|JSON\.stringify|body:|event\.key|clientX|clientY|location\.href|audit_activity_log/i.test(tracker));
});
