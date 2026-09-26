import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindNoaConversationFollowUp,
  buildNoaInsightsConversationReference,
  buildNoaReferenceDiagnostics,
  detectNoaFollowUpCues,
  isNoaConversationFollowUpCandidate,
  isNoaConversationReference,
  MAX_CONVERSATION_REFERENCE_ENTITIES,
  noaCurrentPageEntity,
  sanitizeNoaConversationReference,
  type NoaConversationReference,
  type NoaFollowUpBinding,
  type NoaPageEntity,
} from "./noa-conversation-reference.js";
import { resolveNoaConversationFollowUp, resolveNoaSemanticCapabilityRequest, type NoaFollowUpResolution } from "./noa-semantic-resolver.js";
import {
  classifyNoaRouteWithStrength,
  decideNoaSemanticV2Outcome,
  isNoaGenericSemanticCandidate,
  isNoaSemanticV2FlagEnabled,
  noaSemanticV2Eligibility,
  type NoaRouteClassification,
} from "./noa-intent-router.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";
import type { NoaPageContext } from "./noa-types.js";

// I5: conversation intelligence. The binder (noa-conversation-reference.ts) and the bound-phrase
// resolver (noa-semantic-resolver.ts) are pure and executed directly; the orchestrator
// ("server-only" + "@/..." aliases) is checked at source level, like every other lib/noa safety test.

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const referenceSource = readFileSync("lib/noa/noa-conversation-reference.ts", "utf8");
const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
const extractorSource = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const insightsSource = readFileSync("lib/noa/noa-insights-capability.server.ts", "utf8");
const quotationSource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const userActivitySource = readFileSync("lib/noa/noa-user-activity-capability.server.ts", "utf8");
const coreStart = orchestrator.indexOf("async function runNoaOrchestratorCore(");
const coreBody = orchestrator.slice(coreStart, orchestrator.indexOf("export async function runNoaOrchestrator(", coreStart));
const i5Section = orchestrator.slice(orchestrator.indexOf("// I5: conversation intelligence (flag-gated"), coreStart);

// Mirrors of the capabilities' own identifier parsers (the orchestrator injects the real ones).
function isIdentifierLabel(entityType: "quotation" | "project_file", label: string): boolean {
  return entityType === "quotation" ? /^QN-\d{3,}(?:-\d+)*$/i.test(label) : /^CO-\d{3,}(?:-\d+)*$/i.test(label);
}

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, ...overrides };
}

// Verbatim shapes returned by the live V2 classifier during I5 smoke testing (context-free, so
// mostly LOW confidence) - the deterministic binder has to work with exactly these.
const LIVE = {
  whichClientSecond: semantic({ domain: "Client", intent: "rank", reference: "previous_result", ordinal: 2, needsClarification: true, clarificationReason: "missing_metric", confidence: "low" }),
  howMuchConfirm: semantic({ domain: "Quotation", intent: "aggregate", metric: "confirmed_value", quotationStatus: "client_confirmed", needsClarification: true, clarificationReason: "ambiguous_reference", confidence: "low" }),
  whatAboutLastMonth: semantic({ domain: "Insights", intent: "aggregate", reference: "previous_result", period: "last_month", confidence: "low" }),
  whatAboutConfirmedValue: semantic({ domain: "Unclear", intent: "aggregate", reference: "previous_result", metric: "confirmed_value", quotationStatus: "client_confirmed", confidence: "low" }),
  showThirdOne: semantic({ domain: "Product", intent: "lookup", reference: "previous_result", ordinal: 3, confidence: "high" }),
  whatsMissingHere: semantic({ domain: "Project", intent: "attention", reference: "current_page", needsClarification: true, clarificationReason: "ambiguous_reference", confidence: "low" }),
  howMuchWorth: semantic({ domain: "Unclear", intent: "aggregate", needsClarification: true, clarificationReason: "missing_entity", confidence: "low" }),
};

const RANKING: NoaConversationReference = buildNoaInsightsConversationReference({
  deterministicOnly: true,
  deterministicText: "Top clients by quotation value ...",
  kind: "insights_client_ranking",
  metric: "quotation_value",
  rankings: [{ currency: "AED", rows: [
    { clientName: "Apex Interiors", value: 900 },
    { clientName: "Blue Harbour", value: 700 },
    { clientName: "Cedar Group", value: 500 },
    { clientName: "Dune Studio", value: 100 },
  ] }],
})!;
const SELECTED_CLIENT: NoaConversationReference = { domain: "Client", entities: [{ label: "Blue Harbour", type: "client" }], intent: "client_lookup" };
const ANALYTICS: NoaConversationReference = buildNoaInsightsConversationReference({ deterministicText: "...", kind: "insights_quotation_analytics", range: "this_month", totalMatching: 3 })!;
const PROJECT_FILE: NoaConversationReference = { domain: "Project", entities: [{ label: "CO-0003-001", type: "project_file" }, { label: "Marina Tower", type: "reference" }], intent: "project_lookup" };
const QUOTATION: NoaConversationReference = { domain: "Quotation", entities: [{ label: "QN-0005-001", type: "quotation" }], intent: "quotation_lookup" };
const PRODUCTS: NoaConversationReference = { domain: "Product", entities: [{ label: "Alpha Chair", type: "product" }, { label: "Beta Desk", type: "product" }, { label: "Gamma Stool", type: "product" }], intent: "product_lookup" };

function follow(
  message: string,
  reference: NoaConversationReference | undefined,
  classified: NoaSemanticRequestV2 | null,
  pageEntity: NoaPageEntity | null = null,
): { binding: NoaFollowUpBinding; resolution: NoaFollowUpResolution | null } {
  const binding = bindNoaConversationFollowUp({ cues: detectNoaFollowUpCues(message), isIdentifierLabel, pageEntity, reference, semantic: classified });
  return { binding, resolution: resolveNoaConversationFollowUp(binding) };
}

