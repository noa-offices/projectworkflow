import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  isNoaSemanticRequest,
  isNoaSemanticRequestV2,
  NOA_SEMANTIC_REQUEST_V2_SCHEMA,
  UNCLEAR_SEMANTIC_REQUEST,
  UNCLEAR_SEMANTIC_REQUEST_V2,
  validateNoaSemanticRequestV2AgainstMessage,
  type NoaSemanticRequestV2,
} from "./noa-semantic-request.js";

// I1: V2 is additive alongside V1 - see noa-semantic-request.ts and noa-intent-extractor.server.ts
// for the full rationale. This suite validates the V2 contract/schema/validators in isolation and
// separately asserts (source-level, same convention as other *-safety.test.mts files) that I1
// changed nothing about runtime routing/dispatch/V1 behavior.

const FULL_VALID_V2: NoaSemanticRequestV2 = {
  version: 2,
  domain: "Insights",
  intent: "rank",
  entityType: "client",
  entityText: "Acme",
  reference: "none",
  ordinal: null,
  metric: "quotation_value",
  period: "this_month",
  comparison: null,
  sortDirection: "desc",
  subject: null,
  subjectName: null,
  quotationStatus: null,
  projectFileStatus: null,
  priceStatus: null,
  procurementStatus: null,
  attentionKind: null,
  needsClarification: false,
  clarificationReason: null,
  confidence: "high",
};

function withField<K extends keyof NoaSemanticRequestV2>(base: NoaSemanticRequestV2, key: K, value: NoaSemanticRequestV2[K]): NoaSemanticRequestV2 {
  return { ...base, [key]: value };
}

// 1. V2 domain contains every real NoaDomain + Unclear ------------------------------------------

test("1. V2 domain accepts every real NoaDomain member plus Unclear", () => {
  // Mirrors NoaDomain's exact literal members from lib/noa/noa-types.ts - if that union ever
  // changes, this list (and the V2 domain enum) must be updated together.
  const realNoaDomains = ["Product", "Quotation", "Price", "Project", "Client", "Procurement", "UserActivity", "Admin", "Insights", "Attention", "Help"];
  for (const domain of [...realNoaDomains, "Unclear"]) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "domain", domain as never)), `domain rejected: ${domain}`);
  }
});

// 2. Attention accepted --------------------------------------------------------------------------

test("2. Attention domain is accepted by V2 (V1's known gap - I0 PART 4 finding 1)", () => {
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "domain", "Attention")));
});

// 3/4. intents ------------------------------------------------------------------------------------

test("3. every V2 intent is accepted", () => {
  const intents = ["lookup", "list", "count", "aggregate", "rank", "compare", "trend", "history", "attention", "activity", "activity_time", "presence", "howto", "unsupported"];
  for (const intent of intents) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "intent", intent as never)), `intent rejected: ${intent}`);
  }
});

test("4. unknown intent is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "intent", "follow_up" as never)), false);
});

// 5/6. entity types ---------------------------------------------------------------------------

test("5. every V2 entity type is accepted", () => {
  const entityTypes = ["quotation", "project_file", "client", "product", "brand", "product_category", "supplier", "procurement_order", "user", "role", "ai_provider", "ai_agent"];
  for (const entityType of entityTypes) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "entityType", entityType as never)), `entityType rejected: ${entityType}`);
  }
});

test("6. unknown entity type is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "entityType", "payment" as never)), false);
});

// 7/8/9. metrics ------------------------------------------------------------------------------

test("7. every V2 metric is accepted", () => {
  const metrics = ["quotation_count", "quotation_value", "average_quotation_value", "confirmed_count", "confirmed_value", "project_file_count", "project_file_value", "client_count", "product_count", "price_status_count", "procurement_order_count", "active_time"];
  for (const metric of metrics) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "metric", metric as never)), `metric rejected: ${metric}`);
  }
});

test("8. conversion_rate is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "metric", "conversion_rate" as never)), false);
});

test("9. profit is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "metric", "profit" as never)), false);
});

// 10/11. periods -----------------------------------------------------------------------------

test("10. every V2 period is accepted", () => {
  const periods = ["today", "yesterday", "this_week", "last_7_days", "this_month", "last_month", "this_quarter", "last_quarter", "this_year"];
  for (const period of periods) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "period", period as never)), `period rejected: ${period}`);
  }
});

test("11. unknown period is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "period", "last_year" as never)), false);
});

// 12/13. reference -----------------------------------------------------------------------------

test("12. every V2 reference value is accepted", () => {
  for (const reference of ["none", "previous_result", "current_page"]) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "reference", reference as never)), `reference rejected: ${reference}`);
  }
});

test("13. an open reference string is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "reference", "last_answer" as never)), false);
});

// 14-17. ordinal -------------------------------------------------------------------------------

test("14. ordinal 1 is accepted", () => {
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "ordinal", 1)));
});

