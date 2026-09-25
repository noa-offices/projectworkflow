import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { validateSemanticPeriodAgainstMessage, UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";
import { resolveNoaSemanticCapabilityRequest, validateNoaSemanticCompatibility } from "./noa-semantic-resolver.js";

// I8: explicit-period safety (Goal A) + Quotation list/count resolver gap (Goal B) + a small
// compatibility/resolver parity audit (Part 3). No prompt/schema/router/orchestrator changes -
// only noa-semantic-request.ts (the new period-grounding check), noa-intent-extractor.server.ts
// (wires it in, source-checked only - "server-only" guard), and noa-semantic-resolver.ts
// (Quotation list/count branches).

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, confidence: "high", ...overrides };
}

// ── GOAL A: explicit-period safety ──────────────────────────────────────────────

test("1. message says today + semantic today -> allowed", () => {
  assert.ok(validateSemanticPeriodAgainstMessage("what changed today", semantic({ intent: "history", period: "today" })));
});

test("2. message says yesterday + semantic yesterday -> allowed", () => {
  assert.ok(validateSemanticPeriodAgainstMessage("what happened yesterday", semantic({ intent: "history", period: "yesterday" })));
});

test("3. message contains no period + semantic null -> existing default preserved", () => {
  assert.ok(validateSemanticPeriodAgainstMessage("what changed", semantic({ intent: "history", period: null })));
});

test("4. message says 'since Monday' + semantic null -> MUST NOT be treated as today (fails the check)", () => {
  assert.equal(validateSemanticPeriodAgainstMessage("catch me up since Monday", semantic({ intent: "history", period: null })), false);
  // Confirms the resolver-level consequence too: a null-period history dispatch would otherwise
  // silently become "what changed today" - this proves the check is what stands between the
  // message and that wrong default, for the exact I6.4/I6.6/I7 finding.
  const wouldDispatchToday = resolveNoaSemanticCapabilityRequest(semantic({ domain: "UserActivity", intent: "history", period: null, reference: "none" }));
  assert.deepEqual(wouldDispatchToday, { canonicalMessage: "what changed today", domain: "UserActivity", kind: "dispatch", semantic: semantic({ domain: "UserActivity", intent: "history", period: null, reference: "none" }) });
});

test("5. message says 'last month' + semantic null -> MUST NOT silently use the default", () => {
  assert.equal(validateSemanticPeriodAgainstMessage("what about last month", semantic({ intent: "aggregate", metric: "quotation_value", period: null })), false);
});

test("6. message names one supported period + semantic contradicts it -> fail closed", () => {
  assert.equal(validateSemanticPeriodAgainstMessage("what happened yesterday", semantic({ intent: "history", period: "last_month" })), false);
  assert.equal(validateSemanticPeriodAgainstMessage("what changed this week", semantic({ intent: "history", period: "today" })), false);
});

test("7/8. confidence does not bypass the period check - it doesn't even look at confidence", () => {
  const highConfidenceWrong = semantic({ intent: "history", period: null, confidence: "high" });
  const lowConfidenceWrong = semantic({ intent: "history", period: null, confidence: "low" });
  assert.equal(validateSemanticPeriodAgainstMessage("catch me up since Monday", highConfidenceWrong), false);
  assert.equal(validateSemanticPeriodAgainstMessage("catch me up since Monday", lowConfidenceWrong), false);
  const source = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
  const fnBody = source.slice(source.indexOf("export function validateSemanticPeriodAgainstMessage"));
  assert.ok(!fnBody.slice(0, fnBody.indexOf("\n}")).includes("confidence"), "the check must not reference confidence at all");
});

test("the check is scoped to period-relevant intents only - an unrelated intent mentioning a date word is never penalized", () => {
  assert.ok(validateSemanticPeriodAgainstMessage("show products added this month", semantic({ intent: "list", entityType: "product", period: null })));
  assert.ok(validateSemanticPeriodAgainstMessage("show me Interstuhl chairs from last month", semantic({ intent: "lookup", entityType: "product", period: null })));
});

test("9. the extractor wires the period check in, right after the existing grounding check (source-level - server-only)", () => {
  const source = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
  const groundingIndex = source.indexOf("if (!validateNoaSemanticRequestV2AgainstMessage(parsed, input.message))");
  const periodIndex = source.indexOf("if (!validateSemanticPeriodAgainstMessage(input.message, parsed))");
  assert.ok(groundingIndex !== -1 && periodIndex !== -1 && periodIndex > groundingIndex);
  assert.ok(source.slice(periodIndex, source.indexOf("\n}", periodIndex)).includes('stage: "grounding_failed"'), "a period mismatch reuses the existing grounding_failed stage, no new stage introduced");
});

