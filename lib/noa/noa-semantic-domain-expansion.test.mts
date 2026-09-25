import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildNoaRouteDiagnostics,
  classifyNoaRoute,
  classifyNoaRouteWithStrength,
  decideNoaSemanticV2Outcome,
  isNoaGenericSemanticCandidate,
  noaSemanticV2Eligibility,
  type NoaRouteClassification,
  type NoaSemanticV2ExtractionStage,
  type NoaSemanticV2ProtectedReason,
} from "./noa-intent-router.js";
import { NOA_CLIENT_RANKING_CLARIFICATION_CHOICES } from "./noa-semantic-resolver.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";
import type { NoaPageContext } from "./noa-types.js";

// I4: generic-keyword semantic expansion. Pure router helpers are exercised directly; the
// orchestrator ("server-only" + "@/..." aliases) is checked at source level, like every other
// lib/noa/*-safety test.

const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const router = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
const coreStart = orchestrator.indexOf("async function runNoaOrchestratorCore(");
const coreBody = orchestrator.slice(coreStart, orchestrator.indexOf("export async function runNoaOrchestrator(", coreStart));

const dashboard: NoaPageContext = { pathname: "/", section: "dashboard" };
const productsPage: NoaPageContext = { pathname: "/products", section: "products" };
const projectsPage: NoaPageContext = { pathname: "/projects", section: "projects" };

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, confidence: "high", ...overrides };
}

function success(request: NoaSemanticRequestV2) {
  return { request, stage: "success" as const };
}

// Mirrors the orchestrator's own wiring: classification -> candidate -> eligibility.
function evaluate(message: string, options: { context?: NoaPageContext; flagEnabled?: boolean; protectedReason?: NoaSemanticV2ProtectedReason | null } = {}) {
  const classification = classifyNoaRouteWithStrength(message, options.context ?? dashboard);
  const genericSemanticCandidate = isNoaGenericSemanticCandidate(message, classification);
  const eligibility = noaSemanticV2Eligibility({
    classification,
    flagEnabled: options.flagEnabled ?? true,
    genericSemanticCandidate,
    protectedReason: options.protectedReason ?? null,
  });
  return { classification, eligible: eligibility.eligible, eligibility, genericSemanticCandidate };
}

function assertProtected(message: string, context: NoaPageContext = dashboard) {
  const result = evaluate(message, { context });
  assert.equal(result.eligible, false, `${message} -> ${JSON.stringify(result)}`);
  assert.equal(result.genericSemanticCandidate, false, message);
  return result.classification;
}

const UNRESOLVED: NoaRouteClassification = { route: "Help", rule: "unresolved", strength: "none" };
const QUOTE_THE_MOST = classifyNoaRouteWithStrength("Who do we quote the most?", dashboard);
const PROJECTS_FINISHED = classifyNoaRouteWithStrength("Which projects are finished?", dashboard);
const ACTIVE_PROCUREMENT = classifyNoaRouteWithStrength("What active procurement orders do we have?", dashboard);

// ── ELIGIBILITY ────────────────────────────────────────────────────────────────

test("1. a generic keyword alone is NOT automatically semantic", () => {
  for (const message of [
    "show quotations", "show active projects", "procurement orders", "show LAS chairs model", "price status",
    "show pending quotations", "what is the project quotation total", "show most recent quotations",
    "how many quotations do we have", "show archived products", "which products have the highest price",
  ]) {
    const result = evaluate(message);
    assert.equal(result.classification.strength, "generic_keyword", message);
    assert.equal(result.genericSemanticCandidate, false, message);
    assert.equal(result.eligible, false, message);
    assert.deepEqual(result.eligibility, { eligible: false, reason: "route_strength_generic_keyword" }, message);
  }
  // Without the caller-supplied candidate signal, generic_keyword stays ineligible (I3 behavior).
  assert.equal(noaSemanticV2Eligibility({ classification: QUOTE_THE_MOST, flagEnabled: true, protectedReason: null }).eligible, false);
});