function dispatchOf(result: { resolution: NoaFollowUpResolution | null }) {
  assert.equal(result.resolution?.kind, "dispatch", JSON.stringify(result));
  return result.resolution as Extract<NoaFollowUpResolution, { kind: "dispatch" }>;
}

function answerOf(result: { resolution: NoaFollowUpResolution | null }) {
  assert.equal(result.resolution?.kind, "answer", JSON.stringify(result));
  return result.resolution as Extract<NoaFollowUpResolution, { kind: "answer" }>;
}

// ── REFERENCE CREATION (1-6) ──────────────────────────────────────────────────

test("1. a quotation detail result creates a useful quotation reference (QN label only) that binds 'How much is it worth?'", () => {
  const builder = orchestrator.slice(orchestrator.indexOf("function buildQuotationConversationReference("), orchestrator.indexOf("// C4A: ordinal list-selection follow-up"));
  assert.ok(builder.includes("record.quotationNo") && builder.includes('type: "quotation"'));
  assert.ok(isNoaConversationReference(QUOTATION));
  const result = dispatchOf(follow("How much is it worth?", QUOTATION, LIVE.howMuchWorth));
  assert.deepEqual(result, { canonicalMessage: "what is QN-0005-001 worth", domain: "Quotation", kind: "dispatch" });
  // The canonical phrase is read by the Quotation capability's own structured parser as "total".
  assert.ok(quotationSource.includes("request: /\\b(worth|value|total)\\b/.test(normalized)"));
});

test("2. a Project File detail result creates a project_file reference; the secondary 'reference' label is never bound as the entity", () => {
  const builder = orchestrator.slice(orchestrator.indexOf("function buildProjectConversationReference("), orchestrator.indexOf("// C4C: resolves a Client follow-up"));
  assert.ok(builder.includes('type: "project_file"') && builder.includes(".orderNo"));
  assert.ok(isNoaConversationReference(PROJECT_FILE));
  const binding = follow("What changed on it?", PROJECT_FILE, null).binding;
  assert.deepEqual(binding, { entityType: "project_file", kind: "entity_history", label: "CO-0003-001", source: "single_entity" });
});

test("3. a client result creates a client reference (safe display name only) that pronoun follow-ups can bind", () => {
  const builder = orchestrator.slice(orchestrator.indexOf("function buildClientConversationReference("), orchestrator.indexOf("// C4C: resolves a Procurement follow-up"));
  assert.ok(builder.includes(".name") && !builder.includes("client.id"));
  assert.equal(follow("How much did they confirm?", SELECTED_CLIENT, LIVE.howMuchConfirm).binding.kind, "client_metric");
});

test("4. client ranking preserves the ordered client entities from structured data only (never text, values, ids, or ambiguous lists)", () => {
  assert.deepEqual(RANKING, {
    domain: "Insights",
    entities: [
      { label: "Apex Interiors", type: "client" },
      { label: "Blue Harbour", type: "client" },
      { label: "Cedar Group", type: "client" },
      { label: "Dune Studio", type: "client" },
    ],
    intent: "client_ranking",
    metric: "quotation_value",
    resultCount: 4,
  });
  assert.ok(isNoaConversationReference(RANKING));
  // quotation_count ranking: one ordered list, 10 rows -> first 5 stored, resultCount keeps the truth.
  const counted = buildNoaInsightsConversationReference({
    kind: "insights_client_ranking",
    metric: "quotation_count",
    rows: Array.from({ length: 10 }, (_, index) => ({ clientName: `Client ${String.fromCharCode(65 + index)}`, count: 10 - index })),
  })!;
  assert.equal(counted.entities?.length, MAX_CONVERSATION_REFERENCE_ENTITIES);
  assert.equal(counted.resultCount, 10);
  assert.equal(counted.metric, "quotation_count");
  // Multi-currency ranking: no single ordered list -> NO entities (an ordinal must clarify).
  const multiCurrency = buildNoaInsightsConversationReference({
    kind: "insights_client_ranking",
    metric: "confirmed_value",
    rankings: [{ currency: "AED", rows: [{ clientName: "A", value: 1 }] }, { currency: "USD", rows: [{ clientName: "B", value: 2 }] }],
  })!;
  assert.equal(multiCurrency.entities, undefined);
  assert.equal(multiCurrency.resultCount, 2);
  // A raw-id fallback name (capability uses client_id when a name is missing) -> NO entities.
  const idFallback = buildNoaInsightsConversationReference({
    kind: "insights_client_ranking",
    metric: "quotation_value",
    rankings: [{ currency: "AED", rows: [{ clientName: "Apex", value: 2 }, { clientName: "0b7c9f7e-1a2b-4c3d-8e9f-001122334455", value: 1 }] }],
  })!;
  assert.equal(idFallback.entities, undefined);
  // The ranking capability's own structured data shape is what is read.
  assert.ok(insightsSource.includes('data: { kind: "insights_client_ranking", metric, rows, deterministicOnly: true, deterministicText }'));
  assert.ok(insightsSource.includes("rankings: rankings.map((group) => ({ currency: group.currency, rows: group.rows })),"));
});

test("5. a product list keeps its ordered product entities and 'Show me the third one' binds the third product", () => {
  const builder = orchestrator.slice(orchestrator.indexOf("function buildProductConversationReference("), orchestrator.indexOf("// C4D: resolves a pronoun-only Price follow-up"));
  assert.ok(builder.includes('record.kind === "product_list"'));
  assert.deepEqual(dispatchOf(follow("Show me the third one", PRODUCTS, LIVE.showThirdOne)), { canonicalMessage: "product Gamma Stool", domain: "Product", kind: "dispatch" });
});

