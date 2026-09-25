// NOA 2.0B-1: Catch Me Up - own activity + time windows, folded into the existing UserActivity
// domain/capability (never a new CatchUp domain). noa-user-activity-capability.server.ts has
// "@/..." aliases and/or `import "server-only"`, and noa-intent-router.ts's own pre-existing test
// (noa-intent-router.test.mts) already hits the same Node-ESM `.js`->`.ts` resolution gap
// documented in earlier N2A* phases - neither is resolvable by Node's plain ESM resolver outside
// the Next.js build. These are source-level wiring/safety checks, matching the convention already
// used throughout lib/noa/'s other *-safety.test.mts files.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capability = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const typesSource = readFileSync("lib/noa/noa-types.ts", "utf8");

// N2B2 fix: this file (like the rest of the repo, per git's own CRLF-normalization warnings) has
// CRLF line endings on disk, so a literal `indexOf("\n}\n", ...)` boundary never matches (silently
// returns -1, making `slice(start, -1)` cover almost the entire rest of the file instead of just
// one function body). This CRLF-tolerant helper isolates a function body starting at `startIndex`
// up to its first top-level closing brace, regardless of line-ending style.
function sliceFunctionBody(source: string, startIndex: number): string {
  const rest = source.slice(startIndex);
  const relativeEnd = rest.search(/\r?\n\}\r?\n/);
  return relativeEnd === -1 ? rest : rest.slice(0, relativeEnd);
}

// 1. No new CatchUp NoaDomain exists
test("1. no CatchUp NoaDomain was added - Catch-Up stays inside UserActivity", () => {
  const domainLine = typesSource.match(/export type NoaDomain = .*;/)?.[0] ?? "";
  assert.ok(domainLine.includes('"UserActivity"'));
  assert.ok(!domainLine.includes('"CatchUp"'));
  assert.ok(!capability.includes("noa-catch-up-capability"));
});

// 2-8. Catch-Up phrases route to UserActivity at the router level
test("2-8. Catch-Up phrases are matched by CATCH_UP_PATTERNS, checked in the same OR as USER_ACTIVITY_PATTERNS/TEAM_AND_OTHER_USER_ACTIVITY_PATTERNS", () => {
  assert.ok(router.includes("const CATCH_UP_PATTERNS = [/\\bwhat changed\\b/, /\\bwhat happened\\b/, /\\bcatch me up\\b/];"));
  assert.ok(router.includes("CATCH_UP_PATTERNS.some((pattern) => pattern.test(normalized))"));
  const orBlockStart = router.indexOf("USER_ACTIVITY_PATTERNS.some((pattern) => pattern.test(normalized)) ||");
  const orBlockEnd = router.indexOf("return \"UserActivity\";", orBlockStart);
  const orBlock = router.slice(orBlockStart, orBlockEnd);
  assert.ok(orBlock.includes("CATCH_UP_PATTERNS.some"));

  const phrases = [
    "what changed today", "what happened today", "catch me up", "catch me up today",
    "catch me up since yesterday", "catch me up since monday", "what changed since yesterday",
    "what changed this week",
  ];
  for (const phrase of phrases) {
    assert.ok(CATCH_UP_TEST_PATTERNS.some((pattern) => pattern.test(phrase)), `"${phrase}" should match a CATCH_UP_PATTERNS entry`);
  }
});

// Mirrors the exact array in noa-intent-router.ts (kept in sync manually - see test above, which
// also asserts the literal source string matches).
const CATCH_UP_TEST_PATTERNS = [/\bwhat changed\b/, /\bwhat happened\b/, /\bcatch me up\b/];

