import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildNoaRouteDiagnostics,
  classifyNoaRoute,
  classifyNoaRouteWithStrength,
  decideNoaSemanticV2Outcome,
  isNoaRouteDiagnosticsEnabled,
  isNoaSemanticV2FlagEnabled,
  noaSemanticV2Eligibility,
  type NoaRouteClassification,
  type NoaSemanticV2ExtractionStage,
} from "./noa-intent-router.js";
import { NOA_CLIENT_RANKING_CLARIFICATION_CHOICES } from "./noa-semantic-resolver.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";
import type { NoaPageContext } from "./noa-types.js";

// I3: hybrid semantic V2 runtime. Pure router helpers are exercised directly; the orchestrator and
// extractor ("server-only" + "@/..." aliases) are checked at source level, the same convention every
// other lib/noa/*-safety.test.mts file uses.

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const extractor = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");

const dashboard: NoaPageContext = { pathname: "/", section: "dashboard" };
const projectsPage: NoaPageContext = { pathname: "/projects", section: "projects" };
const quotationsPage: NoaPageContext = { pathname: "/quotations", section: "quotations" };
const productsPage: NoaPageContext = { pathname: "/products", section: "products" };

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, confidence: "high", ...overrides };
}

function success(request: NoaSemanticRequestV2) {
  return { request, stage: "success" as const };
}

function eligible(classification: NoaRouteClassification, flagEnabled = true) {
  return noaSemanticV2Eligibility({ classification, flagEnabled, protectedReason: null }).eligible;
}

const UNRESOLVED: NoaRouteClassification = { route: "Help", rule: "unresolved", strength: "none" };

// Body of runNoaOrchestratorCore only - so source checks never match helper definitions elsewhere.
const coreStart = orchestrator.indexOf("async function runNoaOrchestratorCore(");
const coreBody = orchestrator.slice(coreStart, orchestrator.indexOf("export async function runNoaOrchestrator(", coreStart));

// ── FEATURE FLAG ───────────────────────────────────────────────────────────────

test("1. flag OFF -> existing route behavior unchanged (classifyNoaRoute is exactly .route; V2 never eligible)", () => {
  const corpus = [
    "Who is our best client?", "Who is our best client based on quotation?", "Anything I need to deal with?",
    "what did i work on today", "what happened yesterday", "what needs my attention", "tell me about QN-0005-001",
    "tell me about CO-0003-001", "quotation analytics", "what is the conversion rate", "hi", "what can you do",
    "how do i archive a product", "what's the weather", "where am i", "show this", "show all", "help",
    "show users", "show LAS chairs", "price status", "procurement status", "show active projects", "random words",
  ];
  for (const context of [dashboard, projectsPage, quotationsPage, productsPage]) {
    for (const message of corpus) {
      const classification = classifyNoaRouteWithStrength(message, context);
      assert.equal(classifyNoaRoute(message, context), classification.route, message);
      assert.equal(eligible(classification, false), false, message);
    }
  }
  for (const value of [undefined, "", "0", "false", "off", "yes please"]) assert.equal(isNoaSemanticV2FlagEnabled(value), false, String(value));
  assert.ok(coreBody.includes("isNoaSemanticV2FlagEnabled(process.env.NOA_SEMANTIC_V2)"));
});

test("2. flag ON -> V2 eligible for an unresolved route", () => {
  for (const value of ["1", "true", "TRUE", " on "]) assert.equal(isNoaSemanticV2FlagEnabled(value), true, value);
  assert.equal(eligible(classifyNoaRouteWithStrength("Anything I need to deal with?", dashboard)), true);
});

// ── PROTECTED ROUTES ───────────────────────────────────────────────────────────

function assertProtected(message: string, context: NoaPageContext = dashboard) {
  const classification = classifyNoaRouteWithStrength(message, context);
  assert.equal(eligible(classification), false, `${message} -> ${JSON.stringify(classification)}`);
  return classification;
}

test("3. greeting never semantic", () => {
  assert.equal(assertProtected("hi noa").strength, "exact");
  assertProtected("what can you do");
});

test("4. QN identifier never semantic (orchestrator protection, even though the router alone says Help/none)", () => {
  assert.equal(classifyNoaRouteWithStrength("tell me about QN-0005-001", dashboard).strength, "none");
  assert.equal(noaSemanticV2Eligibility({ classification: UNRESOLVED, flagEnabled: true, protectedReason: "identifier" }).eligible, false);
  assert.match(coreBody, /: identifierRoute \|\| PROCUREMENT_ORDER_TOKEN_PATTERN\.test\(request\.message\)\s*\n\s*\? "identifier"/);
});

