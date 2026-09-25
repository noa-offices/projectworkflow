import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { decideNoaSemanticV2Outcome, type NoaRouteClassification, type NoaSemanticV2ExtractionStage } from "./noa-intent-router.js";
import { resolveNoaSemanticCapabilityRequest, validateNoaSemanticCompatibility } from "./noa-semantic-resolver.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";

// I6.3: closed semantic compatibility gate. The model proposes a shape; this pure table decides
// whether it is coherent before any resolver mapping can dispatch it.

function semantic(overrides: Partial<NoaSemanticRequestV2>): NoaSemanticRequestV2 {
  return { ...UNCLEAR_SEMANTIC_REQUEST_V2, confidence: "high", ...overrides };
}

const UNRESOLVED: NoaRouteClassification = { route: "Help", rule: "unresolved", strength: "none" };

function decide(request: NoaSemanticRequestV2, stage: NoaSemanticV2ExtractionStage = "success") {
  return decideNoaSemanticV2Outcome({ request, stage }, UNRESOLVED);
}

function assertCompatible(request: NoaSemanticRequestV2) {
  assert.deepEqual(validateNoaSemanticCompatibility(request), { compatible: true }, JSON.stringify(request));
}

function assertIncompatible(request: NoaSemanticRequestV2, reason: string) {
  assert.deepEqual(validateNoaSemanticCompatibility(request), { compatible: false, reason }, JSON.stringify(request));
  // Fail closed: the resolver never maps an incompatible shape, whatever it would otherwise produce.
  assert.deepEqual(resolveNoaSemanticCapabilityRequest(request), { kind: "fallback", reason: `semantic_incompatible_${reason}` });
}

// ── VALID ───────────────────────────────────────────────────────────────────────

test("1-8. valid combinations derived from the resolver are compatible", () => {
  for (const request of [
    semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value" }),
    semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "confirmed_value", quotationStatus: "client_confirmed" }),
    semantic({ domain: "Project", intent: "count", entityType: "project_file", projectFileStatus: "active" }),
    semantic({ domain: "Product", intent: "list", entityType: "product", entityText: "chairs" }),
    semantic({ domain: "Procurement", intent: "list", entityType: "procurement_order", procurementStatus: "active" }),
    semantic({ domain: "UserActivity", intent: "history", period: "yesterday" }),
    semantic({ domain: "Insights", intent: "aggregate", metric: "quotation_value" }),
    semantic({ domain: "Attention", intent: "attention" }),
  ]) {
    assertCompatible(request);
  }
});

// ── INVALID ─────────────────────────────────────────────────────────────────────

test("9. procurement semantics can never become an Attention dispatch", () => {
  assertIncompatible(semantic({ domain: "Procurement", intent: "attention" }), "unsupported_domain_intent");
  assertIncompatible(semantic({ domain: "Attention", intent: "attention", entityType: "supplier" }), "incompatible_entity_type");
  assertIncompatible(semantic({ domain: "Attention", intent: "attention", entityType: "procurement_order" }), "incompatible_entity_type");
  assertIncompatible(semantic({ domain: "Attention", intent: "attention", attentionKind: "procurement_missing_eta" }), "incompatible_status");
  assertIncompatible(semantic({ domain: "Attention", intent: "list", procurementStatus: "active" }), "unsupported_domain_intent");
});

test("10. Product semantics can never dispatch Admin (Admin has no semantic destination)", () => {
  assertIncompatible(semantic({ domain: "Admin", intent: "list", entityType: "product" }), "unsupported_domain_intent");
  assertIncompatible(semantic({ domain: "Admin", intent: "list", entityType: "user" }), "unsupported_domain_intent");
  assertIncompatible(semantic({ domain: "Product", intent: "list", entityType: "user" }), "incompatible_entity_type");
});

test("11. Client rank + active_time is incompatible", () => {
  assertIncompatible(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "active_time" }), "incompatible_metric");
});

test("12. Product + project_file_value is incompatible", () => {
  assertIncompatible(semantic({ domain: "Product", intent: "list", entityType: "product", metric: "project_file_value" }), "incompatible_metric");
});

test("13. Procurement + confirmed_value is incompatible", () => {
  assertIncompatible(semantic({ domain: "Procurement", intent: "count", entityType: "procurement_order", metric: "confirmed_value" }), "incompatible_metric");
});

test("14. history can never become a current-state capability", () => {
  assertIncompatible(semantic({ domain: "UserActivity", intent: "lookup", entityType: "project_file" }), "unsupported_domain_intent");
  assertIncompatible(semantic({ domain: "Insights", intent: "history" }), "unsupported_domain_intent");
  // Entity-scoped history stays history: it maps to Catch-Up, never Project/Quotation detail.
  const projectHistory = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "history", entityType: "project_file", period: "today" }));
  assert.equal(projectHistory.kind, "dispatch");
  if (projectHistory.kind === "dispatch") assert.equal(projectHistory.domain, "UserActivity");
});

test("15. Attention + unrelated quotationStatus is incompatible", () => {
  assertIncompatible(semantic({ domain: "Attention", intent: "attention", quotationStatus: "draft" }), "incompatible_status");
});

test("16. Project + procurementStatus is incompatible", () => {
  assertIncompatible(semantic({ domain: "Project", intent: "list", entityType: "project_file", procurementStatus: "active" }), "incompatible_status");
});