test("15. ordinal 10 is accepted", () => {
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "ordinal", 10)));
});

test("16. ordinal 11 is rejected", () => {
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "ordinal", 11 as never)), false);
});

test("17. ordinal \"last\" is accepted", () => {
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "ordinal", "last")));
});

// 18/19. subject/subjectName relationship --------------------------------------------------------

test("18. subject \"named_user\" requires a non-null subjectName", () => {
  const withoutName = withField(withField(FULL_VALID_V2, "subject", "named_user"), "subjectName", null);
  assert.equal(isNoaSemanticRequestV2(withoutName), false);
  const withName = withField(withField(FULL_VALID_V2, "subject", "named_user"), "subjectName", "Alex");
  assert.ok(isNoaSemanticRequestV2(withName));
});

test("19. subjectName must be null when subject is not \"named_user\"", () => {
  const selfWithName = withField(withField(FULL_VALID_V2, "subject", "self"), "subjectName", "Alex");
  assert.equal(isNoaSemanticRequestV2(selfWithName), false);
  const nullSubjectWithName = withField(withField(FULL_VALID_V2, "subject", null), "subjectName", "Alex");
  assert.equal(isNoaSemanticRequestV2(nullSubjectWithName), false);
});

// 20. clarification reason closed enum -----------------------------------------------------------

test("20. clarificationReason is a closed enum", () => {
  const reasons = ["missing_metric", "missing_entity", "ambiguous_entity_type", "ambiguous_reference", "unsupported_period", "unsupported_metric", "multiple_requests", "action_requested"];
  for (const reason of reasons) {
    assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "clarificationReason", reason as never)), `reason rejected: ${reason}`);
  }
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "clarificationReason", "not_a_real_reason" as never)), false);
});

// 21. confidence only high/low -------------------------------------------------------------------

test("21. confidence only accepts high/low", () => {
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "confidence", "high")));
  assert.ok(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "confidence", "low")));
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "confidence", 0.8 as never)), false);
  assert.equal(isNoaSemanticRequestV2(withField(FULL_VALID_V2, "confidence", "medium" as never)), false);
});

// 22-24. message grounding ------------------------------------------------------------------------

test("22. entityText absent from the message fails grounding", () => {
  const request = withField(FULL_VALID_V2, "entityText", "Beta Corp");
  assert.equal(validateNoaSemanticRequestV2AgainstMessage(request, "who is our best client"), false);
});

test("23. entityText present case-insensitively in the message succeeds grounding", () => {
  const request = withField(FULL_VALID_V2, "entityText", "acme");
  assert.ok(validateNoaSemanticRequestV2AgainstMessage(request, "How much has ACME confirmed?"));
});

test("24. a named_user subjectName absent from the message fails grounding", () => {
  // entityText is cleared here so only the subjectName/message relationship is under test.
  const base = withField(FULL_VALID_V2, "entityText", null);
  const request = withField(withField(base, "subject", "named_user"), "subjectName", "Priya");
  assert.equal(validateNoaSemanticRequestV2AgainstMessage(request, "what did Alex work on today"), false);
  const grounded = withField(withField(base, "subject", "named_user"), "subjectName", "Alex");
  assert.ok(validateNoaSemanticRequestV2AgainstMessage(grounded, "what did Alex work on today"));
});

// 25. full unclear V2 object validates -------------------------------------------------------------

test("25. UNCLEAR_SEMANTIC_REQUEST_V2 is itself a valid, fully-null V2 object", () => {
  assert.ok(isNoaSemanticRequestV2(UNCLEAR_SEMANTIC_REQUEST_V2));
  assert.deepEqual(UNCLEAR_SEMANTIC_REQUEST_V2, {
    version: 2,
    domain: "Unclear",
    intent: "unsupported",
    entityType: null,
    entityText: null,
    reference: "none",
    ordinal: null,
    metric: null,
    period: null,
    comparison: null,
    sortDirection: null,
    subject: null,
    subjectName: null,
    quotationStatus: null,
    projectFileStatus: null,
    priceStatus: null,
    procurementStatus: null,
    attentionKind: null,
    needsClarification: false,
    clarificationReason: null,
    confidence: "low",
  });
  // Grounds trivially: no entityText, no named_user subject.
  assert.ok(validateNoaSemanticRequestV2AgainstMessage(UNCLEAR_SEMANTIC_REQUEST_V2, "anything at all"));
});

// 26/27. strict wire schema shape ------------------------------------------------------------------

test("26. every root schema property appears in `required`", () => {
  const propertyNames = Object.keys(NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties);
  const required = NOA_SEMANTIC_REQUEST_V2_SCHEMA.required as readonly string[];
  for (const name of propertyNames) {
    assert.ok(required.includes(name), `property not required: ${name}`);
  }
  assert.equal(required.length, propertyNames.length);
});