test("5. CO identifier never semantic (same identifierRoute protection)", () => {
  assert.ok(coreBody.includes('const identifierRoute = quotationIdentifierTotal > 0 ? "Quotation" : projectFileIdentifierTotal > 0 ? "Project" : null;'));
  assert.ok(coreBody.indexOf("const identifierRoute =") < coreBody.indexOf("const semanticV2ProtectedReason"));
});

test("6. Catch-Up never semantic", () => {
  for (const message of ["what happened yesterday", "what changed today", "catch me up"]) {
    const classification = assertProtected(message);
    assert.equal(classification.rule, "catch_up");
    assert.equal(classification.route, "UserActivity");
  }
});

test("7. Attention exact phrase never semantic", () => {
  assert.equal(assertProtected("what needs my attention").rule, "attention");
});

test("8. Admin anchored never semantic", () => {
  assert.equal(assertProtected("show users").rule, "admin");
});

test("9. Insights anchored never semantic", () => {
  assert.equal(assertProtected("quotation analytics").rule, "insights");
  assert.equal(assertProtected("top clients by quotation value").rule, "insights");
});

test("10. how-to never semantic", () => {
  const classification = assertProtected("how do i archive a product");
  assert.deepEqual(classification, { route: "Help", rule: "howto", strength: "anchored" });
  assert.equal(assertProtected("can you help me").rule, "explicit_help");
});

test("11. off-topic never semantic", () => {
  assert.equal(assertProtected("what's the weather", projectsPage).rule, "off_topic");
});

// ── ACTIVATION ─────────────────────────────────────────────────────────────────

test("12. none strength -> semantic eligible (unresolved Help, distinct from explicit Help)", () => {
  assert.deepEqual(classifyNoaRouteWithStrength("Anything I need to deal with?", dashboard), UNRESOLVED);
  assert.equal(eligible(UNRESOLVED), true);
});

test("13. page_context -> semantic eligible", () => {
  const classification = classifyNoaRouteWithStrength("show this", quotationsPage);
  assert.deepEqual(classification, { route: "Quotation", rule: "page_context", strength: "page_context" });
  assert.equal(eligible(classification), true);
  assert.equal(classifyNoaRouteWithStrength("show all", productsPage).strength, "page_context");
});

test("14. generic_keyword -> NOT semantic eligible in I3", () => {
  for (const message of ["show LAS chairs model", "price status", "show quotations", "show active projects", "procurement orders"]) {
    const classification = classifyNoaRouteWithStrength(message, dashboard);
    assert.equal(classification.strength, "generic_keyword", message);
    assert.equal(eligible(classification), false, message);
  }
  // Client-ranking cue: route unchanged (still the keyword route), only strength is "none".
  const best = classifyNoaRouteWithStrength("Who is our best client?", dashboard);
  assert.deepEqual(best, { route: "Quotation", rule: "client_ranking_cue", strength: "none" });
  assert.equal(classifyNoaRoute("Who is our best client?", dashboard), "Quotation");
});

test("15. low confidence -> no general direct override (only the I5.2 closed ranking allow-list and clarification are exceptions)", () => {
  const dispatch = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Attention", intent: "attention" })), UNRESOLVED);
  assert.deepEqual(dispatch.decision, { kind: "fallback", reason: "semantic_low_confidence_dispatch" });
  const unsupported = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Help", intent: "howto" })), UNRESOLVED);
  assert.deepEqual(unsupported.decision, { kind: "fallback", reason: "semantic_low_confidence" });
});

// ── I3.1: LOW-CONFIDENCE CLARIFICATION POLICY ───────────────────────────────────
//
// Root cause proven live: "Who is our best client?" produces domain=Client, intent=rank,
// metric=null, confidence=low. Before I3.1 this always fell back to the old wrong Quotation
// route. The resolver call itself was ALREADY side-effect-free (no DB, no auth, no capability
// execution) regardless of confidence - I3.1 only changes which of the resolver's four possible
// outcomes are allowed to leave decideNoaSemanticV2Outcome() as something other than a fallback
// when confidence is low. `clarify` is the one outcome that is intrinsically as safe as asking a
// deterministic clarifying question already is elsewhere in NOA.

