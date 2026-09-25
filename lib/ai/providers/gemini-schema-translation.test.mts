import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { GeminiSchemaTranslationError, normalizeGeminiSemanticResponse, translateSchemaForGemini } from "./gemini-schema-translation.js";
import { NOA_SEMANTIC_REQUEST_V2_SCHEMA } from "../../noa/noa-semantic-request.js";

// I7.1: focused tests for the pure Gemini wire-schema translation, run directly against the real
// production module (not a copy) and, for the request-shape parity claims, against the REAL,
// unmodified NOA_SEMANTIC_REQUEST_V2_SCHEMA. gemini.server.ts itself is source-checked only (it
// has "server-only" and can't be executed by plain node/tsx - same repo-wide constraint documented
// in lib/ai/provider-infrastructure.test.mts).

const geminiSource = readFileSync("lib/ai/providers/gemini.server.ts", "utf8");
const openaiSource = readFileSync("lib/ai/providers/openai.server.ts", "utf8");
const anthropicSource = readFileSync("lib/ai/providers/anthropic.server.ts", "utf8");

// ── 1. shared V2 schema unchanged ────────────────────────────────────────────────

test("1. the shared V2 schema still has additionalProperties:false and type arrays for nullable fields (I7.1 never touched it)", () => {
  assert.equal(NOA_SEMANTIC_REQUEST_V2_SCHEMA.additionalProperties, false);
  assert.deepEqual(NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.entityText.type, ["string", "null"]);
  assert.deepEqual(NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.ordinal.type, ["integer", "string", "null"]);
});

// ── 2/3. additionalProperties handling ───────────────────────────────────────────

test("2. Gemini translation removes additionalProperties", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  assert.ok(!("additionalProperties" in translated));
});

test("3. OpenAI adapter source still sends the schema verbatim (retains additionalProperties:false, untouched by I7.1)", () => {
  assert.ok(openaiSource.includes("schema: request.responseSchema.schema,"));
  assert.ok(!openaiSource.includes("translateSchemaForGemini"));
});

// ── 4/5/6/7. nullable field / enum / boolean / number translation ───────────────

test("a non-string single-literal enum (version:integer,enum:[2]) drops the wire enum and carries the literal as a description hint instead - verified live to reliably reproduce the value", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  const version = translated.properties.version as { type: string; enum?: unknown; description: string };
  assert.equal(version.type, "integer");
  assert.ok(!("enum" in version));
  assert.match(version.description, /exactly 2/);
});

test("4. a nullable string field (entityText) translates to type:string, nullable:true", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  assert.deepEqual(translated.properties.entityText, { type: "string", nullable: true });
});

test("5. a nullable enum (metric) translates to a plain string enum with nullable:true and no null entry", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  const metric = translated.properties.metric as { type: string; enum: readonly unknown[]; nullable: boolean };
  assert.equal(metric.type, "string");
  assert.equal(metric.nullable, true);
  assert.ok(!metric.enum.includes(null));
  assert.ok(metric.enum.includes("quotation_value"));
});

test("6. a required boolean field (needsClarification) is not marked nullable", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  assert.deepEqual(translated.properties.needsClarification, { type: "boolean" });
});

test("7. a required non-nullable enum (confidence) is untouched", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  assert.deepEqual(translated.properties.confidence, { type: "string", enum: ["high", "low"] });
});

// ── 8-11. ordinal wire translation + normalization round-trip ───────────────────

test("8. ordinal wires as a nullable string enum, not the shared mixed-type union", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  const ordinal = translated.properties.ordinal as { type: string; enum: readonly string[]; nullable: boolean };
  assert.equal(ordinal.type, "string");
  assert.equal(ordinal.nullable, true);
  assert.deepEqual(ordinal.enum, ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "last"]);
});

test("8b. ordinal 1 -> wire \"1\" -> normalizes back to the number 1", () => {
  const normalized = normalizeGeminiSemanticResponse({ ordinal: "1" }) as { ordinal: unknown };
  assert.equal(normalized.ordinal, 1);
  assert.equal(typeof normalized.ordinal, "number");
});

test("9. ordinal 10 normalizes correctly", () => {
  const normalized = normalizeGeminiSemanticResponse({ ordinal: "10" }) as { ordinal: unknown };
  assert.equal(normalized.ordinal, 10);
});

test('10. ordinal "last" is preserved as the string "last"', () => {
  const normalized = normalizeGeminiSemanticResponse({ ordinal: "last" }) as { ordinal: unknown };
  assert.equal(normalized.ordinal, "last");
});

test("11. ordinal null is preserved as null", () => {
  const normalized = normalizeGeminiSemanticResponse({ ordinal: null }) as { ordinal: unknown };
  assert.equal(normalized.ordinal, null);
});

test("an out-of-enum ordinal string is passed through unchanged, never coerced (left to fail the shared validator normally)", () => {
  const normalized = normalizeGeminiSemanticResponse({ ordinal: "eleven" }) as { ordinal: unknown };
  assert.equal(normalized.ordinal, "eleven");
});

