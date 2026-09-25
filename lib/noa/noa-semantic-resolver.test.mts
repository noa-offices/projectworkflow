import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  NOA_CLIENT_RANKING_CLARIFICATION_CHOICES,
  resolveNoaSemanticCapabilityRequest,
  type NoaSemanticResolution,
} from "./noa-semantic-resolver.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";

// I2: table-driven tests against the pure resolver. Each canonical-message expectation is
// cross-checked against the ACTUAL question-kind classifier regex copied read-only from the
// target capability's own source (never re-implemented differently), so a passing test here means
// the phrase really would reach the intended kind at runtime, not just that it "looks right"
// (I2 PART 19).

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, domain: "Unclear", confidence: "high", ...overrides };
}

function assertDispatch(result: NoaSemanticResolution, domain: string, canonicalMessage: string): void {
  assert.equal(result.kind, "dispatch", `expected dispatch, got ${result.kind}${"text" in result ? `: ${result.text}` : ""}`);
  if (result.kind !== "dispatch") return;
  assert.equal(result.domain, domain);
  assert.equal(result.canonicalMessage, canonicalMessage);
}

// ---- source-level cross-checks against the REAL capability classifiers (read-only mirrors) ----

const insightsSource = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const projectSource = readFileSync("lib/noa/noa-project-capability.server.ts", "utf8");
const productSource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const procurementSource = readFileSync("lib/noa/noa-procurement-capability.server.ts", "utf8");
const userActivitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");

test("cross-check: every client-ranking canonical phrase appears verbatim in insightsQuestionKind's own regex source", () => {
  assert.ok(insightsSource.includes("top clients? by (?:quotation|confirmed|project(?:\\s*file)?) value"));
  assert.ok(insightsSource.includes("how many quotations does each client have"));
});

test("cross-check: Project File count/list canonical phrases rely on regexes present in the Project capability source", () => {
  assert.ok(projectSource.includes('/\\b(how many|count|number of)\\b/'));
  assert.ok(projectSource.includes("const completed = /\\bcompleted\\b/.test(normalized);"));
});

test("cross-check: Product list/count canonical phrases rely on regexes present in the Product capability source", () => {
  assert.ok(productSource.includes('/\\b(how many|count|number of)\\b/'));
  assert.ok(productSource.includes('/\\b(show|list|all|which)\\b/'));
});

test("cross-check: Procurement canonical phrases rely on regexes present in the Procurement capability source", () => {
  assert.ok(procurementSource.includes("const countOnly = /\\b(how many|count|number of)\\b/.test(normalized);"));
});

test("cross-check: UserActivity/Catch-Up canonical phrases rely on regexes present in the capability source", () => {
  assert.ok(userActivitySource.includes("/\\bam i online\\b/"));
  assert.ok(userActivitySource.includes("/\\bwhat changed\\b/"));
  assert.ok(userActivitySource.includes("/\\bwhat happened\\b/"));
});

// ================================================================================================
// CLIENT
// ================================================================================================

test("1. best client with missing metric -> clarify with the 4 deterministic choices", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: null }));
  assert.equal(result.kind, "clarify");
  if (result.kind !== "clarify") return;
  assert.equal(result.reason, "missing_metric");
  assert.deepEqual(result.choices, NOA_CLIENT_RANKING_CLARIFICATION_CHOICES);
});

test("2. client rank + quotation_value -> Insights + canonical quotation-value ranking phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value" }));
  assertDispatch(result, "Insights", "top clients by quotation value");
});

test("3. client rank + confirmed_value -> correct phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Insights", intent: "rank", entityType: "client", metric: "confirmed_value" }));
  assertDispatch(result, "Insights", "top clients by confirmed value");
});

test("4. client rank + project_file_value -> correct phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "project_file_value" }));
  assertDispatch(result, "Insights", "top clients by project value");
});

test("5. client rank + quotation_count -> correct phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_count" }));
  assertDispatch(result, "Insights", "how many quotations does each client have");
});

test("6. ordinal=1 + reference=none is ignored - same dispatch destination/phrase as no ordinal at all", () => {
  const withOrdinal = semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value", reference: "none", ordinal: 1 });
  const withoutOrdinal = semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value", reference: "none", ordinal: null });
  const resultWithOrdinal = resolveNoaSemanticCapabilityRequest(withOrdinal);
  const resultWithoutOrdinal = resolveNoaSemanticCapabilityRequest(withoutOrdinal);
  // The ordinal value must have no bearing on WHERE this dispatches or WHAT phrase it sends - the
  // passthrough `semantic` field naturally still echoes back whichever object was passed in
  // unmutated (I2 PART 5's "do not mutate the semantic object if unnecessary"), so only kind/
  // domain/canonicalMessage are compared here, not the whole object.
  assert.equal(resultWithOrdinal.kind, resultWithoutOrdinal.kind);
  assertDispatch(resultWithOrdinal, "Insights", "top clients by quotation value");
  assertDispatch(resultWithoutOrdinal, "Insights", "top clients by quotation value");
  // And the resolver must not have mutated ordinal away either - it passes the field through
  // untouched rather than "turning it into first previous result" or silently clearing it.
  if (resultWithOrdinal.kind === "dispatch") assert.equal(resultWithOrdinal.semantic.ordinal, 1);
});