test("2. generic keyword + semantic candidate -> V2 may run", () => {
  assert.equal(QUOTE_THE_MOST.strength, "generic_keyword");
  assert.equal(evaluate("Who do we quote the most?").eligible, true);
  assert.equal(evaluate("Which projects are finished?").eligible, true);
  assert.equal(evaluate("What active procurement orders do we have?").eligible, true);
});

test("3. none strength still runs V2", () => {
  const result = evaluate("Anything I need to deal with?");
  assert.deepEqual(result.classification, UNRESOLVED);
  assert.equal(result.eligible, true);
  assert.equal(result.genericSemanticCandidate, false);
});

test("4. page_context still runs V2", () => {
  const result = evaluate("show all", { context: productsPage });
  assert.equal(result.classification.strength, "page_context");
  assert.equal(result.eligible, true);
});

test("5. feature flag OFF prevents V2 - even for a generic semantic candidate", () => {
  for (const message of ["Who do we quote the most?", "Which projects are finished?", "Anything I need to deal with?"]) {
    assert.deepEqual(evaluate(message, { flagEnabled: false }).eligibility, { eligible: false, reason: "flag_off" }, message);
  }
});

// ── CLIENT ─────────────────────────────────────────────────────────────────────

test("6. 'Who do we quote the most?' -> eligible despite the Quotation keyword -> Insights per-client quotation count", () => {
  assert.deepEqual(QUOTE_THE_MOST, { route: "Quotation", rule: "quotation_keyword", strength: "generic_keyword" });
  assert.equal(isNoaGenericSemanticCandidate("Who do we quote the most?", QUOTE_THE_MOST), true);
  const { decision, diagnostics } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_count" })),
    QUOTE_THE_MOST,
  );
  assert.deepEqual(decision, { canonicalMessage: "how many quotations does each client have", domain: "Insights", kind: "dispatch" });
  assert.equal(classifyNoaRoute("how many quotations does each client have", dashboard), "Insights");
  assert.equal(diagnostics.genericSemanticCandidate, true);
});

test("7. client ranking by confirmed business / customer by quotation value -> eligible -> Insights ranking", () => {
  // "client" + "most" is the pre-existing I3 client_ranking_cue bridge (strength none).
  const confirmed = evaluate("Which client has the most confirmed business?");
  assert.equal(confirmed.classification.rule, "client_ranking_cue");
  assert.equal(confirmed.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "confirmed_value" })), confirmed.classification).decision,
    { canonicalMessage: "top clients by confirmed value", domain: "Insights", kind: "dispatch" },
  );
  // No literal "client": the I4 ranking cue on the generic Quotation keyword route carries it.
  const customer = evaluate("Which customer has the highest quotation value?");
  assert.equal(customer.classification.strength, "generic_keyword");
  assert.equal(customer.genericSemanticCandidate, true);
  assert.equal(customer.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value" })), customer.classification).decision,
    { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" },
  );
});

test("8. plain client lookup remains deterministic", () => {
  assert.equal(assertProtected("show client EXQUITECH").rule, "client_intent");
  assert.equal(evaluate("tell me about EXQUITECH", { protectedReason: "entity_lookup_candidate" }).eligible, false);
  const forClient = evaluate("quotations for client EXQUITECH");
  assert.equal(forClient.classification.rule, "quotation_keyword");
  assert.equal(forClient.eligible, false);
});

// ── PROJECT ────────────────────────────────────────────────────────────────────