test("I3.1-1. high-confidence dispatch is still allowed unchanged", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ confidence: "high", domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value" })),
    UNRESOLVED,
  );
  assert.deepEqual(decision, { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" });
});

test("I3.1-2. high-confidence clarification is still allowed unchanged", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ confidence: "high", domain: "Client", entityType: "client", intent: "rank" })),
    UNRESOLVED,
  );
  assert.equal(decision.kind, "answer");
});

test("I3.1-3/13/14. low-confidence clarification is allowed - the live-UAT acceptance case", () => {
  // Exactly the live NOA_ROUTE_DIAG shape from the proven failure: Client/rank/metric=null/low.
  const { decision, diagnostics } = decideNoaSemanticV2Outcome(
    success(semantic({ confidence: "low", domain: "Client", entityType: "client", intent: "rank", metric: null })),
    UNRESOLVED,
  );
  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.equal(decision.text, "What would you like to compare clients by — quotation value, client-confirmed value, Project File value, or number of quotations?");
  assert.deepEqual(decision.choices, NOA_CLIENT_RANKING_CLARIFICATION_CHOICES);
  assert.equal(diagnostics.resolverKind, "clarify");
  assert.equal(diagnostics.fallbackReason, null);
});

test("I5.2-4. low-confidence closed client rankings dispatch through the deterministic Insights phrases", () => {
  for (const [metric, canonicalMessage] of [
    ["quotation_value", "top clients by quotation value"],
    ["confirmed_value", "top clients by confirmed value"],
    ["project_file_value", "top clients by project value"],
    ["quotation_count", "how many quotations does each client have"],
  ] as const) {
    const { decision, diagnostics } = decideNoaSemanticV2Outcome(
      success(semantic({ confidence: "low", domain: "Client", entityType: "client", intent: "rank", metric })),
      UNRESOLVED,
    );
    assert.deepEqual(decision, { canonicalMessage, domain: "Insights", kind: "dispatch" }, metric);
    assert.equal(diagnostics.confidenceOverride, "deterministic_safe_dispatch", metric);
    assert.equal(diagnostics.fallbackReason, null, metric);
  }
});

test("I5.2-5. low-confidence dispatch remains rejected outside the closed client-ranking allow-list", () => {
  const attention = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Attention", intent: "attention" })), UNRESOLVED);
  assert.deepEqual(attention.decision, { kind: "fallback", reason: "semantic_low_confidence_dispatch" });
});

test("I3.1-6. low-confidence Insights dispatch is rejected", () => {
  // Quotation + aggregate/quotation_value/last_month resolves (via I2's ownership normalization)
  // to a dispatch into Insights - a real low-confidence Insights-bound dispatch, not just Client.
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ confidence: "low", domain: "Quotation", intent: "aggregate", metric: "quotation_value", period: "last_month" })),
    UNRESOLVED,
  );
  assert.deepEqual(decision, { kind: "fallback", reason: "semantic_low_confidence_dispatch" });
});

