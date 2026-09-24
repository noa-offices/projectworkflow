import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activity = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const reads = readFileSync("lib/noa/noa-activity-time-reads.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const ownPage = readFileSync("app/settings/profile/activity/page.tsx", "utf8");
const touchRoute = readFileSync("app/api/activity-time/touch/route.ts", "utf8");

test("ACT-5 routes narrow activity-time phrases to UserActivity without stealing operational routes", () => {
  assert.ok(router.includes("active time"));
  assert.ok(router.includes("activity time"));
  assert.ok(router.includes("first (?:recorded )?activity today"));
  assert.ok(router.includes("was i active recently"));
  assert.ok(router.includes("show active projects"));
  assert.ok(router.includes("ADMIN_PATTERNS"));
  assert.ok(router.includes("PROCUREMENT_KEYWORDS"));
});

test("ACT-5 separates own and cross-user authorization before activity-time reads", () => {
  assert.ok(activity.includes("await requireActiveUser();"));
  assert.ok(activity.includes("await requireSystemOwner();"));
  assert.ok(!activity.includes("requireSettingsManager" + "()" + " for activity-time"));
  const systemOwner = activity.indexOf("await requireSystemOwner();", activity.indexOf("activity_time_team_recent"));
  const crossClient = activity.indexOf("const supabase = await createClient();", systemOwner);
  assert.ok(systemOwner >= 0 && crossClient > systemOwner);
  assert.ok(!/createAdminClient|service[-_]?role|SUPABASE_SERVICE_ROLE/i.test(`${activity}\n${reads}`));
});

test("ACT-5 activity-time reads are bounded, time-zoned, deterministic, and read-only", () => {
  assert.ok(reads.includes('eq("profile_id", profileId)'));
  assert.ok(reads.includes("organization_timezone"));
  assert.ok(reads.includes("effectiveOpenActivityIntervalEnd"));
  assert.ok(reads.includes("MAX_ACTIVITY_TIME_USERS = 20"));
  assert.ok(reads.includes("MAX_ACTIVITY_TIME_INTERVALS = 20"));
  assert.ok(reads.includes("deterministicText"));
  assert.ok(!/\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/.test(reads));
  assert.ok(!/email|interaction|keyboard|click|url|uuid/i.test(reads));
});

test("ACT-5 keeps active-time language and attendance disclaimer safe", () => {
  assert.ok(reads.includes("ProjectWorkflow active time"));
  assert.ok(reads.includes("not your total working hours or attendance"));
  assert.ok(reads.includes("recent ProjectWorkflow activity"));
  assert.ok(!/online now|currently working|at work|presence/i.test(reads));
});

test("ACT-5 returns deterministic capability text if provider phrasing fails, without overriding capability errors", () => {
  const capabilityError = orchestrator.indexOf("if (!capabilityResult.ok)");
  const providerTry = orchestrator.indexOf("try {", capabilityError);
  const fallback = orchestrator.indexOf("deterministicText", providerTry);
  assert.ok(capabilityError >= 0 && providerTry > capabilityError && fallback > providerTry);
  assert.ok(orchestrator.includes("if (deterministicText) return"));
  assert.ok(!orchestrator.includes("fetchNoaUserActivityCapability" + "Fallback"));
});

test("ACT-5 leaves the self-only page and automatic touch path unchanged", () => {
  assert.ok(ownPage.includes('.eq("profile_id", user.id)'));
  assert.ok(touchRoute.includes('supabase.rpc("touch_projectworkflow_activity")'));
  assert.ok(!activity.includes("noa_orchestrator"));
});