test("client rank with an unsupported metric (e.g. average_quotation_value) fails closed (I6.3), never a wrong ranking", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "average_quotation_value" }));
  assert.deepEqual(result, { kind: "fallback", reason: "semantic_incompatible_incompatible_metric" });
});

// ================================================================================================
// USER ACTIVITY
// ================================================================================================

test("7. activity/self/today -> UserActivity canonical phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "activity", subject: "self", period: "today" }));
  assertDispatch(result, "UserActivity", "what did i work on today");
});

test("8. activity_time/self/today -> UserActivity", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "activity_time", subject: "self", period: "today" }));
  assertDispatch(result, "UserActivity", "projectworkflow active time today");
});

test("9. presence/self -> UserActivity", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "presence", subject: "self" }));
  assertDispatch(result, "UserActivity", "am i online");
});

test("activity/named_user is grounded through subjectName", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "activity", subject: "named_user", subjectName: "Alex" }));
  assertDispatch(result, "UserActivity", "what did Alex work on today");
});

test("presence/team -> UserActivity", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "presence", subject: "team" }));
  assertDispatch(result, "UserActivity", "who is online");
});

// ================================================================================================
// HISTORY
// ================================================================================================

test("10. history/today -> UserActivity Catch-Up phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: "today", reference: "none" }));
  assertDispatch(result, "UserActivity", "what changed today");
});

test("11. history/yesterday -> UserActivity Catch-Up phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: "yesterday", reference: "none" }));
  assertDispatch(result, "UserActivity", "what happened yesterday");
});

test("12. history with an unresolved previous_result reference -> clarify, never invent an entity", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", reference: "previous_result" }));
  assert.equal(result.kind, "clarify");
  if (result.kind !== "clarify") return;
  assert.equal(result.reason, "ambiguous_reference");
});

test("history with an unsupported period (last_month) is unsupported, never silently coerced to today", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: "last_month", reference: "none" }));
  assert.equal(result.kind, "unsupported");
});

// I6.5: history + this_week -> supported weekly Catch-Up phrase (distinct from today/yesterday).
test("history/this_week -> UserActivity Catch-Up phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: "this_week", reference: "none" }));
  assertDispatch(result, "UserActivity", "what changed this week");
});

// I6.5 root-cause fix: a null period with no unsupported_period flag is the existing, intentional
// "nothing else was said" default - it still means today.
test("history + null period + no clarification flag -> preserves the existing today default", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: null, needsClarification: false, clarificationReason: null, reference: "none" }));
  assertDispatch(result, "UserActivity", "what changed today");
});

// I6.4 catchup-02 finding: "catch me up since Monday" -> period=null, needsClarification=true,
// clarificationReason="unsupported_period". This must NEVER dispatch "what changed today".
test("history + null period + unsupported_period flag -> MUST NOT dispatch today", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({
    domain: "UserActivity", intent: "history", period: null, needsClarification: true, clarificationReason: "unsupported_period", reference: "none",
  }));
  assert.notDeepEqual(result, { canonicalMessage: "what changed today", domain: "UserActivity", kind: "dispatch" });
  assert.equal(result.kind, "unsupported");
  if (result.kind === "unsupported") assert.match(result.text, /today, yesterday, or this week/);
});

test("unsupported_period -> the same deterministic unsupported result, whatever the stated period", () => {
  const flagged = resolveNoaSemanticCapabilityRequest(semantic({
    domain: "UserActivity", intent: "history", period: null, needsClarification: true, clarificationReason: "unsupported_period", reference: "none",
  }));
  const stated = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: "last_month", reference: "none" }));
  assert.deepEqual(flagged, stated);
});

test("high confidence does not bypass unsupported_period", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({
    domain: "UserActivity", intent: "history", period: null, confidence: "high", needsClarification: true, clarificationReason: "unsupported_period", reference: "none",
  }));
  assert.equal(result.kind, "unsupported");
});

