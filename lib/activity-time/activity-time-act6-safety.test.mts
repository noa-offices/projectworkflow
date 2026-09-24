import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const action = readFileSync("app/settings/activity/actions.ts", "utf8");
const page = readFileSync("app/settings/activity/page.tsx", "utf8");
const validation = readFileSync("lib/activity-time/activity-settings-validation.ts", "utf8");

test("ACT-6 page and action require System Owner with a user-scoped client", () => {
  assert.ok(page.includes("await requireSystemOwner()"));
  assert.ok(action.includes("await requireSystemOwner();"));
  assert.ok(action.includes('import { createClient } from "@/lib/supabase/server";'));
  assert.ok(!/requireSettingsManager|createAdminClient|service[-_]?role/i.test(action));
});

test("ACT-6 validates runtime timezones and an inclusive 5-60 minute timeout", () => {
  assert.ok(validation.includes('new Intl.DateTimeFormat("en-US", { timeZone })'));
  assert.ok(validation.includes("idleTimeoutMinutes < 5 || idleTimeoutMinutes > 60"));
  assert.ok(validation.includes("Choose a valid timezone."));
  assert.ok(validation.includes("Idle timeout must be between 5 and 60 minutes."));
});

test("ACT-6 updates only the fixed canonical settings row", () => {
  assert.ok(action.includes('.from("projectworkflow_activity_settings")'));
  assert.ok(action.includes("activity_idle_timeout_minutes: validation.value.idleTimeoutMinutes"));
  assert.ok(action.includes("organization_timezone: validation.value.organizationTimeZone"));
  assert.ok(action.includes('.eq("id", 1)'));
  assert.ok(!/projectworkflow_activity_(intervals|daily)|\.insert\(|\.delete\(|\.rpc\(/.test(action));
});

test("ACT-6 keeps the compact tracking settings UI and non-attendance language", () => {
  assert.ok(page.includes("Activity Tracking Settings"));
  assert.ok(page.includes("organization_timezone"));
  assert.ok(page.includes("activity_idle_timeout_minutes"));
  assert.ok(action.includes("Activity tracking settings updated."));
  assert.ok(page.includes("not verified attendance or total working hours"));
});