test("6. an Insights reference carries intent/metric/period as closed enums", () => {
  assert.deepEqual(ANALYTICS, { analyticsPeriod: "this_month", domain: "Insights", intent: "quotation_analytics" });
  assert.equal(buildNoaInsightsConversationReference({ kind: "insights_quotation_analytics", range: "7d" })?.analyticsPeriod, "last_7_days");
  assert.equal(buildNoaInsightsConversationReference({ kind: "insights_quotation_analytics", range: "30d" })?.analyticsPeriod, undefined);
  assert.equal(RANKING.metric, "quotation_value");
  assert.equal(buildNoaInsightsConversationReference({ kind: "insights_quotation_trend", months: [] }), undefined);
  assert.ok(orchestrator.includes('semanticV2FlagEnabled && domain === "Insights"\n      ? buildNoaInsightsConversationReference(capabilityResult.data)'));
});

// ── ORDINAL (7-10) ────────────────────────────────────────────────────────────

test("7. 'Which client is second?' binds the SECOND ranked client deterministically (low-confidence model, deterministic ordinal)", () => {
  assert.deepEqual(follow("Which client is second?", RANKING, LIVE.whichClientSecond).binding, { entityType: "client", kind: "entity_detail", label: "Blue Harbour", source: "ordinal" });
  assert.deepEqual(dispatchOf(follow("Which client is second?", RANKING, LIVE.whichClientSecond)), { canonicalMessage: "tell me about client Blue Harbour", domain: "Client", kind: "dispatch" });
  // Every position word/shape resolves to the same deterministic index.
  for (const [message, label] of [["the 3rd one", "Cedar Group"], ["number 1", "Apex Interiors"], ["first one please", "Apex Interiors"], ["which is fourth", "Dune Studio"]] as const) {
    assert.equal((follow(message, RANKING, null).binding as { label?: string }).label, label, message);
  }
  // The model's ordinal can only veto (disagreement -> clarify), never select.
  assert.deepEqual(follow("Which client is second?", RANKING, semantic({ ordinal: 3, confidence: "high" })).binding, { kind: "clarify", reason: "ordinal_conflict" });
});

test("8. 'last' binds only when the stored list is provably the whole result", () => {
  assert.equal((follow("the last one", RANKING, null).binding as { label?: string }).label, "Dune Studio");
  const truncated = buildNoaInsightsConversationReference({ kind: "insights_client_ranking", metric: "quotation_count", rows: Array.from({ length: 8 }, (_, index) => ({ clientName: `C${index}`, count: 1 })) })!;
  assert.deepEqual(follow("the last one", truncated, null).binding, { count: 5, kind: "clarify", reason: "ordinal_beyond_stored" });
  // A 5-item list with no resultCount (a legacy builder) could be truncated -> never guessed.
  const fiveQuotations: NoaConversationReference = { domain: "Quotation", entities: ["QN-0001", "QN-0002", "QN-0003", "QN-0004", "QN-0005"].map((label) => ({ label, type: "quotation" })), intent: "quotation_lookup" };
  assert.equal(follow("the last one", fiveQuotations, null).binding.kind, "clarify");
  // "last month"/"last 7 days" is a period, never an ordinal.
  assert.equal(detectNoaFollowUpCues("What about last month?").ordinal, null);
  assert.equal(detectNoaFollowUpCues("last 7 days").ordinal, null);
  assert.equal(detectNoaFollowUpCues("first quarter").ordinal, null);
});

test("9. an out-of-range ordinal is a deterministic clarification, never a guess", () => {
  const result = follow("Which client is seventh?", RANKING, null);
  assert.deepEqual(result.binding, { count: 4, kind: "clarify", reason: "ordinal_out_of_range" });
  assert.equal(answerOf(result).text, "There were only 4 items in the previous result. Choose 1, 2, 3, or 4.");
  const counted = buildNoaInsightsConversationReference({ kind: "insights_client_ranking", metric: "quotation_count", rows: Array.from({ length: 8 }, (_, index) => ({ clientName: `C${index}`, count: 1 })) })!;
  assert.deepEqual(follow("the seventh one", counted, null).binding, { count: 5, kind: "clarify", reason: "ordinal_beyond_stored" });
  assert.deepEqual(follow("the tenth one", counted, null).binding, { count: 8, kind: "clarify", reason: "ordinal_out_of_range" });
  const multiCurrency = buildNoaInsightsConversationReference({ kind: "insights_client_ranking", metric: "quotation_value", rankings: [{ currency: "AED", rows: [{ clientName: "A", value: 1 }] }, { currency: "USD", rows: [{ clientName: "B", value: 1 }] }] })!;
  assert.equal((follow("Which client is second?", multiCurrency, LIVE.whichClientSecond).binding as { reason?: string }).reason, "ordinal_unavailable");
});

test("10. an ordinal naming a different entity type never binds across types", () => {
  const result = follow("show me the second quotation", RANKING, null);
  assert.deepEqual(result.binding, { kind: "clarify", reason: "entity_type_mismatch", referenceType: "client", requestedType: "quotation" });
  assert.equal(answerOf(result).text, "The previous result listed clients, not quotations. Which quotation do you mean?");
  assert.equal(follow("the second client", PRODUCTS, null).binding.kind, "clarify");
  // High-confidence model entityType is also respected (still no coercion).
  assert.equal((follow("the second one", PRODUCTS, semantic({ entityType: "client", ordinal: 2, confidence: "high" })).binding as { reason?: string }).reason, "entity_type_mismatch");
});