test("I5.2-6. missing, referenced, or entity-bearing client rankings cannot use the low-confidence exception", () => {
  const cases: Array<Partial<NoaSemanticRequestV2>> = [
    { metric: null },
    { reference: "previous_result" },
    { entityText: "EXQUITECH" },
    { clarificationReason: "action_requested" },
  ];
  for (const overrides of cases) {
    const { decision } = decideNoaSemanticV2Outcome(
      success(semantic({ confidence: "low", domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value", ...overrides })),
      UNRESOLVED,
    );
    assert.notEqual(decision.kind, "dispatch", JSON.stringify(overrides));
  }
});

test("I5.2-7. Product, lookup, Attention, and history dispatches remain outside the low-confidence allow-list", () => {
  const cases: Array<[string, Partial<NoaSemanticRequestV2>]> = [
    ["Product", { domain: "Product", intent: "list", entityType: "product", entityText: "LAS desks" }],
    ["Quotation lookup", { domain: "Quotation", intent: "lookup", entityType: "quotation", entityText: "quotation" }],
    ["Project lookup", { domain: "Project", intent: "lookup", entityType: "project_file", entityText: "CO-0003-001" }],
    ["Procurement lookup", { domain: "Procurement", intent: "lookup", entityType: "procurement_order", entityText: "PO-0001" }],
    ["Attention", { domain: "Attention", intent: "attention" }],
    ["Referenced history", { domain: "UserActivity", intent: "history", reference: "previous_result" }],
  ];
  for (const [label, overrides] of cases) {
    const { decision, diagnostics } = decideNoaSemanticV2Outcome(
      success(semantic({ confidence: "low", ...overrides })),
      UNRESOLVED,
    );
    assert.notEqual(decision.kind, "dispatch", label);
    assert.equal(diagnostics.confidenceOverride, null, label);
  }
});

test("I3.1-7. low-confidence resolver fallback -> deterministic fallback", () => {
  const { decision } = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Insights", intent: "rank" })), UNRESOLVED);
  assert.equal(decision.kind, "fallback");
});

test("I3.1-8. low-confidence unsupported -> deterministic fallback, never a semantic refusal", () => {
  const { decision } = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Help", intent: "howto" })), UNRESOLVED);
  assert.deepEqual(decision, { kind: "fallback", reason: "semantic_low_confidence" });
});

for (const [index, stage] of [["I3.1-9", "provider_error"], ["I3.1-10", "invalid_json"], ["I3.1-11", "schema_mismatch"], ["I3.1-12", "grounding_failed"]] as Array<[string, NoaSemanticV2ExtractionStage]>) {
  test(`${index}. ${stage} is unchanged by the I3.1 confidence policy`, () => {
    const { decision } = decideNoaSemanticV2Outcome({ request: UNCLEAR_SEMANTIC_REQUEST_V2, stage }, UNRESOLVED);
    assert.deepEqual(decision, { kind: "fallback", reason: `semantic_${stage}` });
  });
}

test("I3.1-15. no capability is called for a low-confidence clarification (same single-call chain as every other decision)", () => {
  assert.ok(coreBody.includes("if (decision.kind === \"answer\") return semanticV2Answer(decision);"));
  // semanticV2Answer() only ever builds a NoaAnswer from the resolver's own fixed text/choices -
  // it takes no capability-calling path at all.
  const answerFnStart = orchestrator.indexOf("function semanticV2Answer(");
  const answerFnBody = orchestrator.slice(answerFnStart, orchestrator.indexOf("\n}", answerFnStart));
  assert.ok(!/fetchNoa\w+Capability/.test(answerFnBody));
});

test("I3.1-16. feature flag OFF is unaffected by the confidence-policy change", () => {
  for (const message of ["Who is our best client?", "Who is our best client based on quotation?"]) {
    const classification = classifyNoaRouteWithStrength(message, dashboard);
    assert.equal(eligible(classification, false), false, message);
  }
});

test("I3.1-17. protected routes are unaffected - low confidence never even reaches the resolver for a protected route", () => {
  assertProtected("what happened yesterday");
  assertProtected("what needs my attention");
});

test("I3.1-18. generic_keyword activation is unaffected by the confidence-policy change", () => {
  const classification = classifyNoaRouteWithStrength("show quotations", dashboard);
  assert.equal(classification.strength, "generic_keyword");
  assert.equal(eligible(classification), false);
});

test("I3.1-19. no semantic schema changes - V2 contract/version untouched", () => {
  const semanticRequestSource = readFileSync("lib/noa/noa-semantic-request.ts", "utf8");
  assert.ok(semanticRequestSource.includes("export const NOA_SEMANTIC_REQUEST_V2_VERSION = 2 as const;"));
});

test("I3.1-20. no resolver mapping changes - resolver stays confidence-agnostic (no `.confidence` field access anywhere in its code)", () => {
  const resolverSource = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  assert.ok(!resolverSource.includes("semantic.confidence") && !resolverSource.includes(".confidence ==="), "the resolver itself must stay confidence-agnostic - the policy lives in the orchestrator/router only");
});

// ── RESOLVER ───────────────────────────────────────────────────────────────────

test("16. dispatch uses the resolver's canonical message and deterministic domain", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value" })),
    classifyNoaRouteWithStrength("Who is our best client based on quotation?", projectsPage),
  );
  assert.deepEqual(decision, { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" });
  // The canonical phrase re-enters the deterministic Insights fast path.
  assert.equal(classifyNoaRoute("top clients by quotation value", dashboard), "Insights");
  const attention = decideNoaSemanticV2Outcome(success(semantic({ domain: "Attention", intent: "attention" })), UNRESOLVED);
  assert.deepEqual(attention.decision, { canonicalMessage: "what needs my attention", domain: "Attention", kind: "dispatch" });
});

test("17. clarify returns deterministic text", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Client", entityType: "client", intent: "rank", needsClarification: true, clarificationReason: "missing_metric" })),
    classifyNoaRouteWithStrength("Who is our best client?", dashboard),
  );
  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.equal(decision.text, "What would you like to compare clients by — quotation value, client-confirmed value, Project File value, or number of quotations?");
  assert.equal(decision.domain, "Client");
});

test("18. clarify transports deterministic choices (existing NoaAnswer.choices), each re-entering the deterministic Insights path", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Client", entityType: "client", intent: "rank" })),
    UNRESOLVED,
  );
  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.deepEqual(decision.choices, NOA_CLIENT_RANKING_CLARIFICATION_CHOICES);
  assert.notEqual(decision.choices, NOA_CLIENT_RANKING_CLARIFICATION_CHOICES); // copied, never the shared constant
  assert.deepEqual(decision.choices?.map((choice) => choice.label), ["Quotation value", "Client-confirmed value", "Project File value", "Number of quotations"]);
  for (const choice of decision.choices ?? []) {
    const classification = classifyNoaRouteWithStrength(choice.value, projectsPage);
    assert.equal(classification.route, "Insights", choice.value);
    assert.equal(eligible(classification), false, choice.value);
  }
  assert.ok(orchestrator.includes("...(decision.choices?.length ? { choices: decision.choices } : {}),"));
});