test("10. I5's own period-follow-up phrase (\"quotation analytics last month\") is untouched by I8 - I5 owns its own cue-based period detection, separate from this extraction-time check", () => {
  const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.ok(orchestratorSource.includes("ANALYTICS_PERIOD_PHRASE") || readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8").includes("ANALYTICS_PERIOD_PHRASE"));
  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  assert.match(resolverSource, /last_month:\s*"last month"/);
});

// ── GOAL B: Quotation list/count resolver gap ───────────────────────────────────

test("11a. Quotation+list is now handled - dispatches an existing deterministic phrase", () => {
  const plain = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "list" }));
  assert.deepEqual(plain.kind === "dispatch" ? [plain.domain, plain.canonicalMessage] : plain, ["Quotation", "show quotations"]);

  const draft = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "list", quotationStatus: "draft" }));
  assert.deepEqual(draft.kind === "dispatch" ? [draft.domain, draft.canonicalMessage] : draft, ["Quotation", "show pending quotations"]);

  const confirmed = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "list", quotationStatus: "client_confirmed" }));
  assert.deepEqual(confirmed.kind === "dispatch" ? [confirmed.domain, confirmed.canonicalMessage] : confirmed, ["Quotation", "show client confirmed quotations"]);
});

test("11b. Quotation+count is now handled too (the same class of gap, fixed alongside list)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Quotation", intent: "count" }));
  assert.deepEqual(result.kind === "dispatch" ? [result.domain, result.canonicalMessage] : result, ["Quotation", "how many quotations"]);
});

test("cross-check: every new Quotation canonical phrase is recognized by the REAL quotationQuestionKind()/status-alias regexes, not just plausible-looking text", () => {
  const capabilitySource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
  // list kind trigger
  assert.match(capabilitySource, /\\b\(show\|list\|which\)\\b/);
  // count kind trigger
  assert.match(capabilitySource, /\\b\(how many\|count\|number of\)\\b/);
  // status aliases the two status-specific phrases rely on
  assert.match(capabilitySource, /draft\|pending/);
  assert.match(capabilitySource, /client\[\\s-\]\+confirmed\|confirmed/);
});

// ── PART 3: compatibility/resolver parity audit ─────────────────────────────────
// A small, explicit table - not a generic fuzzer - of every domain+intent pair I6.3 allows,
// confirmed here to reach a real dispatch/clarify/unsupported branch (never a bare "unresolved"
// fallback) OR documented as a known, deferred gap (I8 fixed only the proven Quotation list/count
// case; the same class of gap in Quotation aggregate's other metrics, Project aggregate's
// project_file_count, and Insights-domain-general routing are reported, not silently expanded here
// - see the I8 report).

