import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const activity = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const reads = readFileSync("lib/noa/noa-activity-time-reads.server.ts", "utf8");
const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const provider = readFileSync("lib/noa/noa-provider.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");

test("UAT activity-time phrases route to UserActivity without affecting other domains", () => {
  assert.ok(router.includes("\\b(?:projectworkflow )?active time\\b"));
  assert.ok(router.includes("\\bhow many (?:activity )?intervals?\\b"));
  assert.ok(router.includes("\\bmy interval count\\b"));
  assert.ok(router.includes('return "UserActivity"'));
  assert.ok(router.includes("PROJECT_KEYWORDS"));
  assert.ok(router.includes("ADMIN_PATTERNS"));
  assert.ok(router.includes('return "capabilities"'));
});

test("UAT self activity-time takes precedence over named-user extraction and interval counts stay deterministic", () => {
  const classifier = activity.slice(activity.indexOf("function activityTimeKind"), activity.indexOf("function nameActivityTimeText"));
  assert.ok(classifier.indexOf("hasFirstPersonReference(message)") < classifier.indexOf("activityTimeTargetName(message)"));
  assert.ok(activity.includes('return "activity_time_own"'));
  assert.ok(activity.includes("isActivityIntervalCountQuestion"));
  assert.ok(reads.includes("You have ${intervalCount} ProjectWorkflow activity interval"));
});

test("UAT keeps recorded UserActivity facts separate from activity-time and conversation history", () => {
  const summary = activity.slice(activity.indexOf("async function summaryAnswer"), activity.indexOf("async function quotationActivityAnswer"));
  assert.ok(summary.includes("auditLogRowsForUser"));
  assert.ok(activity.includes('.from("audit_activity_log")'));
  assert.ok(!/activity_time|activeMinutes|intervalCount|firstActivityAt|latestActivityAt/.test(summary));
  assert.ok(provider.includes("Use recentMessages only for conversational context and referent resolution."));
  assert.ok(provider.includes("unless those facts are also present in the current capabilityData."));
  assert.ok(summary.includes("recorded ProjectWorkflow actions"));
});

test("UAT presence and online wording bypasses provider phrasing and greeting uses only the first name", () => {
  assert.ok(activity.includes("PRESENCE_LIMITATION_TEXT"));
  assert.ok(activity.includes("ProjectWorkflow doesn't track verified online presence."));
  assert.ok(orchestrator.indexOf("if (deterministicData?.deterministicOnly === true") < orchestrator.indexOf("await runNoaProvider("));
  assert.ok(activity.includes("deterministicOnly: true"));
  assert.ok(router.includes("displayName?.trim().split(/\\s+/).find(Boolean) || null"));
});

test("UAT strict activity-time, named-user, and quotation follow-up paths remain bounded", () => {
  assert.ok(reads.includes("ProjectWorkflow recorded ${formatActivityDuration(activeMinutes)} of active application time"));
  assert.ok(reads.includes("not verified attendance or your total working hours"));
  assert.ok(!reads.includes("continuous session"));
  assert.ok(activity.includes("what ([a-z][a-z'-]*) did today"));
  assert.ok(activity.includes("await requireSettingsManager();"));
  assert.ok(activity.includes("await requireSystemOwner();"));
  assert.ok(activity.includes("recordedQuotationFollowUpAnswer"));
  assert.ok(activity.includes("quotationIdentifierFromAuditTitle"));
  assert.ok(activity.includes("auditLogRowsForUser(supabase, userId"));
  assert.ok(orchestrator.includes("recordedQuotationFollowUpReference"));
  assert.ok(orchestrator.includes("recordedQuotationFollowUpFrom"));
});