test("19. unsupported returns deterministic text", () => {
  const { decision } = decideNoaSemanticV2Outcome(success(semantic({ domain: "Help", intent: "howto" })), UNRESOLVED);
  assert.equal(decision.kind, "answer");
  if (decision.kind !== "answer") return;
  assert.match(decision.text, /^I don't have step-by-step instructions/);
  const action = decideNoaSemanticV2Outcome(success(semantic({ domain: "Quotation", intent: "lookup", clarificationReason: "action_requested" })), UNRESOLVED);
  assert.equal(action.decision.kind, "answer");
});

test("20. fallback uses the existing route (resolver fallback, reference binding, page-context same-domain)", () => {
  assert.equal(decideNoaSemanticV2Outcome(success(semantic({ domain: "Unclear" })), UNRESOLVED).decision.kind, "fallback");
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Quotation", intent: "lookup", reference: "current_page" })), classifyNoaRouteWithStrength("show this", quotationsPage)).decision,
    { kind: "fallback", reason: "semantic_reference_binding_deferred" },
  );
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", intent: "list", reference: "previous_result" })), UNRESOLVED).decision,
    { kind: "fallback", reason: "semantic_reference_binding_deferred" },
  );
  // Live-smoke regression: on an UNRESOLVED route a current_page hint binds nothing -> still dispatches.
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Attention", intent: "attention", reference: "current_page" })), UNRESOLVED).decision,
    { canonicalMessage: "what needs my attention", domain: "Attention", kind: "dispatch" },
  );
  // page_context: a clarify/unsupported never replaces the page-bound deterministic path.
  assert.equal(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Product", intent: "list" })), classifyNoaRouteWithStrength("show all", productsPage)).decision.kind,
    "fallback",
  );
  // A fallback decision leaves `route` untouched in the orchestrator.
  assert.ok(coreBody.includes("const dispatchRoute = semanticV2Dispatch ? semanticV2Dispatch.domain : effectiveRoute;"));
});

// ── FAILURE ────────────────────────────────────────────────────────────────────

for (const [index, stage] of [[21, "provider_error"], [22, "invalid_json"], [23, "schema_mismatch"], [24, "grounding_failed"], [25, "disabled"]] as Array<[number, NoaSemanticV2ExtractionStage]>) {
  test(`${index}. ${stage} -> fallback (never surfaced to the user)`, () => {
    const { decision, diagnostics } = decideNoaSemanticV2Outcome({ request: UNCLEAR_SEMANTIC_REQUEST_V2, stage }, UNRESOLVED);
    assert.deepEqual(decision, { kind: "fallback", reason: `semantic_${stage}` });
    assert.equal(diagnostics.semanticStage, stage);
    assert.equal(diagnostics.resolverKind, null);
  });
}

// ── SECURITY ───────────────────────────────────────────────────────────────────