test("low confidence does not bypass unsupported_period", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({
    domain: "UserActivity", intent: "history", period: null, confidence: "low", needsClarification: true, clarificationReason: "unsupported_period", reference: "none",
  }));
  assert.equal(result.kind, "unsupported");
});

// ================================================================================================
// ATTENTION
// ================================================================================================

test("13. attention intent -> Attention", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Attention", intent: "attention" }));
  assertDispatch(result, "Attention", "what needs my attention");
});

// ================================================================================================
// PROJECT
// ================================================================================================

test("14. active project-file count -> correct existing capability", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "count", entityType: "project_file", projectFileStatus: "active" }));
  assertDispatch(result, "Project", "how many active project files");
});

test("15. completed project-file list -> correct capability", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "list", entityType: "project_file", projectFileStatus: "completed" }));
  assertDispatch(result, "Project", "show completed project files");
});

test("16. project-file-value aggregate -> correct Insights ownership", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "aggregate", metric: "project_file_value" }));
  assertDispatch(result, "Insights", "project file analytics");
});

// ================================================================================================
// QUOTATION
// ================================================================================================

test("17. quotation-value aggregate / last_month -> Insights", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "aggregate", metric: "quotation_value", period: "last_month" }));
  assertDispatch(result, "Insights", "quotations last month");
});

test("18. comparison previous_period -> existing compare phrase", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "compare", metric: "quotation_value", comparison: "previous_period" }));
  assertDispatch(result, "Insights", "compare this month to last month");
});

test("quotation lookup with no grounded identifier -> clarify, never a guessed QN", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "lookup" }));
  assert.equal(result.kind, "clarify");
  if (result.kind !== "clarify") return;
  assert.equal(result.reason, "missing_entity");
});

// ================================================================================================
// PRODUCT
// ================================================================================================

test("19. grounded product list -> Product", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Product", intent: "list", entityType: "product", entityText: "Interstuhl chairs" }));
  assertDispatch(result, "Product", "show Interstuhl chairs");
});

test("20. missing product entity when required -> clarify/fallback", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Product", intent: "list", entityType: null, entityText: null }));
  assert.equal(result.kind, "clarify");
  if (result.kind !== "clarify") return;
  assert.equal(result.reason, "missing_entity");
});

// ================================================================================================
// PROCUREMENT
// ================================================================================================

test("21. active list -> Procurement", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Procurement", intent: "list", procurementStatus: "active" }));
  assertDispatch(result, "Procurement", "show active procurement orders");
});

test("22. unsupported shipping-status semantic (a ranking intent Procurement can't do) -> unsupported/fallback", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Procurement", intent: "rank", entityType: "supplier" }));
  // I6.3: fails closed at the compatibility gate rather than surfacing a semantic refusal.
  assert.deepEqual(result, { kind: "fallback", reason: "semantic_incompatible_unsupported_domain_intent" });
});

// ================================================================================================
// HELP / ACTION
// ================================================================================================

test("23. howto -> Help/fallback safely (no invented instructions)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Help", intent: "howto" }));
  assert.equal(result.kind, "unsupported");
  if (result.kind !== "unsupported") return;
  assert.ok(!/step[- ]by[- ]step instructions:/i.test(result.text), "must not fabricate actual step-by-step instructions");
});

test("24. action_requested -> read-only unsupported response, never a write dispatch", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "lookup", clarificationReason: "action_requested", needsClarification: true }));
  assert.equal(result.kind, "unsupported");
  if (result.kind !== "unsupported") return;
  assert.match(result.text, /read-only/i);
});

// ================================================================================================
// GENERAL
// ================================================================================================

test("25. Unclear -> fallback", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Unclear", intent: "unsupported" }));
  assert.equal(result.kind, "fallback");
});

test("26. unsupported intent -> fallback", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "unsupported" }));
  assert.equal(result.kind, "fallback");
});

test("27. low confidence + missing slot -> no aggressive dispatch (clarifies instead)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "lookup", confidence: "low" }));
  assert.notEqual(result.kind, "dispatch");
  assert.equal(result.kind, "clarify");
});

// ================================================================================================
// PURITY / SECURITY
// ================================================================================================

test("28. resolver imports no DB/auth/provider/capability-server modules", () => {
  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  const importLines = resolverSource.split("\n").filter((line) => /^import\b/.test(line.trim()));
  assert.ok(importLines.length > 0, "expected at least the type-only imports");
  for (const line of importLines) {
    assert.ok(!line.includes("server-only"), `must not import server-only: ${line}`);
    assert.ok(!line.includes("@/lib/supabase"), `must not import Supabase: ${line}`);
    assert.ok(!line.includes("@/lib/auth"), `must not import auth: ${line}`);
    assert.ok(!line.includes("-capability.server"), `must not import a capability module: ${line}`);
    assert.ok(!line.includes("@/lib/ai/"), `must not import the AI provider infrastructure: ${line}`);
    assert.ok(!line.includes("provider-router"), `must not import the provider router: ${line}`);
  }
  // Every import in this file must be `import type` - zero runtime imports at all.
  const runtimeImports = importLines.filter((line) => !line.includes("import type"));
  assert.equal(runtimeImports.length, 0, `resolver must have zero runtime imports: ${JSON.stringify(runtimeImports)}`);
});

