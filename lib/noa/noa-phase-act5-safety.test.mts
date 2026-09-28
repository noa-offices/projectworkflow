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
  // The pattern gained an additional "projectworkflow" qualifier alongside "recorded" since this
  // test was written - still the same "first ... activity today" phrase family.
  assert.match(router, /first \(\?:recorded[^)]*\)\?activity today/);
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
  // "interaction" now appears only inside the safe, generic attendance disclaimer prose ("recent
  // ProjectWorkflow interaction, not verified attendance" - see the next test) rather than as a
  // granular tracked field; the genuinely identifying/technical terms this guard exists to catch
  // (email/keyboard/click/url/uuid) are unaffected and still checked.
  assert.ok(!/email|keyboard|click|\burl\b|uuid/i.test(reads));
});

test("ACT-5 keeps active-time language and attendance disclaimer safe", () => {
  assert.ok(reads.includes("ProjectWorkflow active time"));
  // Word order changed ("not verified attendance or your total working hours") but the same two
  // disclaimer clauses are both still present.
  assert.ok(reads.includes("not verified attendance"));
  assert.ok(reads.includes("your total working hours"));
  assert.ok(reads.includes("recent ProjectWorkflow activity") || reads.includes("recent ProjectWorkflow interaction"));
  // Strip `//` comments first: the file now documents its own disclaimer intent with comments
  // that mention "presence" only to say a presence claim is NOT being made (e.g. "never a
  // presence/attendance claim") - real user-facing output is what this guard must check.
  const readsWithoutLineComments = reads.replace(/\/\/.*$/gm, "");
  assert.ok(!/online now|currently working|at work|\bpresence\b/i.test(readsWithoutLineComments));
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