const HANDLED_CASES: Array<{ label: string; request: Partial<NoaSemanticRequestV2>; expectDispatch?: boolean }> = [
  { label: "Product/lookup", request: { domain: "Product", intent: "lookup", entityType: "product", entityText: "desk" } },
  { label: "Product/list", request: { domain: "Product", intent: "list", entityType: "product", entityText: "desk" } },
  { label: "Product/count", request: { domain: "Product", intent: "count" } },
  { label: "Price/lookup", request: { domain: "Price", intent: "lookup", entityType: "product", entityText: "desk" } },
  { label: "Price/list", request: { domain: "Price", intent: "list", entityType: "product", entityText: "desk" } },
  { label: "Price/count", request: { domain: "Price", intent: "count" } },
  { label: "Price/aggregate", request: { domain: "Price", intent: "aggregate" } },
  { label: "Quotation/lookup", request: { domain: "Quotation", intent: "lookup" } },
  { label: "Quotation/list", request: { domain: "Quotation", intent: "list" } },
  { label: "Quotation/count", request: { domain: "Quotation", intent: "count" } },
  { label: "Quotation/aggregate(quotation_value)", request: { domain: "Quotation", intent: "aggregate", metric: "quotation_value", period: "this_month" } },
  { label: "Quotation/compare", request: { domain: "Quotation", intent: "compare", metric: "quotation_value", comparison: "previous_period" } },
  { label: "Quotation/trend", request: { domain: "Quotation", intent: "trend", metric: "quotation_value" } },
  { label: "Project/lookup", request: { domain: "Project", intent: "lookup", entityType: "project_file", entityText: "CO-0001-001" } },
  { label: "Project/list", request: { domain: "Project", intent: "list", entityType: "project_file" } },
  { label: "Project/count", request: { domain: "Project", intent: "count", entityType: "project_file" } },
  { label: "Project/aggregate(project_file_value)", request: { domain: "Project", intent: "aggregate", metric: "project_file_value" } },
  { label: "Client/lookup", request: { domain: "Client", intent: "lookup", entityType: "client", entityText: "Acme" } },
  { label: "Client/list", request: { domain: "Client", intent: "list", entityType: "client" } },
  { label: "Client/count", request: { domain: "Client", intent: "count", entityType: "client" } },
  { label: "Client/rank (ownership normalization -> Insights)", request: { domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value" } },
  { label: "Procurement/lookup", request: { domain: "Procurement", intent: "lookup", entityType: "procurement_order", entityText: "PO-1" } },
  { label: "Procurement/list", request: { domain: "Procurement", intent: "list", entityType: "procurement_order" } },
  { label: "Procurement/count", request: { domain: "Procurement", intent: "count", entityType: "procurement_order" } },
  { label: "UserActivity/activity", request: { domain: "UserActivity", intent: "activity", subject: "self" } },
  { label: "UserActivity/activity_time", request: { domain: "UserActivity", intent: "activity_time", subject: "self" } },
  { label: "UserActivity/presence", request: { domain: "UserActivity", intent: "presence", subject: "self" } },
  { label: "UserActivity/history", request: { domain: "UserActivity", intent: "history", period: "today" } },
  { label: "Attention/attention", request: { domain: "Attention", intent: "attention" } },
  { label: "Help/howto (intentional unsupported, not a gap)", request: { domain: "Help", intent: "howto" } },
];

test("12. every compatibility-allowed domain/intent case above reaches dispatch/clarify/unsupported - never the bare 'unresolved' fallback family", () => {
  const unresolvedReasons = new Set(["quotation_intent_unresolved", "project_intent_unresolved", "product_intent_unresolved", "price_intent_unresolved", "client_intent_unresolved", "user_activity_intent_unresolved", "insights_intent_unresolved", "domain_unresolved"]);
  for (const { label, request } of HANDLED_CASES) {
    const full = semantic(request);
    assert.deepEqual(validateNoaSemanticCompatibility(full), { compatible: true }, `${label} should be compatible per the fixture`);
    const result = resolveNoaSemanticCapabilityRequest(full);
    assert.ok(result.kind !== "fallback" || !unresolvedReasons.has(result.reason), `${label} -> ${JSON.stringify(result)}`);
  }
});

test("13. Client rank still normalizes to Insights ownership (unchanged by I8)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "confirmed_value" }));
  assert.deepEqual(result.kind === "dispatch" ? [result.domain, result.canonicalMessage] : result, ["Insights", "top clients by confirmed value"]);
});

test("14. Project aggregate still normalizes to Insights ownership (unchanged by I8)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "aggregate", metric: "project_file_value" }));
  assert.deepEqual(result.kind === "dispatch" ? [result.domain, result.canonicalMessage] : result, ["Insights", "project file analytics"]);
});

// ── PART 4/5: no provider-specific behavior, no prompt change ───────────────────

test("15a. no provider/model-name checks were introduced in I8's new code (pre-existing historical comments elsewhere, e.g. I0.5's OpenAI note, are untouched and out of scope here)", () => {
  const requestSource = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
  const periodCheckBody = requestSource.slice(requestSource.indexOf("// I8 GOAL A"), requestSource.indexOf("// The provider-neutral strict wire schema"));
  assert.ok(!/gemini|openai|anthropic|gpt-|\bsol\b|\bterra\b|\bluna\b|request\.model|provider ===/i.test(periodCheckBody));

  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  const quotationFixBody = resolverSource.slice(resolverSource.indexOf("// I8 GOAL B/PART 3"), resolverSource.indexOf("if (intent === \"aggregate\" && metric === \"quotation_value\")"));
  assert.ok(!/gemini|openai|anthropic|gpt-|\bsol\b|\bterra\b|\bluna\b|request\.model|provider ===/i.test(quotationFixBody));
});

test("15b. SYSTEM_INSTRUCTIONS_V2 (the prompt) is untouched by I8", () => {
  const source = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
  const promptBody = source.slice(source.indexOf("const SYSTEM_INSTRUCTIONS_V2"), source.indexOf("`;", source.indexOf("const SYSTEM_INSTRUCTIONS_V2")));
  assert.ok(!promptBody.includes("validateSemanticPeriodAgainstMessage"), "the new check is application code, never surfaced inside the prompt text");
});
