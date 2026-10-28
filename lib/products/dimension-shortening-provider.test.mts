// Fake provider only: no live AI call.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });
let runtime: { enabled: boolean; apiKeyConfigured: boolean; provider: string; model: string } = { enabled: true, apiKeyConfigured: true, provider: "openai", model: "fake-model" };
type Captured = { model: string; timeoutMs: number; responseSchema: { schema: { additionalProperties: boolean } }; userContent: unknown; systemInstructions: string };
const requests: Captured[] = [];
let answer: () => Promise<{ text: string }> = async () => ({ text: "{}" });
const resolved: string[] = [];
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async (agent: string) => { resolved.push(agent); return runtime; } } });
mock.module("@/lib/ai/provider-router.server", { namedExports: { runAiProvider: async (request: Captured) => { requests.push(request); return answer(); } } });

const { shortenDimensionsWithProvider, DimensionShorteningProviderError } = await import("./dimension-shortening-provider.server");
type ProviderError = Error & { kind: string };
const items = [{ targetId: "a", text: "H 1130 x W 520 x D 615 mm, seat H 415-540" }, { targetId: "b", text: "no size" }];

test("sends strict-schema requests to the existing specification_enrichment agent and returns the parsed results", async () => {
  requests.length = 0; resolved.length = 0;
  answer = async () => ({ text: JSON.stringify({ results: [{ targetId: "a", dimension: "W:520 D:615 H:1130 mm" }, { targetId: "b", dimension: null }] }) });
  const results = await shortenDimensionsWithProvider(items);
  assert.deepEqual(results, [{ targetId: "a", dimension: "W:520 D:615 H:1130 mm" }, { targetId: "b", dimension: null }]);
  assert.deepEqual(resolved, ["specification_enrichment"]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].model, "fake-model"); assert.equal(requests[0].timeoutMs, 45_000);
  assert.equal(requests[0].responseSchema.schema.additionalProperties, false);
  assert.deepEqual(requests[0].userContent, items);
  for (const expected of ["W:<w> D:<d> H:<h> mm", "W:520/680", "H:1130-1250", "return null", "only numbers"]) assert.ok(requests[0].systemInstructions.includes(expected), expected);
});
test("not configured, invalid answer, timeout and failure give plain typed errors", async () => {
  runtime = { ...runtime, enabled: false };
  await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error instanceof DimensionShorteningProviderError && error.kind === "not_configured");
  runtime = { ...runtime, enabled: true, apiKeyConfigured: false };
  await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.kind === "not_configured");
  runtime = { ...runtime, apiKeyConfigured: true };
  answer = async () => ({ text: JSON.stringify({ results: [{ targetId: "a", dimension: "x" }] }) });
  await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.kind === "provider_failed" && /could not read/i.test(error.message));
  answer = async () => ({ text: "not json" });
  await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.kind === "provider_failed" && /could not read/i.test(error.message));
  answer = async () => { const { AiProviderError } = await import("@/lib/ai/types"); throw new AiProviderError("timed out", "timeout"); };
  await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.kind === "provider_failed" && /timed out/i.test(error.message));
  await assert.rejects(shortenDimensionsWithProvider([]), (error: ProviderError) => error.kind === "provider_failed");
});

test("known failures show a short plain reason; the real reason is logged without the request text or a key", async () => {
  const { AiProviderError } = await import("@/lib/ai/types");
  const logged: unknown[][] = [];
  const original = console.error; console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    answer = async () => { throw new AiProviderError("OpenAI request failed (status 400).", "provider_failed"); };
    await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.message === "AI service error 400.");
    answer = async () => { throw new AiProviderError("OpenAI returned no usable output.", "provider_failed"); };
    await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.message === "AI returned an empty answer.");
    answer = async () => { throw new AiProviderError("OpenAI request failed.", "provider_failed"); };
    await assert.rejects(shortenDimensionsWithProvider(items), (error: ProviderError) => error.message === "Dimension shortening could not be completed.");
  } finally { console.error = original; }
  assert.equal(logged.length, 3);
  assert.match(JSON.stringify(logged[0]), /DIMENSION SHORTENING ERROR[\s\S]*status 400/);
  assert.doesNotMatch(JSON.stringify(logged), /no size|H 1130/, "request text is never logged");
});

test("the schema follows strict-mode rules: object root, every property required, no extra properties, no unsupported keywords", () => {
  const schema = requests[0]?.responseSchema.schema as Record<string, unknown>;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const forbidden of ["pattern", "format", "minLength", "maxLength", "oneOf", "anyOf", "allOf"]) assert.ok(!(forbidden in record), forbidden);
    if (record.type === "object") { assert.equal(record.additionalProperties, false); assert.deepEqual([...(record.required as string[])].sort(), Object.keys(record.properties as object).sort()); }
    Object.values(record).forEach(walk);
  };
  assert.equal(schema.type, "object");
  walk(schema);
});