// ── PRONOUN (11-13) ───────────────────────────────────────────────────────────

test("11. a single selected client + 'they' binds that client for the confirmed-value question", () => {
  assert.deepEqual(dispatchOf(follow("How much did they confirm?", SELECTED_CLIENT, LIVE.howMuchConfirm)), {
    canonicalMessage: "total confirmed quotation value for client Blue Harbour",
    domain: "Quotation",
    kind: "dispatch",
  });
  // A ranking that ended up with exactly one client is equally unambiguous.
  const single = { ...RANKING, entities: [{ label: "Apex Interiors", type: "client" }], resultCount: 1 };
  assert.equal(dispatchOf(follow("How much did they confirm?", single, LIVE.howMuchConfirm)).canonicalMessage, "total confirmed quotation value for client Apex Interiors");
});

test("12. several unselected clients + 'they' clarifies (with deterministic choices), never guesses", () => {
  const result = follow("How much did they confirm?", RANKING, LIVE.howMuchConfirm);
  const answer = answerOf(result);
  assert.equal(result.binding.kind, "clarify");
  assert.match(answer.text, /^The previous result had 4 clients\. Which one do you mean\?/);
  assert.deepEqual(answer.choices?.map((choice) => choice.value), [
    "total confirmed quotation value for client Apex Interiors",
    "total confirmed quotation value for client Blue Harbour",
    "total confirmed quotation value for client Cedar Group",
    "total confirmed quotation value for client Dune Studio",
    "top clients by confirmed value",
  ]);
});

test("13. a single Project File + 'it' binds that Project File", () => {
  assert.deepEqual(dispatchOf(follow("What changed on it?", PROJECT_FILE, null)), { canonicalMessage: "what changed on CO-0003-001", domain: "UserActivity", kind: "dispatch" });
  const two: NoaConversationReference = { domain: "Project", entities: [{ label: "CO-0003-001", type: "project_file" }, { label: "CO-0004-001", type: "project_file" }], intent: "project_lookup" };
  assert.equal((follow("What changed on it?", two, null).binding as { reason?: string }).reason, "ambiguous_entity");
});

// ── HISTORY (14-15) ───────────────────────────────────────────────────────────

test("14. a CO reference + history -> the scoped Catch-Up phrase (never current-state Project detail)", () => {
  for (const message of ["What changed on it?", "What happened on it?", "what happened to that project", "catch me up on it"]) {
    assert.deepEqual(dispatchOf(follow(message, PROJECT_FILE, null)), { canonicalMessage: "what changed on CO-0003-001", domain: "UserActivity", kind: "dispatch" }, message);
  }
  // The canonical phrase reaches catch_up_project_file in the existing capability classifier.
  assert.ok(userActivitySource.includes("const CATCH_UP_PATTERNS = [/\\bwhat changed\\b/, /\\bwhat happened\\b/, /\\bcatch me up\\b/];"));
  assert.ok(userActivitySource.includes('if (projectFileIdentifierCount(message) > 0) return "catch_up_project_file";'));
  const route = classifyNoaRouteWithStrength("what changed on CO-0003-001", { pathname: "/", section: "dashboard" });
  assert.equal(route.rule, "catch_up");
});

test("15. a QN reference + history -> the scoped quotation Catch-Up phrase", () => {
  for (const message of ["What happened on it?", "What changed on it?"]) {
    assert.deepEqual(dispatchOf(follow(message, QUOTATION, null)), { canonicalMessage: "what changed on QN-0005-001", domain: "UserActivity", kind: "dispatch" }, message);
  }
  assert.ok(userActivitySource.includes('if (quotationIdentifierCount(message) > 0) return "catch_up_quotation";'));
  assert.ok(userActivitySource.indexOf('if (quotationIdentifierCount(message) > 0) return "catch_up_quotation";') < userActivitySource.indexOf('if (projectFileIdentifierCount(message) > 0) return "catch_up_project_file";'));
  assert.ok(i5Section.includes("function resolveQuotationHistoryFollowUp("));
  assert.ok(i5Section.includes('if (reference?.domain !== "Quotation") return undefined;'));
  assert.ok(i5Section.includes('resolution.domain === "UserActivity"'));
  // History is only offered for QN/CO - a client has no entity-scoped Catch-Up.
  assert.equal((follow("What changed on it?", SELECTED_CLIENT, null).binding as { reason?: string }).reason, "history_not_supported_for_type");
  // A label that is not exactly one identifier is never substituted.
  const odd: NoaConversationReference = { domain: "Quotation", entities: [{ label: "QN-0005-001 and QN-0006-001", type: "quotation" }], intent: "quotation_lookup" };
  assert.equal((follow("What changed on it?", odd, null).binding as { reason?: string }).reason, "unsafe_label");
});

// ── PERIOD (16-17) ────────────────────────────────────────────────────────────

test("16. analytics + 'What about last month?' inherits the analytics intent and replaces ONLY the period", () => {
  assert.deepEqual(dispatchOf(follow("What about last month?", ANALYTICS, LIVE.whatAboutLastMonth)), { canonicalMessage: "quotation analytics last month", domain: "Insights", kind: "dispatch" });
  assert.equal(dispatchOf(follow("And this year?", ANALYTICS, semantic({ period: "this_year", reference: "previous_result" }))).canonicalMessage, "quotation analytics this year");
  // The canonical phrases are exactly what the Insights capability's own classifiers read.
  assert.ok(insightsSource.includes("/\\bquotation analytics\\b/.test(normalized)"));
  assert.ok(insightsSource.includes('if (/\\blast month\\b/.test(normalized)) return "last_month";'));
  assert.ok(insightsSource.includes('if (/\\bthis year\\b/.test(normalized)) return "this_year";'));
});

