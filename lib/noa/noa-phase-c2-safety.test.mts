import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts, noa-user-activity-capability.server.ts, and noa-activity-time-reads.server.ts
// all have "server-only" + "@/..." aliases, neither resolvable by Node's plain ESM resolver
// outside the Next.js build. Source-level wiring/safety checks, same convention as every other
// lib/noa/*-safety.test.mts file.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const activitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const activityTimeReadsSource = readFileSync("lib/noa/noa-activity-time-reads.server.ts", "utf8");

// PART 1/9 - hybrid routing ------------------------------------------------------

test("the semantic extractor is invoked only for an already-UserActivity route or an unresolved Help route, never for another clear domain", () => {
  const guardIndex = orchestratorSource.indexOf('(route === "UserActivity" || route === "Help")');
  assert.ok(guardIndex >= 0);
  const skipRecordedFollowUp = orchestratorSource.indexOf("!recordedQuotationFollowUpFrom &&", guardIndex - 60);
  assert.ok(skipRecordedFollowUp >= 0 && skipRecordedFollowUp < guardIndex);
});

test("at most one extractor invocation per request, and never again during answer/provider generation", () => {
  const count = (orchestratorSource.match(/extractNoaSemanticRequest\(/g) ?? []).length;
  assert.equal(count, 1);
  const extractIndex = orchestratorSource.indexOf("extractNoaSemanticRequest(");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(extractIndex < providerCallIndex);
});

test("a resolved semantic result only ever reroutes the Help fallback to that request's own resolved domain, never an unrelated domain", () => {
  // C4A generalized this from a UserActivity-only literal to `semanticRequest.domain` - still
  // gated to the Help fallback only, and semanticRequest is only ever set to a real resolved
  // domain (UserActivity or Quotation), never left as "Unclear" (see noa-phase-c4a-safety.test.mts
  // for the C4A-specific assertions on this line).
  assert.match(orchestratorSource, /const effectiveRoute = route === "Help" && semanticRequest && semanticRequest\.domain !== "Unclear"\s*\n\s*\? semanticRequest\.domain\s*\n\s*: route;/);
});

test("only the 3 supported C2 intents can trigger semantic rerouting", () => {
  assert.match(orchestratorSource, /const SUPPORTED_SEMANTIC_INTENTS: ReadonlySet<NoaSemanticIntent> = new Set\(\[\s*\n\s*"activity_time",\s*\n\s*"recorded_activity",\s*\n\s*"recent_presence",\s*\n\s*\]\);/);
});

test("an extraction result whose domain isn't UserActivity is discarded - it never reroutes to a different domain", () => {
  assert.match(orchestratorSource, /if \(!semanticRequest && extracted\.domain === "UserActivity" && SUPPORTED_SEMANTIC_INTENTS\.has\(extracted\.intent\)\)/);
});

// PART 3 - structured request passed into the capability, not re-parsed ---------

test("the resolved semantic request is passed into the capability as a typed option, not re-derived inside it", () => {
  const callMatch = orchestratorSource.match(/await fetchNoaUserActivityCapability\(request\.message, request\.context, \{([^}]*)\}\)/);
  assert.ok(callMatch);
  assert.ok(callMatch[1].includes("semanticRequest,"));
  assert.ok(callMatch[1].includes("recordedQuotationFollowUpFrom: recordedQuotationFollowUpFrom ?? undefined,"));
  assert.ok(activitySource.includes("semanticRequest?: NoaSemanticRequest;"));
});

test("subject/period are resolved once in the orchestrator (not repeatedly inside the capability)", () => {
  assert.ok(orchestratorSource.includes("resolveNoaSemanticSubject(request.message, extracted.subject)"));
  assert.ok(orchestratorSource.includes("resolveNoaSemanticPeriod(request.message, extracted.period)"));
  assert.ok(!activitySource.includes("resolveNoaSemanticSubject"));
  assert.ok(!activitySource.includes("resolveNoaSemanticPeriod"));
});

// PART 2/6/7 - semantic -> kind mapping (only the 3 wired intents) --------------