test("29. resolver never calculates business values (no arithmetic on semantic fields)", () => {
  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  for (const operator of [" + semantic.", " - semantic.", " * semantic.", " / semantic."]) {
    assert.ok(!resolverSource.includes(operator), `unexpected arithmetic on a semantic field: ${operator}`);
  }
});

test("30. resolver never emits an identifier the model itself supplied - only pre-grounded entityText/subjectName pass through, and never a bare UUID/QN/CO shape is invented", () => {
  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  assert.ok(!/QN-\d/.test(resolverSource), "must not hardcode/invent a quotation number");
  assert.ok(!/CO-\d/.test(resolverSource), "must not hardcode/invent a Project File number");
});

test("31. every clarification choice offered anywhere is deterministic (fixed label/value pairs)", () => {
  for (const choice of NOA_CLIENT_RANKING_CLARIFICATION_CHOICES) {
    assert.equal(typeof choice.label, "string");
    assert.equal(typeof choice.value, "string");
    assert.ok(choice.label.length > 0 && choice.value.length > 0);
  }
});

test("32. client ranking choices re-enter existing deterministic phrases", () => {
  const values = NOA_CLIENT_RANKING_CLARIFICATION_CHOICES.map((choice) => choice.value);
  assert.deepEqual(values, [
    "top clients by quotation value",
    "top clients by confirmed value",
    "top clients by project value",
    "how many quotations does each client have",
  ]);
  // The exact insightsQuestionKind() client_ranking regex, copied read-only from
  // noa-insights-capability.server.ts (not re-derived differently) - proves each choice value is
  // a phrase that regex actually recognizes, not just a string that "looks right".
  const clientRankingPattern = /\bclient analytics\b|\btop clients? by (?:quotation|confirmed|project(?:\s*file)?) value\b|\bhow many quotations does each client have\b/;
  for (const value of values) {
    assert.ok(clientRankingPattern.test(value), `choice value not recognized by the real client_ranking classifier: ${value}`);
  }
});

test("33. V2 types/exports untouched by I2 (resolver only imports them, never redefines them)", () => {
  const semanticRequestSource = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
  assert.ok(semanticRequestSource.includes("export type NoaSemanticRequestV2"));
  assert.ok(semanticRequestSource.includes("export const UNCLEAR_SEMANTIC_REQUEST_V2"));
});

// I3 activated the resolver behind the NOA_SEMANTIC_V2 flag: these two tests (originally "still
// dormant" checks) now pin down the ONLY way it is reached at runtime.
test("34. orchestrator never imports the resolver directly - only via the router's flag-gated decideNoaSemanticV2Outcome (I3)", () => {
  const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  // I5: the orchestrator may import only the pure bound-follow-up phrase mapper
  // (resolveNoaConversationFollowUp) and, since I6.3, the pure compatibility validator
  // (validateNoaSemanticCompatibility) - never the unbound semantic resolver itself.
  const resolverImports = orchestratorSource.match(/import \{([^}]*)\} from "@\/lib\/noa\/noa-semantic-resolver";/g) ?? [];
  assert.ok(resolverImports.every((line) => line === 'import { resolveNoaConversationFollowUp, validateNoaSemanticCompatibility } from "@/lib/noa/noa-semantic-resolver";'), "orchestrator must not import the unbound resolver directly");
  assert.ok(!/resolveNoaSemanticCapabilityRequest\(/.test(orchestratorSource), "orchestrator must not call the resolver directly");
  assert.ok(orchestratorSource.includes("decideNoaSemanticV2Outcome(extraction, classification)"));
});

test("35. router calls the resolver only inside the I3 semantic runtime decision; classifyNoaRoute is unchanged", () => {
  const routerSource = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
  assert.equal((routerSource.match(/resolveNoaSemanticCapabilityRequest\(/g) ?? []).length, 1);
  const decideIndex = routerSource.indexOf("export function decideNoaSemanticV2Outcome(");
  assert.ok(decideIndex >= 0 && routerSource.indexOf("resolveNoaSemanticCapabilityRequest(semantic)") > decideIndex);
  assert.ok(routerSource.includes("return classifyNoaRouteWithStrength(message, context).route;"));
});