test("9. 'Which projects are finished?' -> eligible -> completed Project File list", () => {
  assert.deepEqual(PROJECTS_FINISHED, { route: "Project", rule: "project_keyword", strength: "generic_keyword" });
  assert.equal(isNoaGenericSemanticCandidate("Which projects are finished?", PROJECTS_FINISHED), true);
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Project", entityType: "project_file", intent: "list", projectFileStatus: "completed" })),
    PROJECTS_FINISHED,
  );
  assert.deepEqual(decision, { canonicalMessage: "show completed project files", domain: "Project", kind: "dispatch" });
  // "How many jobs are active?" has no keyword at all -> unresolved -> already eligible (I3).
  const jobs = evaluate("How many jobs are active?");
  assert.equal(jobs.classification.strength, "none");
  assert.equal(jobs.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Project", entityType: "project_file", intent: "count", projectFileStatus: "active" })), jobs.classification).decision,
    { canonicalMessage: "how many active project files", domain: "Project", kind: "dispatch" },
  );
});

test("10. exact CO identifier remains protected", () => {
  assert.equal(evaluate("which projects are finished CO-0003-001", { protectedReason: "identifier" }).eligible, false);
  // The candidate helper itself also refuses any identifier-shaped token.
  const message = "which project has the most items CO-0003-001";
  assert.equal(isNoaGenericSemanticCandidate(message, classifyNoaRouteWithStrength(message, dashboard)), false);
});

// ── PRODUCT ────────────────────────────────────────────────────────────────────

test("11. natural product search may be semantic eligible", () => {
  const interstuhl = evaluate("Show me Interstuhl chairs");
  assert.equal(interstuhl.classification.strength, "none"); // no Product keyword -> already I3 territory
  assert.equal(interstuhl.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Product", entityType: "product", entityText: "Interstuhl chairs", intent: "list" })), interstuhl.classification).decision,
    { canonicalMessage: "show Interstuhl chairs", domain: "Product", kind: "dispatch" },
  );
  assert.equal(evaluate("Do we have a 1600mm executive desk?").eligible, true);
  // A ranking-shaped Product keyword question is a candidate.
  assert.equal(evaluate("which product model is the best").genericSemanticCandidate, true);
});

test("12. exact/simple deterministic Product query stays on (or falls back to) the Product route", () => {
  assert.equal(evaluate("show LAS chairs model").eligible, false);
  const ranking = classifyNoaRouteWithStrength("which product model is the best", dashboard);
  assert.equal(ranking.route, "Product");
  // Non-client rank -> I6.3 compatibility gate fails closed -> keyword route keeps the message.
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Product", entityType: "product", intent: "rank" })), ranking).decision,
    { kind: "fallback", reason: "semantic_incompatible_unsupported_domain_intent" },
  );
  // Same-domain rewrite carrying entityText would drop the user's filter -> keyword route keeps it.
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Product", entityType: "product", entityText: "model", intent: "list" })), ranking).decision,
    { kind: "fallback", reason: "generic_keyword_same_domain_entity" },
  );
  // Product clarify never replaces the keyword route either.
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Product", intent: "list" })), ranking).decision,
    { kind: "fallback", reason: "generic_keyword_clarify" },
  );
});

// ── PROCUREMENT ────────────────────────────────────────────────────────────────

test("13. natural active procurement list / completed count -> eligible -> existing Procurement phrases", () => {
  assert.deepEqual(ACTIVE_PROCUREMENT, { route: "Procurement", rule: "procurement_keyword", strength: "generic_keyword" });
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Procurement", entityType: "procurement_order", intent: "list", procurementStatus: "active" })), ACTIVE_PROCUREMENT).decision,
    { canonicalMessage: "show active procurement orders", domain: "Procurement", kind: "dispatch" },
  );
  const completed = evaluate("How many completed purchase orders do we have?");
  assert.equal(completed.classification.route, "Procurement");
  assert.equal(completed.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Procurement", entityType: "procurement_order", intent: "count", procurementStatus: "completed" })), completed.classification).decision,
    { canonicalMessage: "how many completed procurement orders", domain: "Procurement", kind: "dispatch" },
  );
  // Unsupported procurement semantics (supplier ranking) fail closed at the I6.3 compatibility
  // gate; the original Procurement route answers instead.
  const supplier = evaluate("which vendor has the most procurement orders");
  assert.equal(supplier.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Procurement", entityType: "supplier", intent: "rank" })), supplier.classification).decision,
    { kind: "fallback", reason: "semantic_incompatible_unsupported_domain_intent" },
  );
});