test("17. an unsupported period is never silently coerced", () => {
  // insightsDateRangeKey() would silently default "yesterday"/"this quarter" to this month.
  for (const message of ["How about yesterday?", "what about this quarter", "and last quarter"]) {
    const answer = answerOf(follow(message, ANALYTICS, null));
    assert.match(answer.text, /^Quotation analytics covers/, message);
  }
  assert.equal(answerOf(follow("What about last month?", RANKING, null)).text, "Client rankings cover all recorded quotations - I can't limit them to a time period yet.");
  assert.equal((follow("what about last month", QUOTATION, null).binding as { reason?: string }).reason, "period_not_applicable");
});

// ── METRIC (18-19) ────────────────────────────────────────────────────────────

test("18. client ranking + 'What about confirmed value?' keeps the ranking intent and switches only the metric", () => {
  assert.deepEqual(dispatchOf(follow("What about confirmed value?", RANKING, LIVE.whatAboutConfirmedValue)), { canonicalMessage: "top clients by confirmed value", domain: "Insights", kind: "dispatch" });
  assert.equal(dispatchOf(follow("and by project value?", RANKING, null)).canonicalMessage, "top clients by project value");
  // The ordinal-selected client + a value question binds that client directly.
  assert.equal(dispatchOf(follow("how much did the second one confirm", RANKING, null)).canonicalMessage, "total confirmed quotation value for client Blue Harbour");
});

test("19. an unsupported metric is rejected, never coerced into a ranking", () => {
  const averaged = follow("what about the average", RANKING, semantic({ metric: "average_quotation_value", reference: "previous_result", confidence: "high" }));
  assert.equal(answerOf(averaged).text, "I can't rank clients by that yet - I can compare them by quotation value, client-confirmed value, Project File value, or number of quotations.");
  // At LOW confidence an uncorroborated model metric is not even used.
  assert.equal(follow("what about the average", RANKING, semantic({ metric: "average_quotation_value", confidence: "low" })).binding.kind, "not_applicable");
});

// ── PAGE CONTEXT (20-21) ──────────────────────────────────────────────────────

test("20. an exact Project File page entity (route CO only) may bind; it still dispatches through the normal Catch-Up capability", () => {
  const page = noaCurrentPageEntity("/projects/orders/CO-0003-001", false, (label) => isIdentifierLabel("project_file", label));
  assert.deepEqual(page, { label: "CO-0003-001", type: "project_file" });
  assert.deepEqual(noaCurrentPageEntity("/projects/orders/CO-0003-001%20", false, (label) => isIdentifierLabel("project_file", label)), { label: "CO-0003-001", type: "project_file" });
  assert.deepEqual(dispatchOf(follow("What changed here?", undefined, null, page)), { canonicalMessage: "what changed on CO-0003-001", domain: "UserActivity", kind: "dispatch" });
  // "What's missing here?" - no capability computes "missing": only the two existing paths are offered.
  const missing = answerOf(follow("What's missing here?", undefined, LIVE.whatsMissingHere, page));
  assert.deepEqual(missing.choices, [
    { label: "Show details", value: "project details for CO-0003-001" },
    { label: "What changed", value: "what changed on CO-0003-001" },
  ]);
});

test("21. a generic page section never invents an entity", () => {
  const check = (label: string) => isIdentifierLabel("project_file", label);
  assert.equal(noaCurrentPageEntity("/projects/orders", false, check), null);
  assert.equal(noaCurrentPageEntity("/projects", false, check), null);
  assert.equal(noaCurrentPageEntity("/projects/orders/not-a-co", false, check), null);
  assert.equal(noaCurrentPageEntity("/projects/orders/CO-0003-001/extra", false, check), null);
  assert.equal(noaCurrentPageEntity("/projects/orders/%E0%A4%A", false, check), null);
  assert.equal(answerOf(follow("What changed here?", undefined, null, null)).text, "This page doesn't point to a single quotation or Project File I can use. Which one do you mean?");
  // A quotation record page only has an internal record id (no QN) - clarify, never resolve it here.
  assert.deepEqual(noaCurrentPageEntity("/quotations/abc", true, check), { type: "quotation_record" });
  assert.equal((follow("What changed here?", undefined, null, { type: "quotation_record" }).binding as { reason?: string }).reason, "page_quotation_unavailable");
  // A non-history "here" question without a page entity is left to the existing paths (never a
  // page clarification that could swallow e.g. an Attention paraphrase).
  assert.equal(follow("What's missing here?", undefined, LIVE.whatsMissingHere, null).binding.kind, "not_applicable");
  assert.equal(follow("What's missing here?", undefined, LIVE.whatsMissingHere, { type: "quotation_record" }).binding.kind, "not_applicable");
  // A current page is never used when the message doesn't point at it.
  assert.equal(follow("What changed on it?", PROJECT_FILE, null, { label: "CO-0009-001", type: "project_file" }).binding.kind, "entity_history");
  assert.equal((follow("What changed on it?", PROJECT_FILE, null, { label: "CO-0009-001", type: "project_file" }).binding as { label?: string }).label, "CO-0003-001");
});

// ── SECURITY (22-25) ──────────────────────────────────────────────────────────