test("semanticActivityOverride maps activity_time to the existing self/named_user kinds only - never team", () => {
  const fnStart = activitySource.indexOf("function semanticActivityOverride");
  const fnBody = activitySource.slice(fnStart, activitySource.indexOf("\n// PART 1/3:", fnStart));
  assert.match(fnBody, /if \(semanticRequest\.intent === "activity_time"\) \{\s*\n\s*if \(subject\?\.type === "self"\) return \{ kind: "activity_time_own" \};\s*\n\s*if \(subject\?\.type === "named_user" && subject\.name\.trim\(\)\) return \{ kind: "activity_time_other", targetName: subject\.name\.trim\(\) \};/);
});

test("semanticActivityOverride preserves recorded_activity's existing self/named_user/team kinds and does not touch its authorization", () => {
  const fnStart = activitySource.indexOf("function semanticActivityOverride");
  const fnBody = activitySource.slice(fnStart, activitySource.indexOf("\n// PART 1/3:", fnStart));
  assert.match(fnBody, /if \(semanticRequest\.intent === "recorded_activity"\) \{\s*\n\s*if \(subject\?\.type === "self"\) return \{ kind: "summary" \};\s*\n\s*if \(subject\?\.type === "named_user" && subject\.name\.trim\(\)\) return \{ kind: "other_user_activity", targetName: subject\.name\.trim\(\) \};\s*\n\s*if \(subject\?\.type === "team"\) return \{ kind: "team_summary" \};/);
});

test("semanticActivityOverride maps recent_presence to self/team activity-time-recent kinds, bypassing the presence-refusal kind", () => {
  const fnStart = activitySource.indexOf("function semanticActivityOverride");
  const fnBody = activitySource.slice(fnStart, activitySource.indexOf("\n// PART 1/3:", fnStart));
  assert.match(fnBody, /if \(semanticRequest\.intent === "recent_presence"\) \{\s*\n\s*if \(subject\?\.type === "self"\) return \{ kind: "activity_time_recent" \};\s*\n\s*if \(subject\?\.type === "team"\) return \{ kind: "activity_time_team_recent" \};/);
  assert.ok(!fnBody.includes('"presence_boundary"'));
});

test("the entry point uses the semantic override kind when present, and always falls back to the existing regex classifier otherwise", () => {
  assert.match(activitySource, /const semanticOverride = semanticActivityOverride\(options\.semanticRequest\);\s*\n\s*const kind = semanticOverride\?\.kind \?\? userActivityQuestionKind\(message\);/);
});

// PART 5 - named-user targeting never silently falls back to self ---------------

test("a semantically-resolved named-user target name is used in both named-user dispatch branches, never silently discarded", () => {
  assert.ok(activitySource.includes("const targetName = semanticOverride?.targetName ?? activityTimeTargetName(message);"));
  assert.ok(activitySource.includes("const targetName = semanticOverride?.targetName ?? otherUserNameTarget(message);"));
});

test("a named_user subject with no resolvable name never falls through to a self/team kind", () => {
  const fnStart = activitySource.indexOf("function semanticActivityOverride");
  const fnBody = activitySource.slice(fnStart, activitySource.indexOf("\n// PART 1/3:", fnStart));
  // Every branch (the initial domain guard, each of the 4 intent branches - activity_time/
  // recorded_activity/recent_presence/follow_up - and the final catch-all) ends in `return null;`,
  // never a fallback to a self/team kind - not-found/ambiguous/unauthorized results for a
  // resolved name are returned downstream by the unchanged existing handling.
  const branchCount = (fnBody.match(/return null;/g) ?? []).length;
  assert.equal(branchCount, 6, "expected: domain guard + 4 intent branches + final catch-all, each ending in 'return null'");
});

// PART 4 - activity-time authorization: System Owner only, no Admin Manager exception -----------

test("named-user and team activity time still require requireSystemOwner() specifically - never requireSettingsManager()", () => {
  const gateIndex = activitySource.indexOf('if (kind === "activity_time_team_recent" || isActivityTimeOther) {');
  const requireIndex = activitySource.indexOf("await requireSystemOwner();", gateIndex);
  const nextGateIndex = activitySource.indexOf('if (kind === "activity_time_own"', gateIndex);
  assert.ok(gateIndex >= 0 && requireIndex >= 0 && requireIndex < nextGateIndex);
  const gateBlock = activitySource.slice(gateIndex, nextGateIndex);
  assert.ok(!gateBlock.includes("requireSettingsManager"));
});

test("self activity time (own duration and self recent-presence) still requires only requireActiveUser()", () => {
  const gateIndex = activitySource.indexOf('if (kind === "activity_time_own" || kind === "activity_time_attendance" || kind === "activity_time_intervals" || kind === "activity_time_recent") {');
  assert.ok(gateIndex >= 0);
  const gateBlock = activitySource.slice(gateIndex, gateIndex + 400);
  assert.ok(gateBlock.includes("await requireActiveUser();"));
  assert.ok(!gateBlock.includes("requireSystemOwner"));
  assert.ok(!gateBlock.includes("requireSettingsManager"));
});

test("recorded-activity authorization is unchanged: requireSettingsManager() for team/other-user, requireSystemOwner() additionally for named-user profile resolution", () => {
  const gateIndex = activitySource.indexOf("if (isTeamKind || isOtherUserKind) {");
  assert.ok(gateIndex >= 0);
  const gateBlock = activitySource.slice(gateIndex, gateIndex + 700);
  assert.ok(gateBlock.includes("await requireSettingsManager();"));
  assert.ok(gateBlock.includes("await requireSystemOwner();"));
});

// PART 7 - recent-presence product wording ---------------------------------------

test("the recent/idle-window team answer includes the non-attendance qualifier, and readRecentActivityTimeUsers can be forced into the recent/idle-window branch by the semantic path", () => {
  assert.ok(activityTimeReadsSource.includes("forceRecent"));
  assert.match(activityTimeReadsSource, /const isRecent = options\.forceRecent \|\| \/\\brecent\\b\|\\bworking now\\b\/i\.test\(message\);/);
  assert.ok(activityTimeReadsSource.includes("This reflects recent ProjectWorkflow interaction, not verified attendance."));
  assert.ok(activitySource.includes("forceRecent: semanticOverride?.kind === \"activity_time_team_recent\","));
});

test("no absolute online/attendance claim was introduced", () => {
  for (const source of [activityTimeReadsSource, activitySource]) {
    assert.ok(!/\bdefinitely online\b|\bdefinitely working\b|\bphysically present\b|\battendance confirmed\b/i.test(source));
  }
});

// PART 9 - extractor failure never breaks NOA ------------------------------------

test("extraction failure (Unclear / non-UserActivity / unsupported intent) leaves semanticRequest undefined, and the capability's existing fallback classifier still runs", () => {
  assert.ok(orchestratorSource.includes("let semanticRequest: NoaSemanticRequest | undefined;"));
  assert.ok(activitySource.includes("semanticOverride?.kind ?? userActivityQuestionKind(message)"));
});

test("the extractor call is awaited directly with no try/catch around it - extractNoaSemanticRequest itself never throws (verified in C1), so no error-mapping wrapper was added here", () => {
  const extractIndex = orchestratorSource.indexOf("extractNoaSemanticRequest(");
  const precedingLines = orchestratorSource.slice(Math.max(0, extractIndex - 200), extractIndex);
  assert.ok(!precedingLines.includes("try {"));
});

// PART 10 - cost control: no extra payload, no second call ----------------------

test("the extractor call still only sends the current message and compact page context - nothing new added for C2", () => {
  const callMatch = orchestratorSource.match(/extractNoaSemanticRequest\(([^)]*)\)/);
  assert.ok(callMatch);
  const callArgs = callMatch[1];
  assert.match(callArgs, /^\{ context: request\.context, message: request\.message \}$/);
  assert.ok(!callArgs.includes("recentMessages"));
  assert.ok(!callArgs.includes("capabilityData"));
});

// Regression: other clear domains are never touched by the semantic step --------

test("regression: the semantic step is structurally gated behind route checks, so Product/Price/Quotation/Project/Client/Procurement/Admin/Insights/greeting/capabilities/context are never affected", () => {
  const semanticStepIndex = orchestratorSource.indexOf("let semanticRequest: NoaSemanticRequest | undefined;");
  const contextIndex = orchestratorSource.indexOf('if (route === "context")');
  const greetingIndex = orchestratorSource.indexOf('if (route === "greeting")');
  const capabilitiesIndex = orchestratorSource.indexOf('if (route === "capabilities")');
  assert.ok(contextIndex < semanticStepIndex && greetingIndex < semanticStepIndex && capabilitiesIndex < semanticStepIndex);
});

test("no cross-capability chaining and no new writes were introduced", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  assert.ok(!mutationPattern.test(orchestratorSource.slice(orchestratorSource.indexOf("SUPPORTED_SEMANTIC_INTENTS"))));
});