test("14. exact procurement identifier remains protected", () => {
  assert.equal(evaluate("what procurement orders do we have for PO-12345", { protectedReason: "identifier" }).eligible, false);
  const message = "what procurement orders do we have for PO-12345";
  assert.equal(isNoaGenericSemanticCandidate(message, classifyNoaRouteWithStrength(message, dashboard)), false);
  assert.match(coreBody, /: identifierRoute \|\| PROCUREMENT_ORDER_TOKEN_PATTERN\.test\(request\.message\)\s*\n\s*\? "identifier"/);
});

// ── PROTECTED ──────────────────────────────────────────────────────────────────

test("15. Catch-Up protected", () => {
  assert.equal(assertProtected("what happened yesterday").rule, "catch_up");
  assert.equal(assertProtected("what changed on the top projects today").rule, "catch_up");
});

test("16. Attention exact phrase protected", () => {
  assert.equal(assertProtected("what needs my attention").rule, "attention");
});

test("17. Admin protected", () => {
  assert.equal(assertProtected("show users").rule, "admin");
});

test("18. explicit Insights protected", () => {
  assert.equal(assertProtected("top clients by quotation value").rule, "insights");
  assert.equal(assertProtected("how many active project files").rule, "insights");
  assert.equal(assertProtected("what is our conversion rate").route, "Insights");
  assert.equal(assertProtected("how many projects are on hold").route, "Insights");
});

test("19. QN identifier protected", () => {
  assert.equal(evaluate("tell me about QN-0005-001", { protectedReason: "identifier" }).eligible, false);
  const message = "which quotation is the highest QN-0005-001";
  assert.equal(isNoaGenericSemanticCandidate(message, classifyNoaRouteWithStrength(message, dashboard)), false);
});

test("20. CO identifier protected", () => {
  assert.equal(evaluate("tell me about CO-0003-001", { protectedReason: "identifier" }).eligible, false);
  assert.ok(coreBody.indexOf("const identifierRoute =") < coreBody.indexOf("const semanticV2ProtectedReason"));
});

test("21. Product Configuration active turn protected (intercepted before the core pipeline)", () => {
  const wrapper = orchestrator.slice(orchestrator.indexOf("export async function runNoaOrchestrator("));
  assert.ok(wrapper.indexOf("await maybeHandleProductConfigurationTurn(request);") < wrapper.indexOf("await runNoaOrchestratorCore(request);"));
  const configurationTurn = orchestrator.slice(
    orchestrator.indexOf("async function maybeHandleProductConfigurationTurn("),
    orchestrator.indexOf("// I3: hybrid semantic V2 runtime"),
  );
  assert.ok(configurationTurn.length > 0 && !configurationTurn.includes("runNoaSemanticV2(") && !configurationTurn.includes("isNoaGenericSemanticCandidate("));
});

test("22. how-to protected", () => {
  assert.equal(assertProtected("how do i find the best product").rule, "howto");
});

test("23. off-topic protected", () => {
  assert.equal(assertProtected("tell me a joke about the top projects").rule, "off_topic");
});

// ── CONFIDENCE ─────────────────────────────────────────────────────────────────

test("24. high-confidence semantic dispatch allowed on a candidate generic route", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_count" })),
    QUOTE_THE_MOST,
  );
  assert.equal(decision.kind, "dispatch");
});

