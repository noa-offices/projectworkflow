// Fake provider only: no live AI call.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });
let runtime = { enabled: true, apiKeyConfigured: true, provider: "openai", model: "fake-model" };
type Captured = { model: string; timeoutMs: number; responseSchema: { schema: Record<string, unknown> }; userContent: { accessoryNames: string[]; items: unknown[] }; systemInstructions: string };
const requests: Captured[] = [];
let answer: () => Promise<{ text: string }> = async () => ({ text: "{}" });
const resolved: string[] = [];
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async (agent: string) => { resolved.push(agent); return runtime; } } });
mock.module("@/lib/ai/provider-router.server", { namedExports: { runAiProvider: async (request: Captured) => { requests.push(request); return answer(); } } });

const { cleanSpecificationsWithProvider, SpecificationCleanupProviderError } = await import("./specification-cleanup-provider.server");
type ProviderError = Error & { kind: string };
const items = [{ targetId: "a", text: "Swivel chair, black plastic parts.", mode: "seating" as const }, { targetId: "b", text: "Melamine top, cable tray included", mode: "accessory_only" as const }];
const names = ["Black Plastic Parts", "Castors"];

test("sends strict-schema requests with the accessory list to the existing specification_enrichment agent", async () => {
  requests.length = 0; resolved.length = 0;
  answer = async () => ({ text: JSON.stringify({ results: [{ targetId: "a", specification: "Swivel chair." }, { targetId: "b", specification: "Melamine top" }] }) });
  assert.deepEqual(await cleanSpecificationsWithProvider(items, names), [{ targetId: "a", specification: "Swivel chair." }, { targetId: "b", specification: "Melamine top" }]);
  assert.deepEqual(resolved, ["specification_enrichment"]);
  assert.equal(requests[0].timeoutMs, 45_000);
  assert.deepEqual(requests[0].userContent, { accessoryNames: names, items });
  assert.deepEqual((requests[0].userContent.items as { mode: string }[]).map((item) => item.mode), ["seating", "accessory_only"], "each input row carries its mode");
  for (const expected of ["at most 2 short sentences", "ONLY words that are in the original", "return null", "accessory list", 'Mode "seating"', 'Mode "accessory_only"', "including facts marked as included"]) assert.ok(requests[0].systemInstructions.includes(expected), expected);
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const record = node as Record<string, unknown>;
    for (const forbidden of ["pattern", "format", "minLength", "maxLength", "oneOf", "anyOf", "allOf"]) assert.ok(!(forbidden in record), forbidden);
    if (record.type === "object") { assert.equal(record.additionalProperties, false); assert.deepEqual([...(record.required as string[])].sort(), Object.keys(record.properties as object).sort()); }
    Object.values(record).forEach(walk);
  };
  walk(requests[0].responseSchema.schema);
});
test("an empty accessory list is still sent", async () => {
  requests.length = 0;
  answer = async () => ({ text: JSON.stringify({ results: [{ targetId: "a", specification: null }, { targetId: "b", specification: null }] }) });
  await cleanSpecificationsWithProvider(items, []);
  assert.deepEqual(requests[0].userContent.accessoryNames, []);
});
test("failures give plain reasons; the log has no request text", async () => {
  const { AiProviderError } = await import("@/lib/ai/types");
  const logged: unknown[][] = [];
  const original = console.error; console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    runtime = { ...runtime, enabled: false };
    await assert.rejects(cleanSpecificationsWithProvider(items, names), (error: ProviderError) => error instanceof SpecificationCleanupProviderError && error.kind === "not_configured");
    runtime = { ...runtime, enabled: true };
    answer = async () => ({ text: "not json" });
    await assert.rejects(cleanSpecificationsWithProvider(items, names), (error: ProviderError) => /could not read/i.test(error.message));
    answer = async () => ({ text: JSON.stringify({ results: [] }) });
    await assert.rejects(cleanSpecificationsWithProvider(items, names), (error: ProviderError) => /could not read/i.test(error.message));
    answer = async () => { throw new AiProviderError("OpenAI request failed (status 400).", "provider_failed"); };
    await assert.rejects(cleanSpecificationsWithProvider(items, names), (error: ProviderError) => error.message === "AI service error 400.");
    answer = async () => { throw new AiProviderError("timed out", "timeout"); };
    await assert.rejects(cleanSpecificationsWithProvider(items, names), (error: ProviderError) => /timed out/i.test(error.message));
    await assert.rejects(cleanSpecificationsWithProvider([], names), (error: ProviderError) => error.kind === "provider_failed");
  } finally { console.error = original; }
  assert.doesNotMatch(JSON.stringify(logged), /black plastic parts|Swivel chair/i);
});
