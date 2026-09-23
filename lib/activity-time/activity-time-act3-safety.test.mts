import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/settings/profile/activity/page.tsx", "utf8");

test("ACT-3 reads only the authenticated user's activity rows without writes or privileged access", () => {
  assert.ok(page.includes("requireActiveUser()"));
  assert.ok(page.includes('.eq("profile_id", user.id)'));
  assert.ok(page.includes('projectworkflow_activity_daily'));
  assert.ok(page.includes('projectworkflow_activity_intervals'));
  assert.ok(!/createAdminClient|service_role|\.insert\(|\.update\(|\.delete\(|audit_activity_log/i.test(page));
  assert.ok(!/user selector|team selector|employee search|\[user/i.test(page));
});

test("ACT-3 keeps activity wording transparent, bounded, and non-attendance based", () => {
  assert.ok(page.includes("ProjectWorkflow active time"));
  assert.ok(page.includes("not attendance or total working hours"));
  assert.ok(page.includes("Recent ProjectWorkflow activity"));
  assert.ok(page.includes("No recent ProjectWorkflow activity."));
  assert.ok(page.includes("effectiveOpenActivityIntervalEnd"));
  assert.ok(page.includes("intervals.slice(0, 20)"));
  assert.ok(!/\bOnline\b|Currently at work|\bPresent\b|\bWorking\b/.test(page));
});

test("ACT-3 supports empty today, yesterday, and week self-history in organization time", () => {
  assert.ok(page.includes("No ProjectWorkflow activity has been recorded for you today."));
  assert.ok(page.includes('period=yesterday'));
  assert.ok(page.includes('period=week'));
  assert.ok(page.includes("activityDateInTimeZone"));
  assert.ok(page.includes("formatActivityTimestamp"));
});