test("25. low-confidence dispatch rejected (generic route, unchanged I3.1 reason)", () => {
  for (const classification of [QUOTE_THE_MOST, PROJECTS_FINISHED, ACTIVE_PROCUREMENT, UNRESOLVED]) {
    const { decision } = decideNoaSemanticV2Outcome(
      success(semantic({ confidence: "low", domain: "Project", entityType: "project_file", intent: "list", projectFileStatus: "completed" })),
      classification,
    );
    assert.deepEqual(decision, { kind: "fallback", reason: "semantic_low_confidence_dispatch" });
  }
  const unsupported = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Help", intent: "howto" })), QUOTE_THE_MOST);
  assert.deepEqual(unsupported.decision, { kind: "fallback", reason: "semantic_low_confidence" });
});

test("26. low-confidence clarification still allowed (client ranking with no metric)", () => {
  for (const classification of [QUOTE_THE_MOST, UNRESOLVED]) {
    const { decision } = decideNoaSemanticV2Outcome(
      success(semantic({ confidence: "low", domain: "Client", entityType: "client", intent: "rank", metric: null })),
      classification,
    );
    assert.equal(decision.kind, "answer");
    if (decision.kind !== "answer") continue;
    assert.deepEqual(decision.choices, NOA_CLIENT_RANKING_CLARIFICATION_CHOICES);
  }
  // Any other clarify on a generic keyword route defers to the working keyword capability.
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Quotation", intent: "lookup" })), QUOTE_THE_MOST).decision,
    { kind: "fallback", reason: "generic_keyword_clarify" },
  );
});

// ── FAILURE -> ORIGINAL GENERIC ROUTE ──────────────────────────────────────────

for (const [index, stage] of [[27, "provider_error"], [28, "grounding_failed"], [29, "schema_mismatch"], [30, "provider_error"]] as Array<[number, NoaSemanticV2ExtractionStage]>) {
  test(`${index}. ${index === 30 ? "timeout (surfaces as provider_error)" : stage} -> original generic route`, () => {
    for (const classification of [QUOTE_THE_MOST, PROJECTS_FINISHED, ACTIVE_PROCUREMENT]) {
      const { decision, diagnostics } = decideNoaSemanticV2Outcome({ request: UNCLEAR_SEMANTIC_REQUEST_V2, stage }, classification);
      assert.deepEqual(decision, { kind: "fallback", reason: `semantic_${stage}` });
      assert.equal(diagnostics.deterministicRoute, classification.route);
      assert.equal(diagnostics.genericSemanticCandidate, true);
    }
    // A fallback leaves `route` untouched: non-Help routes dispatch to effectiveRoute === route.
    assert.ok(coreBody.includes("const dispatchRoute = semanticV2Dispatch ? semanticV2Dispatch.domain : effectiveRoute;"));
    assert.ok(coreBody.includes("const effectiveRoute = route === \"Help\" && semanticRequest"));
  });
}

// ── SECURITY ───────────────────────────────────────────────────────────────────

test("31. auth unchanged - no auth/admin helpers in the router; capability gates untouched", () => {
  assert.ok(!/requireActiveUser|requireSystemOwner|createAdminClient|service_role/i.test(router));
  assert.ok(coreBody.includes("request = { ...request, message: semanticV2Dispatch.canonicalMessage };"));
});

