import assert from "node:assert/strict";
import test from "node:test";
import { classifyNoaRouteWithStrength } from "./noa-intent-router.js";
import { resolveNoaSemanticCapabilityRequest } from "./noa-semantic-resolver.js";
import { UNCLEAR_SEMANTIC_REQUEST_V2, type NoaSemanticRequestV2 } from "./noa-semantic-request.js";
import { NOA_SEMANTIC_EVAL_CORPUS, NOA_SEMANTIC_LIVE_EVAL_SAMPLE } from "./noa-semantic-eval-corpus.js";

const contexts = {
  dashboard: { pathname: "/", section: "dashboard" },
  products: { pathname: "/products", section: "products" },
  projects: { pathname: "/projects", section: "projects" },
  quotations: { pathname: "/quotations", section: "quotations" },
} as const;

test("I6 corpus has broad closed-category coverage and a fixed manual provider sample", () => {
  assert.ok(NOA_SEMANTIC_EVAL_CORPUS.length >= 80 && NOA_SEMANTIC_EVAL_CORPUS.length <= 120);
  assert.equal(new Set(NOA_SEMANTIC_EVAL_CORPUS.map((entry) => entry.id)).size, NOA_SEMANTIC_EVAL_CORPUS.length);
  for (const category of ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Attention", "Help", "Unclear"]) {
    assert.ok(NOA_SEMANTIC_EVAL_CORPUS.filter((entry) => entry.category === category).length >= 3, category);
  }
  assert.equal(NOA_SEMANTIC_LIVE_EVAL_SAMPLE.length, 20);
});

test("I6 corpus preserves deterministic route and protected-route expectations", () => {
  for (const entry of NOA_SEMANTIC_EVAL_CORPUS) {
    const actual = classifyNoaRouteWithStrength(entry.message, contexts[entry.context ?? "dashboard"] as never);
    assert.equal(actual.route, entry.route, entry.id);
    if (entry.protected && actual.strength === "none") {
      // QN/CO/PO routing is deliberately protected one layer later by the orchestrator's exact
      // identifier parsers; the pure route classifier has no authority to consume identifiers.
      assert.match(entry.message, /\b(?:QN|CO|PO)-\d{3,}/i, entry.id);
    }
  }
});

test("I6 corpus resolver expectations use only closed, synthetic semantic fields", () => {
  for (const entry of NOA_SEMANTIC_EVAL_CORPUS) {
    if (!entry.semantic || !entry.resolverKind) continue;
    const semantic = { ...UNCLEAR_SEMANTIC_REQUEST_V2, confidence: "high", ...entry.semantic } as NoaSemanticRequestV2;
    const resolution = resolveNoaSemanticCapabilityRequest(semantic);
    assert.equal(resolution.kind, entry.resolverKind, entry.id);
    if (entry.canonicalMessage && resolution.kind === "dispatch") {
      assert.equal(resolution.canonicalMessage, entry.canonicalMessage, entry.id);
    }
  }
});
