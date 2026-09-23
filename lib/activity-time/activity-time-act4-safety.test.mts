import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/settings/activity/page.tsx", "utf8");
const settingsPage = readFileSync("app/settings/page.tsx", "utf8");
const sidebar = readFileSync("components/layout/erp-sidebar.tsx", "utf8");
const ownPage = readFileSync("app/settings/profile/activity/page.tsx", "utf8");
const touchRoute = readFileSync("app/api/activity-time/touch/route.ts", "utf8");

test("ACT-4 authorizes System Owner before any cross-user query", () => {
  const authorization = page.indexOf("await requireSystemOwner()");
  const queryClient = page.indexOf("await createClient()");
  const firstQuery = page.indexOf('.from("projectworkflow_activity_settings")');
  assert.ok(authorization >= 0 && authorization < queryClient && queryClient < firstQuery);
  assert.ok(!/requireSettingsManager|requireActiveUser|createAdminClient|service_role/i.test(page));
  assert.ok(!/admin_manager|procurement_manager|sales_designer|sales_coordinator|designer|viewer/.test(page));
});

test("ACT-4 queries bounded read-only summaries and selected interval detail", () => {
  assert.ok(page.includes("projectworkflow_activity_daily"));
  assert.ok(page.includes("projectworkflow_activity_intervals"));
  assert.ok(page.includes(".limit(USER_LIMIT)"));
  assert.ok(page.includes(".limit(INTERVAL_LIMIT)"));
  assert.ok(page.includes('.select("id,full_name", { count: "exact" })'));
  assert.ok(page.includes("organization_timezone"));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(page));
  assert.ok(!/email|UUID|productivity score|ranking/i.test(page));
});

test("ACT-4 uses application-activity wording and role-gated navigation", () => {
  assert.ok(page.includes("ProjectWorkflow active time"));
  assert.ok(page.includes("Recent ProjectWorkflow activity"));
  assert.ok(page.includes("No recent activity"));
  assert.ok(page.includes("not verified attendance or total working hours"));
  assert.ok(!/\bOnline\b|\bWorking\b|At work|\bPresent\b|productivity score|ranking/.test(page));
  assert.ok(settingsPage.includes("isSystemOwner ?"));
  assert.ok(settingsPage.includes('href="/settings/activity"'));
  assert.ok(sidebar.includes('href: "/settings/activity"'));
  assert.ok(sidebar.includes("hidden: !isSystemOwner"));
});

test("ACT-4 leaves self-only activity and touch behavior isolated", () => {
  assert.ok(ownPage.includes('.eq("profile_id", user.id)'));
  assert.ok(!/user selector|team selector|employee search/i.test(ownPage));
  assert.ok(touchRoute.includes('supabase.rpc("touch_projectworkflow_activity")'));
  assert.ok(!page.includes("touch_projectworkflow_activity"));
});
