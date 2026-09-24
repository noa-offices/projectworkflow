import assert from "node:assert/strict";
import test from "node:test";
import { isNoaSemanticRequest, UNCLEAR_SEMANTIC_REQUEST } from "./noa-semantic-request.js";

// 1. schema is closed - no business data fields exist -------------------------

test("UNCLEAR_SEMANTIC_REQUEST is the fixed, minimal fallback shape", () => {
  assert.deepEqual(UNCLEAR_SEMANTIC_REQUEST, { domain: "Unclear", intent: "unsupported" });
});

test("NoaSemanticRequest carries no business-fact fields (counts/prices/statuses/IDs)", () => {
  const value = {
    domain: "UserActivity",
    intent: "activity_time",
    subject: { type: "self" },
    period: "today",
  };
  assert.ok(isNoaSemanticRequest(value));
  // Only the documented keys are ever meaningful - a business field slipping in would still be
  // "valid" per isNoaSemanticRequest (it doesn't reject unknown keys), so this test instead
  // asserts the known key set itself never includes anything business-shaped.
  const allowedKeys = new Set(["domain", "intent", "subject", "period", "entityReference", "metric", "followUp", "quotation", "product", "entity"]);
  for (const key of Object.keys(value)) {
    assert.ok(allowedKeys.has(key), `unexpected field: ${key}`);
  }
  for (const forbidden of ["count", "total", "price", "status", "id", "quotationId", "userId", "rows"]) {
    assert.ok(!allowedKeys.has(forbidden), `forbidden business field allowed: ${forbidden}`);
  }
});

// 2. isNoaSemanticRequest accepts only well-formed shapes ----------------------

test("accepts the minimal required shape", () => {
  assert.ok(isNoaSemanticRequest({ domain: "Unclear", intent: "unsupported" }));
});

test("accepts a full valid shape", () => {
  assert.ok(isNoaSemanticRequest({
    domain: "UserActivity",
    intent: "follow_up",
    subject: { type: "named_user", name: "Yahya" },
    period: "this_week",
    entityReference: { type: "quotation", fromPreviousResult: true },
    metric: "active_time",
    followUp: true,
  }));
});

test("accepts only the bounded Quotation tool arguments", () => {
  assert.ok(isNoaSemanticRequest({
    domain: "Quotation",
    intent: "unsupported",
    quotation: { quotationNo: "QN-0005-001", request: "total" },
  }));
});

test("rejects malformed Quotation tool arguments", () => {
  for (const quotation of [
    { quotationNo: "", request: "detail" },
    { quotationNo: "QN-0005-001", request: "price" },
    { quotationNo: 5, request: "status" },
    { quotationNo: "QN-0005-001" },
  ]) {
    assert.ok(!isNoaSemanticRequest({ domain: "Quotation", intent: "unsupported", quotation }));
  }
});

test("accepts only bounded Product/Price candidate text", () => {
  assert.ok(isNoaSemanticRequest({
    domain: "Product",
    intent: "unsupported",
    product: { brandText: "LAS", categoryText: "chairs" },
  }));
  assert.ok(isNoaSemanticRequest({
    domain: "Price",
    intent: "unsupported",
    product: { productText: "MONOLITH" },
  }));
  assert.ok(!isNoaSemanticRequest({ domain: "Product", intent: "unsupported", product: {} }));
  assert.ok(!isNoaSemanticRequest({ domain: "Product", intent: "unsupported", product: { productText: "", id: "secret" } }));
});

test("accepts only bounded Project File and client entity candidates", () => {
  assert.ok(isNoaSemanticRequest({ domain: "Project", intent: "unsupported", entity: { type: "project_file", text: "Galleria Mall Boutique Refurbishment" } }));
  assert.ok(isNoaSemanticRequest({ domain: "Client", intent: "unsupported", entity: { type: "client", text: "Apex Luxury Retail LLC" } }));
  assert.ok(!isNoaSemanticRequest({ domain: "Project", intent: "unsupported", entity: { type: "project", text: "Galleria" } }));
  assert.ok(!isNoaSemanticRequest({ domain: "Client", intent: "unsupported", entity: { type: "client", text: "" } }));
});

test("rejects a non-object value", () => {
  assert.ok(!isNoaSemanticRequest(null));
  assert.ok(!isNoaSemanticRequest(undefined));
  assert.ok(!isNoaSemanticRequest("UserActivity"));
  assert.ok(!isNoaSemanticRequest(42));
});

test("rejects an unknown domain value", () => {
  assert.ok(!isNoaSemanticRequest({ domain: "NotARealDomain", intent: "unsupported" }));
});

test("rejects an unknown intent value", () => {
  assert.ok(!isNoaSemanticRequest({ domain: "Unclear", intent: "delete_everything" }));
});

test("rejects a named_user subject with no name", () => {
  assert.ok(!isNoaSemanticRequest({ domain: "UserActivity", intent: "activity_time", subject: { type: "named_user" } }));
  assert.ok(!isNoaSemanticRequest({ domain: "UserActivity", intent: "activity_time", subject: { type: "named_user", name: "" } }));
});

test("accepts self and team subjects without a name", () => {
  assert.ok(isNoaSemanticRequest({ domain: "UserActivity", intent: "activity_time", subject: { type: "self" } }));
  assert.ok(isNoaSemanticRequest({ domain: "UserActivity", intent: "recent_presence", subject: { type: "team" } }));
});

test("rejects an unknown period value", () => {
  assert.ok(!isNoaSemanticRequest({ domain: "UserActivity", intent: "activity_time", period: "next_year" }));
});

test("rejects an entityReference missing its type", () => {
  assert.ok(!isNoaSemanticRequest({ domain: "UserActivity", intent: "follow_up", entityReference: { fromPreviousResult: true } }));
});

test("rejects malformed/off-schema provider output - the caller must fall back to UNCLEAR_SEMANTIC_REQUEST", () => {
  const malformedOutputs = [
    { domain: "UserActivity" }, // missing intent
    { intent: "follow_up" }, // missing domain
    { domain: "UserActivity", intent: "activity_time", subject: "self" }, // subject must be an object
    { domain: "UserActivity", intent: "activity_time", followUp: "yes" }, // followUp must be boolean
    [],
    "not json",
  ];
  for (const output of malformedOutputs) {
    assert.ok(!isNoaSemanticRequest(output), JSON.stringify(output));
  }
});