test("22. no DB rows, values, currencies, or ids are stored in a reference", () => {
  for (const reference of [RANKING, ANALYTICS]) {
    const serialized = JSON.stringify(reference);
    assert.ok(!/value"\s*:\s*\d|currency|AED|grand_total|client_id|"id"/.test(serialized), serialized);
    assert.deepEqual(Object.keys(reference).filter((key) => !["domain", "intent", "entities", "metric", "analyticsPeriod", "resultCount"].includes(key)), []);
  }
  assert.ok(!/\.from\("|supabase|createClient/i.test(referenceSource));
});

test("23. no auth fields survive the round trip; malformed I5 fields are rejected", () => {
  const tampered = { ...SELECTED_CLIENT, isAdmin: true, role: "system_owner", serviceRole: true, sql: "select 1", table: "clients", userId: "u1" };
  assert.ok(isNoaConversationReference(tampered)); // unknown keys are ignored by the validator...
  assert.deepEqual(sanitizeNoaConversationReference(tampered), SELECTED_CLIENT); // ...and never copied.
  assert.equal(sanitizeNoaConversationReference({ ...RANKING, metric: "profit" }), undefined);
  assert.equal(sanitizeNoaConversationReference({ ...RANKING, resultCount: -1 }), undefined);
  assert.equal(sanitizeNoaConversationReference({ ...RANKING, resultCount: 1.5 }), undefined);
  assert.equal(sanitizeNoaConversationReference({ ...ANALYTICS, analyticsPeriod: "since 2019" }), undefined);
  // The I5 pre-pass only ever reads the sanitized copy.
  assert.ok(coreBody.includes("resolveNoaConversationFollowUpTurn(request, sanitizeNoaConversationReference(request.conversationReference), routeClassification)"));
});

test("24. every bound follow-up still dispatches through the ONE normal capability path (canonical phrase swap only)", () => {
  assert.ok(coreBody.includes("let semanticV2Dispatch: Extract<NoaSemanticV2Decision, { kind: \"dispatch\" }> | undefined = conversationDispatch"));
  assert.ok(coreBody.includes("request = { ...request, message: semanticV2Dispatch.canonicalMessage };"));
  assert.ok(coreBody.includes("message: originalMessage,")); // provider still sees the user's own words
  // No bound follow-up has its own capability call site.
  for (const call of ["await fetchNoaInsightsCapability(", "await fetchNoaQuotationCapability(", "await fetchNoaClientCapability(", "await fetchNoaUserActivityCapability(", "await fetchNoaProjectCapability(", "await fetchNoaProductCapability("]) {
    assert.equal(orchestrator.split(call).length - 1, call.includes("Product") ? 2 : 1, call); // Product: + GPC-3's own configuration start
    assert.ok(!i5Section.includes(call), call);
  }
  // A C4 pronoun rewrite of the raw follow-up can never override the bound canonical phrase.
  assert.ok(coreBody.includes("if (conversationDispatch) {\n    semanticRequest = undefined;\n    projectMessageOverride = undefined;\n    clientMessageOverride = undefined;"));
});

test("25. reference binding never creates a service-role / privileged path and never authorizes", () => {
  for (const source of [referenceSource, resolverSource, i5Section]) {
    assert.ok(!/createAdminClient|service_role|serviceRole|requireActiveUser|requireSystemOwner|requireQuotationActionUser|SUPABASE_SERVICE/i.test(source));
  }
  // The classifier still receives only the message + page section (no reference, label, or prose).
  const v2Body = extractorSource.slice(extractorSource.indexOf("export async function extractNoaSemanticRequestV2("));
  assert.match(v2Body, /userContent: \{\s*message: input\.message,\s*pageContext: \{ section: input\.context\.section \},\s*\}/);
  assert.ok(!/conversationReference|recentMessages/.test(v2Body));
  assert.equal((orchestrator.match(/extractNoaSemanticRequestV2\(/g) ?? []).length, 1);
});

// ── CONFIDENCE (26-27) ────────────────────────────────────────────────────────

test("26. the closed low-confidence client-ranking exception cannot bind an unproven conversation slot", () => {
  const { decision, diagnostics } = decideNoaSemanticV2Outcome(
    { request: semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value", confidence: "low" }), stage: "success" },
    { route: "Help", rule: "unresolved", strength: "none" },
  );
  assert.deepEqual(decision, { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" });
  assert.equal(diagnostics.confidenceOverride, "deterministic_safe_dispatch");
  // "What about them?" has a pronoun but no value cue: a low-confidence model metric can't create one...
  assert.equal(follow("What about them?", SELECTED_CLIENT, semantic({ metric: "confirmed_value", confidence: "low" })).binding.kind, "not_applicable");
  // ...while the same message at HIGH confidence may use the model's metric (entity still chosen here).
  assert.equal(follow("What about them?", SELECTED_CLIENT, semantic({ metric: "confirmed_value", confidence: "high" })).binding.kind, "client_metric");
  // The gate itself never asks the classifier about a bare pronoun question (C4 keeps owning those).
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues("What about them?")), false);
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues("is it active?")), false);
});

test("27. a deterministic clarification is still allowed at low confidence", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    { request: semantic({ domain: "Client", entityType: "client", intent: "rank", needsClarification: true, clarificationReason: "missing_metric", confidence: "low" }), stage: "success" },
    { route: "Help", rule: "unresolved", strength: "none" },
  );
  assert.equal(decision.kind, "answer");
  assert.equal(answerOf(follow("How much did they confirm?", RANKING, LIVE.howMuchConfirm)).domain, "Help");
});

// ── PRODUCT (28-29) ───────────────────────────────────────────────────────────

test("28. Product entityText preserves an explicit qualifier when the extractor grounds the complete phrase", () => {
  const brandOnly = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Product", entityText: "Interstuhl", entityType: "brand", intent: "list", confidence: "high" }));
  assert.equal(brandOnly.kind === "dispatch" ? brandOnly.canonicalMessage : null, "show Interstuhl"); // brand-only remains valid
  const whole = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Product", entityText: "Interstuhl chairs", entityType: "product", intent: "list", confidence: "high" }));
  assert.equal(whole.kind === "dispatch" ? whole.canonicalMessage : null, "show Interstuhl chairs"); // full grounded phrase is preserved
  // Not an I5 follow-up at all.
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues("Show me Interstuhl chairs")), false);
});