test("32. no DB rows to the classifier - candidate helper is pure and V2 input is unchanged", () => {
  assert.ok(orchestrator.includes("await extractNoaSemanticRequestV2({ context: request.context, message: request.message });"));
  assert.ok(coreBody.includes("isNoaGenericSemanticCandidate(request.message, routeClassification)"));
  assert.ok(!/from "@\/|supabase|server-only/.test(router));
});

test("33. no identifiers from the semantic model - dispatch carries resolver-owned fields only", () => {
  const { decision } = decideNoaSemanticV2Outcome(
    success(semantic({ domain: "Procurement", entityType: "procurement_order", intent: "list", procurementStatus: "active" })),
    ACTIVE_PROCUREMENT,
  );
  assert.deepEqual(Object.keys(decision).sort(), ["canonicalMessage", "domain", "kind"]);
});

test("34. no new capability calculations - one call per capability, no new fetch sites", () => {
  for (const call of ["await fetchNoaInsightsCapability(", "await fetchNoaProjectCapability(", "await fetchNoaProcurementCapability(", "await fetchNoaProductCapability("]) {
    assert.equal(coreBody.split(call).length - 1, 1, call);
  }
  assert.equal((orchestrator.match(/extractNoaSemanticRequestV2\(/g) ?? []).length, 1);
  assert.equal((coreBody.match(/await runNoaSemanticV2\(/g) ?? []).length, 2);
});

test("35. no schema/RLS changes - V2 contract version untouched, router has no SQL", () => {
  assert.ok(readFileSync("lib/noa/noa-semantic-request.ts", "utf8").includes("export const NOA_SEMANTIC_REQUEST_V2_VERSION = 2 as const;"));
  assert.ok(!/create policy|alter table|\.from\(/i.test(router));
});

// ── REGRESSIONS ────────────────────────────────────────────────────────────────

test("36. 'Who is our best client?' still clarifies", () => {
  const best = evaluate("Who is our best client?");
  assert.deepEqual(best.classification, { route: "Quotation", rule: "client_ranking_cue", strength: "none" });
  assert.equal(best.eligible, true);
  const { decision } = decideNoaSemanticV2Outcome(success(semantic({ confidence: "low", domain: "Client", entityType: "client", intent: "rank" })), best.classification);
  assert.equal(decision.kind, "answer");
});

test("37. 'Who is our best client based on quotation?' still ranks", () => {
  const best = evaluate("Who is our best client based on quotation?");
  assert.equal(best.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value" })), best.classification).decision,
    { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" },
  );
});

test("38. 'Anything I need to deal with?' still Attention", () => {
  const result = evaluate("Anything I need to deal with?");
  assert.equal(result.eligible, true);
  assert.deepEqual(
    decideNoaSemanticV2Outcome(success(semantic({ domain: "Attention", intent: "attention" })), result.classification).decision,
    { canonicalMessage: "what needs my attention", domain: "Attention", kind: "dispatch" },
  );
});

test("39. 'what happened yesterday' still Catch-Up", () => {
  assert.deepEqual(assertProtected("what happened yesterday"), { route: "UserActivity", rule: "catch_up", strength: "anchored" });
});

test("40. 'quotation analytics' still Insights (also from a Project page)", () => {
  assert.deepEqual(assertProtected("quotation analytics", projectsPage), { route: "Insights", rule: "insights", strength: "anchored" });
});

// ── OBSERVABILITY ──────────────────────────────────────────────────────────────

test("I4 diagnostics: genericSemanticCandidate is a boolean only - never message text", () => {
  const message = "Which SecretCustomerCo projects are finished?";
  const classification = classifyNoaRouteWithStrength(message, dashboard);
  const diagnostics = buildNoaRouteDiagnostics(classification, undefined, "route_strength_generic_keyword", isNoaGenericSemanticCandidate(message, classification));
  assert.equal(typeof diagnostics.genericSemanticCandidate, "boolean");
  assert.ok(!JSON.stringify(diagnostics).includes("SecretCustomerCo"));
  assert.equal(buildNoaRouteDiagnostics(UNRESOLVED).genericSemanticCandidate, false);
  assert.ok(coreBody.includes("buildNoaRouteDiagnostics(routeClassification, undefined, semanticV2Eligibility.reason, genericSemanticCandidate)"));
});

test("I4 page context: an analytics question on a Product/Project page still resolves to Insights", () => {
  for (const context of [productsPage, projectsPage]) {
    const result = evaluate("Which client has the highest quotation value?", { context });
    assert.equal(result.eligible, true);
    assert.deepEqual(
      decideNoaSemanticV2Outcome(success(semantic({ domain: "Client", entityType: "client", intent: "rank", metric: "quotation_value" })), result.classification).decision,
      { canonicalMessage: "top clients by quotation value", domain: "Insights", kind: "dispatch" },
    );
  }
});