test("26. semantic cannot change auth - V2 only selects a domain + canonical message, request context/auth untouched", () => {
  const block = coreBody.slice(coreBody.indexOf("const originalMessage = request.message;"), coreBody.indexOf("const capabilityResult ="));
  assert.ok(block.includes("request = { ...request, message: semanticV2Dispatch.canonicalMessage };"));
  assert.ok(!/requireActiveUser|requireSystemOwner|createAdminClient|service_role/i.test(router));
  assert.ok(!/requireActiveUser|requireSystemOwner|createAdminClient|service_role/i.test(orchestrator.slice(orchestrator.indexOf("// I3: hybrid semantic V2 runtime"), coreStart)));
});

test("27. semantic cannot provide an identifier - dispatch carries only resolver-owned domain/canonicalMessage", () => {
  const { decision } = decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_count" })), UNRESOLVED);
  assert.deepEqual(Object.keys(decision).sort(), ["canonicalMessage", "domain", "kind"]);
  // The V2 contract has no identifier field at all, and entityText never reaches the dispatch.
  assert.ok(!Object.keys(UNCLEAR_SEMANTIC_REQUEST_V2).some((key) => /quotationNo|orderNo|Id$/.test(key)));
  const lookup = decideNoaSemanticV2Outcome(success(semantic({ domain: "Quotation", intent: "lookup", entityText: null })), UNRESOLVED);
  assert.equal(lookup.decision.kind, "answer"); // clarify for a quotation number - never a guessed identifier
});

test("28. capability functions remain the normal dispatch target (same single capability chain, no new capability call)", () => {
  for (const call of [
    "await fetchNoaInsightsCapability(request.message, request.context)",
    "await fetchNoaAttentionCapability(request.message, request.context)",
    "await fetchNoaUserActivityCapability(request.message, request.context, {",
    "await fetchNoaAdminCapability(request.message, request.context)",
  ]) {
    assert.equal(coreBody.split(call).length - 1, 1, call);
  }
  assert.ok(coreBody.indexOf("request = { ...request, message: semanticV2Dispatch.canonicalMessage };") < coreBody.indexOf("const capabilityResult ="));
});

test("29. no service-role / admin client path added", () => {
  for (const source of [router, orchestrator, extractor]) {
    assert.ok(!/createAdminClient|SUPABASE_SERVICE_ROLE|service_role/i.test(source));
  }
});

test("30. no DB data passed to the classifier - current message + page section only", () => {
  assert.ok(orchestrator.includes("await extractNoaSemanticRequestV2({ context: request.context, message: request.message });"));
  const v2Body = extractor.slice(extractor.indexOf("export async function extractNoaSemanticRequestV2("));
  const userContent = v2Body.slice(v2Body.indexOf("userContent: {"), v2Body.indexOf("},", v2Body.indexOf("userContent: {")) + 2);
  assert.match(userContent, /message: input\.message,\s*\n\s*pageContext: \{ section: input\.context\.section \},/);
  assert.ok(!/recentMessages|capabilityData|conversationReference/.test(userContent));
});

// ── REGRESSIONS ────────────────────────────────────────────────────────────────

test("31. 'what did i work on today' remains deterministic UserActivity", () => {
  assert.deepEqual(assertProtected("what did i work on today"), { route: "UserActivity", rule: "user_activity", strength: "anchored" });
});

test("32. 'what happened yesterday' remains Catch-Up (and V1 is skipped for it when the flag is on)", () => {
  assert.equal(assertProtected("what happened yesterday").rule, "catch_up");
  assert.ok(coreBody.includes('(semanticV2FlagEnabled && routeClassification.rule === "catch_up")'));
});

test("33. 'what needs my attention' remains Attention", () => {
  assert.equal(classifyNoaRoute("what needs my attention", projectsPage), "Attention");
});

test("34/35. 'tell me about QN-0005-001' / 'tell me about CO-0003-001' keep their identifier fast paths", () => {
  // Router alone says Help; the orchestrator's identifierRoute (checked first) reroutes, and both
  // the identifier and the generic "tell me about" candidate are V2 protections.
  assert.ok(coreBody.includes('identifierRoute && deterministicRoute !== "UserActivity"'));
  assert.ok(coreBody.includes('? "entity_lookup_candidate"'));
});

test("36. 'quotation analytics' remains Insights", () => {
  assert.deepEqual(assertProtected("quotation analytics", projectsPage), { route: "Insights", rule: "insights", strength: "anchored" });
});