test("29. no category inference / fuzzy matching was added", () => {
  for (const source of [referenceSource, resolverSource, i5Section]) {
    assert.ok(!/product_categories|categoryText|levenshtein|fuzzy\(/i.test(source));
  }
});

// ── REGRESSION (30-35) ────────────────────────────────────────────────────────

const dashboard: NoaPageContext = { pathname: "/", section: "dashboard" };

test("30. I4 generic semantic handling still works", () => {
  const quoteMost = classifyNoaRouteWithStrength("Who do we quote the most?", dashboard);
  assert.equal(isNoaGenericSemanticCandidate("Who do we quote the most?", quoteMost), true);
  const finished = classifyNoaRouteWithStrength("Which projects are finished?", dashboard);
  assert.equal(isNoaGenericSemanticCandidate("Which projects are finished?", finished), true);
  const { decision } = decideNoaSemanticV2Outcome(
    { request: semantic({ domain: "Project", entityType: "project_file", intent: "list", projectFileStatus: "completed", confidence: "high" }), stage: "success" },
    finished,
  );
  assert.deepEqual(decision, { canonicalMessage: "show completed project files", domain: "Project", kind: "dispatch" });
  for (const message of ["Who do we quote the most?", "Which projects are finished?", "Who is our best client based on quotation?"]) {
    assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(message)), false, message);
  }
});

test("31. I3 best-client clarification still works", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    { request: semantic({ domain: "Client", entityType: "client", intent: "rank", needsClarification: true, clarificationReason: "missing_metric", confidence: "high" }), stage: "success" },
    classifyNoaRouteWithStrength("Who is our best client?", dashboard),
  );
  assert.equal(decision.kind, "answer");
  assert.equal(decision.kind === "answer" ? decision.choices?.length : 0, 4);
});

test("32. the direct Catch-Up route stays protected (no classifier call; unscoped Catch-Up untouched)", () => {
  const classification = classifyNoaRouteWithStrength("what happened yesterday", dashboard);
  assert.equal(classification.rule, "catch_up");
  assert.deepEqual(noaSemanticV2Eligibility({ classification, flagEnabled: true, protectedReason: null }), { eligible: false, reason: "protected_catch_up" });
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues("what happened yesterday")), false);
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues("what changed this week")), false);
  // On the protected route the I5 pre-pass never calls the classifier.
  const turn = i5Section.slice(i5Section.indexOf("async function resolveNoaConversationFollowUpTurn("));
  assert.ok(turn.indexOf('const deterministicHistory = classification.rule === "catch_up";') < turn.indexOf("extraction = await extractNoaSemanticV2ForRequest(request);"));
});

test("33. the direct Attention route stays protected", () => {
  for (const message of ["what needs my attention", "Anything I need to deal with?"]) {
    assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(message)), false, message);
  }
  const classification = classifyNoaRouteWithStrength("what needs my attention", dashboard);
  assert.equal(noaSemanticV2Eligibility({ classification, flagEnabled: true, protectedReason: null }).eligible, false);
});

test("34. exact QN/CO identifiers stay deterministic - I5 is skipped entirely when one is present", () => {
  assert.ok(coreBody.includes("!recordedQuotationFollowUpFrom &&\n    !quotationOrdinalFollowUp &&\n    !identifierRoute &&\n    !PROCUREMENT_ORDER_TOKEN_PATTERN.test(request.message)"));
  assert.ok(coreBody.indexOf("const identifierRoute =") < coreBody.indexOf("const conversationFollowUp"));
  for (const message of ["tell me about CO-0003-001", "tell me about QN-0005-001", "what changed on CO-0003-001"]) {
    assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(message)), false, message);
  }
});

test("35. feature flag OFF preserves existing behavior (no pre-pass, no new references)", () => {
  assert.equal(isNoaSemanticV2FlagEnabled(undefined), false);
  assert.equal(isNoaSemanticV2FlagEnabled("0"), false);
  assert.ok(coreBody.includes("const quotationHistoryFollowUp = semanticV2FlagEnabled"));
  assert.ok(coreBody.includes("const conversationFollowUp: NoaConversationFollowUpOutcome = quotationHistoryFollowUp ?? (semanticV2FlagEnabled &&"));
  assert.ok(coreBody.includes("(semanticV2FlagEnabled ? buildCatchUpConversationReference(capabilityResult.data) : undefined)"));
  assert.ok(coreBody.includes('semanticV2FlagEnabled && domain === "Insights"'));
});

// ── DIRECT ACCEPTANCE FLOWS (PART 23) ─────────────────────────────────────────

test("FLOW A: ranking -> 'Which client is second?' -> 'How much did they confirm?'", () => {
  const step2 = dispatchOf(follow("Which client is second?", RANKING, LIVE.whichClientSecond));
  assert.equal(step2.canonicalMessage, "tell me about client Blue Harbour");
  // Step 2's fresh Client detail result becomes the single active reference (built by
  // buildClientConversationReference from the capability's own client.name) - modelled here.
  const step3 = dispatchOf(follow("How much did they confirm?", SELECTED_CLIENT, LIVE.howMuchConfirm));
  assert.equal(step3.canonicalMessage, "total confirmed quotation value for client Blue Harbour");
  // Both canonical phrases re-enter existing deterministic routes.
  assert.equal(classifyNoaRouteWithStrength(step2.canonicalMessage, dashboard).rule, "client_intent");
  assert.equal(classifyNoaRouteWithStrength(step3.canonicalMessage, dashboard).route, "Quotation");
});