test("normalization only touches the ordinal key - every other field passes through untouched", () => {
  const input = { domain: "Client", intent: "rank", ordinal: "3", metric: "quotation_value" };
  const normalized = normalizeGeminiSemanticResponse(input) as Record<string, unknown>;
  assert.equal(normalized.domain, "Client");
  assert.equal(normalized.intent, "rank");
  assert.equal(normalized.metric, "quotation_value");
  assert.equal(normalized.ordinal, 3);
});

test("normalization is a no-op for a response with no ordinal key, and for non-object input", () => {
  assert.deepEqual(normalizeGeminiSemanticResponse({ domain: "Client" }), { domain: "Client" });
  assert.equal(normalizeGeminiSemanticResponse(null), null);
  assert.equal(normalizeGeminiSemanticResponse("not an object"), "not an object");
});

// ── 12/13. required fields + validator round-trip ────────────────────────────────

test("12. every V2 root property is still listed in the Gemini wire schema's required array", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  const propertyNames = Object.keys(translated.properties!);
  for (const name of propertyNames) assert.ok(translated.required!.includes(name), name);
  assert.equal(translated.required!.length, propertyNames.length);
});

test("13. a realistic Gemini wire response normalizes into an object isNoaSemanticRequestV2() accepts", async () => {
  const { isNoaSemanticRequestV2 } = await import("../../noa/noa-semantic-request.js");
  const wireResponse = {
    version: 2, domain: "Client", intent: "rank", entityType: "client", entityText: null,
    reference: "previous_result", ordinal: "2", metric: "quotation_value", period: null,
    comparison: null, sortDirection: null, subject: null, subjectName: null,
    quotationStatus: null, projectFileStatus: null, priceStatus: null, procurementStatus: null,
    attentionKind: null, needsClarification: false, clarificationReason: null, confidence: "high",
  };
  const normalized = normalizeGeminiSemanticResponse(wireResponse);
  assert.ok(isNoaSemanticRequestV2(normalized));
  assert.equal((normalized as { ordinal: unknown }).ordinal, 2);
});

// ── 14. fail closed ────────────────────────────────────────────────────────────

test("14. an unrecognized schema construct fails closed (throws), never silently dropped", () => {
  assert.throws(() => translateSchemaForGemini({ type: "object", properties: { x: { type: ["string", "number", "null"] } } }), GeminiSchemaTranslationError);
  assert.throws(() => translateSchemaForGemini({ type: "object", properties: { x: { type: "object", properties: {} } } }), GeminiSchemaTranslationError);
  assert.throws(() => translateSchemaForGemini({ type: "array", items: { type: "string" } }), GeminiSchemaTranslationError);
  assert.throws(() => translateSchemaForGemini({ properties: {} }), GeminiSchemaTranslationError);
});

test("gemini.server.ts wraps a translation failure into a normalized AiProviderError (source-level, file has \"server-only\")", () => {
  assert.ok(geminiSource.includes("error instanceof GeminiSchemaTranslationError"));
  assert.ok(geminiSource.includes('throw new AiProviderError(error.message, "provider_failed");'));
});

// ── 15. no semantic rewriting ─────────────────────────────────────────────────

test("15. translation never rewrites domain/intent/metric enum values, only wire shape", () => {
  const translated = translateSchemaForGemini(NOA_SEMANTIC_REQUEST_V2_SCHEMA);
  assert.deepEqual(translated.properties.domain.enum, NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.domain.enum);
  assert.deepEqual(translated.properties.intent.enum, NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.intent.enum);
  const metricValues = (translated.properties.metric as { enum: readonly unknown[] }).enum;
  assert.deepEqual(metricValues, NOA_SEMANTIC_REQUEST_V2_SCHEMA.properties.metric.enum.filter((v) => v !== null));
});

// ── 16/17/18. provider-router / OpenAI / Anthropic untouched ────────────────────

test("16. provider-router behavior unchanged - still routes gemini to runGeminiProvider, others untouched", () => {
  const routerSource = readFileSync("lib/ai/provider-router.server.ts", "utf8");
  assert.match(routerSource, /if \(provider === "gemini"\) return runGeminiProvider\(request\);/);
  assert.match(routerSource, /if \(provider === "openai"\) \{\s*return runOpenAiProvider\(request\);/);
  assert.match(routerSource, /if \(provider === "anthropic"\) return runAnthropicProvider\(request\);/);
});

test("17. OpenAI adapter source is untouched by I7.1 (no schema translation imported/called)", () => {
  assert.ok(!openaiSource.includes("gemini-schema-translation"));
  assert.ok(!openaiSource.includes("translateSchemaForGemini"));
});

test("18. Anthropic adapter source is untouched by I7.1", () => {
  const anthropicHasTranslation = anthropicSource.includes("gemini-schema-translation") || anthropicSource.includes("translateSchemaForGemini");
  assert.ok(!anthropicHasTranslation);
});

test("the translation module itself is pure - no server-only, no network, no Supabase/auth import", () => {
  const source = readFileSync("lib/ai/providers/gemini-schema-translation.ts", "utf8");
  const codeOnly = source.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  assert.ok(!codeOnly.includes("server-only"));
  assert.ok(!codeOnly.includes("fetch("));
  assert.ok(!/supabase|createClient|requireActiveUser/i.test(codeOnly));
});