test("37. conversion-rate refusal (and on-hold refusal) remain deterministic", () => {
  assert.equal(assertProtected("what is our conversion rate").route, "Insights");
  assert.equal(assertProtected("how many projects are on hold").route, "Insights");
});

test("38. Product Configuration routing remains first (intercepted before the core pipeline)", () => {
  const wrapper = orchestrator.slice(orchestrator.indexOf("export async function runNoaOrchestrator("));
  assert.ok(wrapper.indexOf("await maybeHandleProductConfigurationTurn(request);") < wrapper.indexOf("await runNoaOrchestratorCore(request);"));
  const configurationTurn = orchestrator.slice(
    orchestrator.indexOf("async function maybeHandleProductConfigurationTurn("),
    orchestrator.indexOf("// I3: hybrid semantic V2 runtime"),
  );
  assert.ok(configurationTurn.length > 0 && !configurationTurn.includes("runNoaSemanticV2("));
});

// ── OBSERVABILITY ──────────────────────────────────────────────────────────────

test("39/40. diagnostics exclude raw message, entity text, and subject name", () => {
  const message = "What did Zyxwvut Qwerty work on at SecretClientCo";
  const request = semantic({ domain: "UserActivity", entityText: "SecretClientCo", entityType: "client", intent: "activity", subject: "named_user", subjectName: "Zyxwvut Qwerty" });
  const { diagnostics } = decideNoaSemanticV2Outcome(success(request), classifyNoaRouteWithStrength(message, dashboard));
  const serialized = JSON.stringify(diagnostics);
  for (const secret of ["Zyxwvut", "Qwerty", "SecretClientCo", message]) assert.ok(!serialized.includes(secret), secret);
  assert.deepEqual(Object.keys(buildNoaRouteDiagnostics(UNRESOLVED)).sort(), [
    "confidenceOverride", "deterministicRoute", "fallbackReason", "genericSemanticCandidate", "resolverKind", "routeRule", "routeStrength", "semanticConfidence",
    "semanticDomain", "semanticIntent", "semanticMetric", "semanticRan", "semanticStage",
  ]);
  assert.equal(isNoaRouteDiagnosticsEnabled("production", undefined), false);
  assert.equal(isNoaRouteDiagnosticsEnabled("production", "1"), true);
  assert.equal(isNoaRouteDiagnosticsEnabled("development", undefined), true);
  assert.ok(orchestrator.includes('console.info("[NOA_ROUTE_DIAG]", JSON.stringify(diagnostics));'));
});

test("41. V2 timeout is 4s; V1 timeout unchanged at 10s", () => {
  assert.ok(extractor.includes("const TIMEOUT_MS = 10_000;"));
  assert.ok(extractor.includes("const V2_TIMEOUT_MS = 4_000;"));
  const v1Body = extractor.slice(extractor.indexOf("export async function extractNoaSemanticRequest("), extractor.indexOf("const SYSTEM_INSTRUCTIONS_V2"));
  const v2Body = extractor.slice(extractor.indexOf("export async function extractNoaSemanticRequestV2("));
  assert.ok(v1Body.includes("timeoutMs: TIMEOUT_MS,"));
  assert.ok(v2Body.includes("timeoutMs: V2_TIMEOUT_MS,"));
});

test("42. no duplicate V1+V2 semantic call - one V2 call site, V1 skipped once V2 was attempted", () => {
  assert.equal((orchestrator.match(/extractNoaSemanticRequest\(/g) ?? []).length, 1);
  assert.equal((orchestrator.match(/extractNoaSemanticRequestV2\(/g) ?? []).length, 1);
  assert.equal((coreBody.match(/await runNoaSemanticV2\(/g) ?? []).length, 2);
  assert.ok(coreBody.includes("const skipV1Extraction = semanticV2Attempted ||"));
  assert.ok(coreBody.includes("const extracted = semanticRequest || skipV1Extraction"));
  // The two V2 call sites are mutually exclusive by route (non-Help vs Help).
  assert.ok(coreBody.includes('if (semanticV2Eligibility.eligible && route !== "Help") {'));
  assert.ok(coreBody.includes('if (!semanticRequest && route === "Help" && semanticV2Eligibility.eligible) {'));
  // Provider phrasing still sees the user's original wording, never the canonical phrase.
  assert.ok(coreBody.includes("message: originalMessage,"));
});