test("27. schema has no optional root property (required.length === properties.length, additionalProperties false)", () => {
  assert.equal(NOA_SEMANTIC_REQUEST_V2_SCHEMA.additionalProperties, false);
  assert.equal(NOA_SEMANTIC_REQUEST_V2_SCHEMA.type, "object");
});

// 28. no open-ended arbitrary metric -------------------------------------------------------------

test("28. the wire schema's metric property is a closed enum, not an open string", () => {
  const metricSchema = NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.metric as { enum?: readonly unknown[] };
  assert.ok(Array.isArray(metricSchema.enum) && metricSchema.enum.length > 0);
  assert.ok(!("maxLength" in metricSchema));
});

// 29. no unsafe fields anywhere in the schema/type surface -----------------------------------------

test("29. schema exposes no userId/role-as-authority/sql/table/filter/provider/model fields", () => {
  const forbidden = ["userId", "role", "sql", "table", "filter", "provider", "model", "rpc", "column", "serviceRole", "adminMode"];
  const schemaJson = JSON.stringify(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  for (const term of forbidden) {
    // "role" alone would false-positive on unrelated substrings (e.g. none here), so match it as
    // a schema property key specifically: `"role":` never appears at all.
    assert.ok(!schemaJson.includes(`"${term}":`), `forbidden field present in schema: ${term}`);
  }
});

// 30. flat schema (or every nested object's properties are all required) ---------------------------

test("30. the wire schema is fully flat - no nested object/array property types", () => {
  for (const [name, def] of Object.entries(NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties)) {
    const type = (def as { type: string | string[] }).type;
    const types = Array.isArray(type) ? type : [type];
    assert.ok(!types.includes("object") && !types.includes("array"), `property ${name} is not flat: ${JSON.stringify(type)}`);
  }
});

// 31-33. V1 preserved, V2 added separately --------------------------------------------------------

test("31. V1 exports remain present and behave exactly as before", () => {
  assert.deepEqual(UNCLEAR_SEMANTIC_REQUEST, { domain: "Unclear", intent: "unsupported" });
  assert.ok(isNoaSemanticRequest({ domain: "Unclear", intent: "unsupported" }));
});

test("32/33. the extractor source still defines V1's extractor and separately defines a V2 extractor", () => {
  const extractorSource = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
  assert.ok(extractorSource.includes("export async function extractNoaSemanticRequest("), "V1 extractor missing");
  assert.ok(extractorSource.includes("export async function extractNoaSemanticRequestV2("), "V2 extractor missing");
  assert.notEqual(
    extractorSource.indexOf("export async function extractNoaSemanticRequest("),
    extractorSource.indexOf("export async function extractNoaSemanticRequestV2("),
  );
});

test("V2 instructions preserve the closed client-ranking metric, analytics, history, and Product qualifier concepts", () => {
  const extractorSource = readFileSync("lib/noa/noa-intent-extractor.server.ts", "utf8");
  for (const concept of [
    "quotation_count for how often clients are quoted",
    "quotation_value for monetary quotation value",
    "confirmed_value for confirmed business",
    "project_file_value for Project File value",
    "Use Insights for analytical overviews, comparisons, trends, and rankings",
    "UserActivity with intent history",
    "retain a named brand and its adjacent product/category qualifier",
  ]) {
    assert.ok(extractorSource.includes(concept), `missing V2 instruction: ${concept}`);
  }
});

// 34/35. nothing in routing/dispatch was touched -------------------------------------------------

// I3 wired V2 into the runtime behind the NOA_SEMANTIC_V2 flag: these two tests (originally "not
// referenced yet" checks) now pin down the single, bounded way V2 is reached.
test("34. the orchestrator calls the V2 extractor from exactly one place (runNoaSemanticV2, I3)", () => {
  const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
  assert.equal((orchestratorSource.match(/extractNoaSemanticRequestV2\(/g) ?? []).length, 1);
  const helperIndex = orchestratorSource.indexOf("async function runNoaSemanticV2(");
  const callIndex = orchestratorSource.indexOf("await extractNoaSemanticRequestV2(");
  assert.ok(helperIndex >= 0 && callIndex > helperIndex && callIndex < orchestratorSource.indexOf("async function runNoaOrchestratorCore("));
  assert.ok(!orchestratorSource.includes("noa-semantic-request-v2"), "no V2-only module exists");
});

test("35. the deterministic router references V2 only as a type (never the V2 extractor/provider)", () => {
  const routerSource = readFileSync("lib/noa/noa-intent-router.ts", "utf8");
  assert.ok(routerSource.includes('import type { NoaSemanticRequestV2 } from "./noa-semantic-request";'));
  assert.ok(!routerSource.includes("extractNoaSemanticRequestV2"));
  assert.ok(!routerSource.includes("runAiProvider"));
});