test("17. Client rank + product entityType is incompatible", () => {
  assertIncompatible(semantic({ domain: "Client", intent: "rank", entityType: "product", metric: "quotation_value" }), "incompatible_entity_type");
});

test("18. Quotation lookup + client entityType is incompatible", () => {
  assertIncompatible(semantic({ domain: "Quotation", intent: "lookup", entityType: "client", entityText: "Acme" }), "incompatible_entity_type");
});

test("19. previous_result never rescues an incompatible combination", () => {
  assertIncompatible(semantic({ domain: "Procurement", intent: "attention", reference: "previous_result", ordinal: 2 }), "unsupported_domain_intent");
  assertIncompatible(semantic({ domain: "Client", intent: "lookup", entityType: "client", metric: "confirmed_value", reference: "previous_result" }), "incompatible_metric");
});

test("20. current_page never rescues an incompatible combination", () => {
  assertIncompatible(semantic({ domain: "Attention", intent: "attention", entityType: "project_file", reference: "current_page" }), "incompatible_entity_type");
  assertIncompatible(semantic({ domain: "Project", intent: "lookup", entityType: "quotation", reference: "current_page" }), "incompatible_entity_type");
});

test("named_user subject outside UserActivity is incompatible", () => {
  assertIncompatible(semantic({ domain: "Client", intent: "list", entityType: "client", subject: "named_user", subjectName: "Alex" }), "unsupported_combination");
});

// ── NORMALIZATION ───────────────────────────────────────────────────────────────

test("21. Client rank still normalizes to Insights ownership", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Client", intent: "rank", entityType: "client", metric: "quotation_count" }));
  assert.deepEqual(result.kind === "dispatch" ? [result.domain, result.canonicalMessage] : result, ["Insights", "how many quotations does each client have"]);
});

test("22. Project aggregate still normalizes to Insights where supported", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Project", intent: "aggregate", metric: "project_file_value" }));
  assert.deepEqual(result.kind === "dispatch" ? [result.domain, result.canonicalMessage] : result, ["Insights", "project file analytics"]);
});

// ── RUNTIME ─────────────────────────────────────────────────────────────────────

test("23/24. an incompatible semantic result cannot dispatch and falls back deterministically", () => {
  const { decision, diagnostics } = decide(semantic({ domain: "Attention", intent: "attention", entityType: "supplier" }));
  assert.deepEqual(decision, { kind: "fallback", reason: "semantic_incompatible_incompatible_entity_type" });
  assert.equal(diagnostics.resolverKind, "fallback");
  // Same shape on a page_context route: the page-bound deterministic route keeps the message.
  const page = decideNoaSemanticV2Outcome(
    { request: semantic({ domain: "Procurement", intent: "attention" }), stage: "success" },
    { route: "Quotation", rule: "page_context", strength: "page_context" },
  );
  assert.equal(page.decision.kind, "fallback");
});

test("25. high confidence does NOT bypass compatibility", () => {
  const { decision } = decide(semantic({ confidence: "high", domain: "Client", intent: "rank", entityType: "client", metric: "active_time" }));
  assert.deepEqual(decision, { kind: "fallback", reason: "semantic_incompatible_incompatible_metric" });
});

test("26. the I5.2 deterministic low-confidence override does NOT bypass compatibility", () => {
  // Would satisfy every I5.2 allow-list condition except that it also carries an unrelated status.
  const { decision, diagnostics } = decide(semantic({
    confidence: "low", domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value", procurementStatus: "active",
  }));
  assert.deepEqual(decision, { kind: "fallback", reason: "semantic_incompatible_incompatible_status" });
  assert.equal(diagnostics.confidenceOverride, null);
  // The override itself is unchanged for a compatible shape.
  const allowed = decide(semantic({ confidence: "low", domain: "Client", intent: "rank", entityType: "client", metric: "quotation_value" }));
  assert.equal(allowed.decision.kind, "dispatch");
  assert.equal(allowed.diagnostics.confidenceOverride, "deterministic_safe_dispatch");
});

test("27. action_requested remains blocked (read-only refusal, never a dispatch)", () => {
  const result = resolveNoaSemanticCapabilityRequest(semantic({ domain: "Procurement", intent: "attention", clarificationReason: "action_requested" }));
  assert.equal(result.kind, "unsupported");
  if (result.kind === "unsupported") assert.match(result.text, /read-only/);
});

test("28. provider/schema/grounding failures are unchanged", () => {
  for (const stage of ["provider_error", "invalid_json", "schema_mismatch", "grounding_failed", "disabled"] as const) {
    assert.deepEqual(decide(UNCLEAR_SEMANTIC_REQUEST_V2, stage).decision, { kind: "fallback", reason: `semantic_${stage}` });
  }
});

test("I5 binder receives no model slots from an incompatible extraction (reference cannot repair it)", () => {
  const orchestrator = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.ok(orchestrator.includes('extracted.clarificationReason === "action_requested" || validateNoaSemanticCompatibility(extracted).compatible'));
  assert.ok(orchestrator.includes("semantic: bindingSemantic,"));
});

test("the compatibility gate is pure and data-free (no provider, DB, or auth imports in the resolver)", () => {
  const resolver = readFileSync("lib/noa/noa-semantic-resolver.ts", "utf8");
  const imports = resolver.split("\n").filter((line) => /^import\b/.test(line.trim()));
  assert.ok(imports.every((line) => line.includes("import type")));
  const extractor = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
  assert.ok(!extractor.includes("validateNoaSemanticCompatibility"), "prompt/extractor untouched by I6.3");
});