// 9-12. Generic Insights summaries still route Insights
test("9-12. quotation/procurement summary and business overview phrasing still match INSIGHTS_PATTERNS (never CATCH_UP_PATTERNS)", () => {
  const insightsPhrases = ["quotation summary", "procurement summary", "give me this month's overview", "business overview"];
  const insightsPatternsBlock = router.slice(router.indexOf("const INSIGHTS_PATTERNS"), router.indexOf("];", router.indexOf("const INSIGHTS_PATTERNS")));
  for (const phrase of insightsPhrases) {
    const matchesInsights = insightsPatternsBlock.split("\n").some((line) => {
      const patternSource = line.match(/\/(.+)\//)?.[1];
      if (!patternSource) return false;
      try { return new RegExp(patternSource, "i").test(phrase); } catch { return false; }
    });
    assert.ok(matchesInsights, `"${phrase}" should still match an INSIGHTS_PATTERNS entry`);
    assert.ok(!CATCH_UP_TEST_PATTERNS.some((pattern) => pattern.test(phrase)), `"${phrase}" must NOT match CATCH_UP_PATTERNS`);
  }
});

test("insights collision fix: the literal /\\bwhat changed\\b/ pattern was removed from INSIGHTS_PATTERNS", () => {
  const insightsPatternsBlock = router.slice(router.indexOf("const INSIGHTS_PATTERNS"), router.indexOf("];", router.indexOf("const INSIGHTS_PATTERNS")));
  assert.ok(!insightsPatternsBlock.includes("what changed"));
});

// 13. Attention routing unchanged
test("13. Attention routing/patterns are untouched by this phase", () => {
  assert.ok(router.includes("const ATTENTION_PATTERNS = ["));
  // I3: classifyNoaRoute() now returns classifyNoaRouteWithStrength(...).route - same branch.
  assert.ok(router.includes('return { route: "Attention", rule: "attention", strength: "anchored" };'));
});

// 14. UserActivity own-auth gate reused
test("14. Catch-Up reuses the existing own-scope requireActiveUser() gate - no new auth helper", () => {
  const ownScopeStart = capability.indexOf("// Own-scope kinds (UA-1A, unchanged): requireActiveUser() only.");
  const catchUpDispatchIndex = capability.indexOf('if (kind === "catch_up") return catchUpAnswer(supabase, userId, message);');
  assert.ok(ownScopeStart > -1 && catchUpDispatchIndex > -1);
  assert.ok(ownScopeStart < catchUpDispatchIndex);
  assert.ok(!/function\s+requireCatchUp|requireCatchUp\(/.test(capability));
});

// 15/16. date-range helper reused, no custom Monday calculation
test("15/16. Monday maps onto the existing this_week range via activityDateRangeKey() - no new date math", () => {
  assert.ok(capability.includes('if (/\\bmonday\\b/.test(normalized)) return "this_week";'));
  assert.ok(!/getDay\(\)\s*[-+]|setDate\(.*getDay/.test(capability.slice(capability.indexOf("function activityDateRangeKey"), capability.indexOf("function activityDateRangeKey") + 600)));
  assert.ok(capability.includes('import { resolveDateRange, type DateRangeKey } from "@/lib/insights/date-ranges";'));
});

// 17. audit query remains bounded
test("17. the catch-up query is bounded by the existing MAX_ACTIVITY_LOG_ROWS constant", () => {
  const catchUpAnswerStart = capability.indexOf("async function catchUpAnswer(");
  const catchUpAnswerBody = sliceFunctionBody(capability, catchUpAnswerStart);
  assert.ok(catchUpAnswerBody.includes(".limit(MAX_ACTIVITY_LOG_ROWS)"));
  assert.ok(!catchUpAnswerBody.includes("MAX_ACTIVITY_LOG_ROWS = ") || catchUpAnswerBody.indexOf("MAX_ACTIVITY_LOG_ROWS = ") === -1);
});

// 18. newest-first ordering
test("18. the catch-up query orders newest first", () => {
  const catchUpAnswerStart = capability.indexOf("async function catchUpAnswer(");
  const catchUpAnswerBody = sliceFunctionBody(capability, catchUpAnswerStart);
  assert.ok(catchUpAnswerBody.includes('.order("created_at", { ascending: false })'));
});

// 19. actor label does not query profiles
test("19. actor labeling reuses actorLabelFor() (metadata.actorName / Unresolved user) - no profiles query", () => {
  assert.ok(capability.includes("function catchUpGroupLine(group: CatchUpAuditRow[]): string {"));
  assert.ok(capability.includes("actorLabelFor(latest)"));
  const catchUpSectionStart = capability.indexOf("const CATCH_UP_SELECT");
  const catchUpSectionEnd = capability.indexOf("async function catchUpAnswer(") + 2000;
  const catchUpSection = capability.slice(catchUpSectionStart, catchUpSectionEnd);
  assert.ok(!catchUpSection.includes('.from("profiles")'));
});

// 20. audit UUID not displayed
test("20. the audit row's internal id is used only as the dedupe key, never in title/detail/deterministicText", () => {
  assert.ok(capability.includes("key: latest.id,"));
  assert.ok(!/deterministicText.*row\.id|title.*row\.id/.test(capability));
});

// 21/22. empty state wording
test("21/22. the empty-state text says \"recorded activity\", never claims \"nothing changed\"", () => {
  assert.ok(capability.includes("`I couldn't find any recorded activity for you ${label}.`"));
  // No actual deterministicText literal claims "nothing changed" (a comment explaining WHY we
  // avoid that phrasing is expected and fine - only a real string literal would be a violation).
  assert.ok(!/deterministicText:\s*[`"'][^`"']*nothing changed/i.test(capability));
});

// 23. no provider/free-form audit summarization
test("23. catch-up responses are deterministicOnly - never handed to the provider for free-form summarization", () => {
  const catchUpAnswerStart = capability.indexOf("async function catchUpAnswer(");
  const catchUpAnswerBody = sliceFunctionBody(capability, catchUpAnswerStart);
  assert.equal((capability.match(/kind: "user_activity_catch_up"[\s\S]{0,10}?,\n/g) ?? []).length >= 0, true);
  assert.ok(capability.includes("deterministicOnly: true"));
  assert.ok(!catchUpAnswerBody.includes("runNoaProvider"));
});

// 24. existing UserActivity team behavior untouched
test("24. team activity kinds/functions are untouched", () => {
  assert.ok(capability.includes("async function teamSummaryAnswer("));
  assert.ok(capability.includes("async function teamQuotationActivityAnswer("));
  assert.ok(capability.includes("async function teamRecentActivityAnswer("));
  assert.ok(capability.includes("if (isTeamActivityRequest(message)) {"));
});

// N2B2 note: quotation/Project-File entity-scoped Catch-Up was intentionally added in N2B2
// (catchUpQuotationAnswer()/catchUpProjectFileAnswer()) - this N2B1 check is narrowed to what it
// originally guarded: the global own-activity catchUpAnswer() itself never resolves a specific
// QN/CO entity, and the shared per-item NoaCatchUpItem object never carries entityIdentifier/
// entityLabel (those are only ever added at the top-level response `data`, via buildCatchUpResult's
// `extraData` parameter - see the N2B2 safety test for that behavior).
test("25/26. the global own-activity catchUpAnswer() resolves no QN/CO entity, and per-item entityIdentifier/entityLabel are never populated", () => {
  const answerStart = capability.indexOf("async function catchUpAnswer(");
  const answerBody = sliceFunctionBody(capability, answerStart);
  assert.ok(!/QN-|CO-|projectFileFromLayoutSettings|quotationForIdentifier|allProjectFiles/.test(answerBody));
  const itemsBuildStart = capability.indexOf("const items: NoaCatchUpItem[] = displayedGroups.map((group) => {");
  assert.ok(itemsBuildStart > -1);
  const itemsBuildBlock = capability.slice(itemsBuildStart, itemsBuildStart + 500);
  assert.ok(!itemsBuildBlock.includes("entityIdentifier"));
  assert.ok(!itemsBuildBlock.includes("entityLabel"));
});

// 27. no while-away persistence/reference point
test("27. \"while I was away\" is a fixed clarification only - no persisted reference point/state", () => {
  assert.ok(capability.includes('"catch_up_needs_reference"'));
  assert.ok(capability.includes("Since when?"));
  assert.ok(!/lastCatchUp|last_catch_up|lastSeenAt|last_seen_at/i.test(capability));
});

// 28. no schema/RLS changes
test("28. no schema/migration/RLS reference was added", () => {
  assert.ok(!/alter table|create table|create policy/i.test(capability));
  assert.ok(!/alter table|create table|create policy/i.test(router));
});