test("I5.0.1 LIVE UAT: the selected client metric phrase is a confirmed-value read, not an unsupported status lookup", () => {
  const uatRanking: NoaConversationReference = {
    domain: "Insights",
    entities: [
      { label: "TechCorp Solutions FZ-LLC", type: "client" },
      { label: "EXQUITECH", type: "client" },
      { label: "Apex Luxury Retail LLC", type: "client" },
      { label: "Crescent Hospitality Group", type: "client" },
    ],
    intent: "client_ranking",
    metric: "quotation_value",
    resultCount: 4,
  };
  const selected = dispatchOf(follow("Which client is second?", uatRanking, LIVE.whichClientSecond));
  assert.equal(selected.canonicalMessage, "tell me about client EXQUITECH");
  const confirmed = dispatchOf(follow("How much did they confirm?", { domain: "Client", entities: [{ label: "EXQUITECH", type: "client" }], intent: "client_lookup" }, LIVE.howMuchConfirm));
  assert.equal(confirmed.canonicalMessage, "total confirmed quotation value for client EXQUITECH");
  assert.ok(quotationSource.includes('const selectedClientConfirmedValue = /\\btotal confirmed quotation value for client\\b/.test(normalized);'));
  assert.ok(quotationSource.includes('const effectiveStatuses = selectedClientConfirmedValue ? ["client_confirmed"] : statusIntent.statuses;'));
});

test("I5.0.1 LIVE UAT: a fully specified fresh ranking ignores a model-only previous-result flag", () => {
  const fresh = "Who is our best client based on quotation?";
  assert.equal(isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(fresh)), false);
  const classification = classifyNoaRouteWithStrength(fresh, dashboard);
  assert.deepEqual(noaSemanticV2Eligibility({ classification, flagEnabled: true, protectedReason: null }), { eligible: true });
  const modelOnlyPrevious = semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value", reference: "previous_result", confidence: "high" });
  const isolated = decideNoaSemanticV2Outcome({ request: { ...modelOnlyPrevious, reference: "none" }, stage: "success" }, classification).decision;
  assert.deepEqual(isolated, { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" });
  assert.ok(orchestrator.includes('extraction.request.reference === "previous_result"'));
  assert.ok(orchestrator.includes('!isNoaConversationFollowUpCandidate(detectNoaFollowUpCues(request.message))'));
});

test("I5.0.1 status regression: ordinary confirmed-status wording remains on the existing status path", () => {
  assert.ok(quotationSource.includes('if (statusIntent.unsupported.length && !selectedClientConfirmedValue)'));
  assert.ok(quotationSource.includes('aliases: /\\b(?:client[\\s-]+confirmed|confirmed)\\b/'));
});

test("FLOW B/C/D/E/F: analytics period, CO history, QN history, page history, ambiguity", () => {
  assert.equal(dispatchOf(follow("What about last month?", ANALYTICS, LIVE.whatAboutLastMonth)).canonicalMessage, "quotation analytics last month");
  assert.equal(dispatchOf(follow("What changed on it?", PROJECT_FILE, null)).canonicalMessage, "what changed on CO-0003-001");
  assert.equal(dispatchOf(follow("What happened on it?", QUOTATION, null)).canonicalMessage, "what changed on QN-0005-001");
  assert.equal(dispatchOf(follow("What changed here?", undefined, null, { label: "CO-0003-001", type: "project_file" })).canonicalMessage, "what changed on CO-0003-001");
  assert.equal(follow("How much did they confirm?", RANKING, LIVE.howMuchConfirm).binding.kind, "clarify");
});

test("diagnostics carry closed enums only - never labels, identifiers, or messages", () => {
  const binding = follow("Which client is second?", RANKING, LIVE.whichClientSecond).binding;
  const diagnostics = buildNoaReferenceDiagnostics({ ...RANKING, intent: "Blue Harbour secret" }, null, true, binding);
  const serialized = JSON.stringify(diagnostics);
  assert.ok(!/Blue|Apex|CO-|QN-|secret/.test(serialized), serialized);
  assert.equal(diagnostics.referenceIntent, "other");
  assert.equal(diagnostics.ordinalResolved, true);
  assert.equal(diagnostics.referenceBindingKind, "entity_detail");
});

test("PART 17/21: clarification/failure/no-useful-result paths preserve only the sanitized incoming reference", () => {
  const turn = i5Section.slice(i5Section.indexOf("async function resolveNoaConversationFollowUpTurn("));
  assert.ok(turn.includes("...(reference ? { conversationReference: reference } : {}),"));
  assert.ok(turn.includes('if (extraction.stage !== "success") return { extraction, kind: "none" };'));
  assert.ok(!/reference\.(entities|intent|domain)\s*=/.test(turn));
  assert.ok(coreBody.includes("const preservedConversationReference = semanticV2FlagEnabled\n      ? sanitizeNoaConversationReference(conversationReference)"));
  assert.ok(coreBody.includes("const baseConversationReference = freshConversationReference ??"));
  assert.ok(coreBody.includes("withoutNoaPreviousFinding(sanitizeNoaConversationReference(conversationReference))"));
});

test("RouteClassification type is re-used, not redefined", () => {
  const classification: NoaRouteClassification = classifyNoaRouteWithStrength("What about last month?", dashboard);
  assert.equal(classification.strength, "none");
});
