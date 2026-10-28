// Fake fetch only: no live Gemini call. Runs the real router and Gemini adapter.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async () => ({ enabled: true, apiKeyConfigured: true, provider: "gemini", model: "gemini-test" }) } });
process.env.GEMINI_API_KEY = "gm-test-secret-key";

type Wire = { generationConfig: { responseSchema: Record<string, unknown> } };
const requests: Wire[] = [];
let reply: () => { ok: boolean; status: number; json: () => Promise<unknown> } = () => ({ ok: true, status: 200, json: async () => ({}) });
const realFetch = globalThis.fetch;
globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => { requests.push(JSON.parse(String(init?.body))); return reply(); }) as unknown as typeof fetch;
test.after(() => { globalThis.fetch = realFetch; });

const { shortenDimensionsWithProvider } = await import("../products/dimension-shortening-provider.server");
const { cleanSpecificationsWithProvider } = await import("../products/specification-cleanup-provider.server");
const gemini = (payload: unknown) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }) });
const FORBIDDEN = ["additionalProperties", "minItems", "maxItems", "maxLength", "pattern", "format"];
const walk = (node: unknown, path = "schema"): void => {
  if (!node || typeof node !== "object") return;
  const record = node as Record<string, unknown>;
  for (const key of FORBIDDEN) assert.ok(!(key in record), `${path} has ${key}`);
  assert.ok(!Array.isArray(record.type), `${path} has a type array`);
  Object.entries(record).forEach(([key, value]) => walk(value, `${path}.${key}`));
};

test("dimension shortening works through the Gemini adapter: the wire schema is Gemini-safe and the answer is read back", async () => {
  requests.length = 0;
  reply = () => gemini({ results: [{ targetId: "a", dimension: "W:520 D:615 H:1130 mm" }] });
  assert.deepEqual(await shortenDimensionsWithProvider([{ targetId: "a", text: "H 1130 x W 520 x D 615 mm" }]), [{ targetId: "a", dimension: "W:520 D:615 H:1130 mm" }]);
  const schema = requests[0].generationConfig.responseSchema as { properties: { results: { type: string; items: { type: string; nullable?: boolean; properties: Record<string, { type: string; nullable?: boolean }> } } } };
  walk(schema);
  assert.equal(schema.properties.results.type, "array");
  assert.equal(schema.properties.results.items.properties.dimension.type, "string");
  assert.equal(schema.properties.results.items.properties.dimension.nullable, true);
});
test("specification cleanup works through the Gemini adapter", async () => {
  requests.length = 0;
  reply = () => gemini({ results: [{ targetId: "a", specification: null }] });
  assert.deepEqual(await cleanSpecificationsWithProvider([{ targetId: "a", text: "Swivel chair", mode: "seating" }], ["Castors"]), [{ targetId: "a", specification: null }]);
  walk(requests[0].generationConfig.responseSchema);
});
test("a Gemini HTTP error shows its status and logs the short message, never the key", async () => {
  const logged: unknown[][] = [];
  const original = console.error; console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    reply = () => ({ ok: false, status: 400, json: async () => ({ error: { code: 400, message: "Invalid JSON payload received. Unknown name responseSchema", status: "INVALID_ARGUMENT" } }) });
    await assert.rejects(shortenDimensionsWithProvider([{ targetId: "a", text: "x" }]), (error: Error) => error.message === "AI service error 400.");
    reply = () => ({ ok: false, status: 429, json: async () => ({ error: { message: "Quota exceeded for gemini-test" } }) });
    await assert.rejects(cleanSpecificationsWithProvider([{ targetId: "a", text: "x", mode: "seating" }], []), (error: Error) => error.message === "AI service error 429.");
    reply = () => ({ ok: false, status: 503, json: async () => ({ error: { message: "The model is overloaded" } }) });
    await assert.rejects(shortenDimensionsWithProvider([{ targetId: "a", text: "x" }]), (error: Error) => error.message === "AI service error 503.");
  } finally { console.error = original; }
  const text = JSON.stringify(logged);
  assert.match(text, /AI PROVIDER ERROR[\s\S]*gemini[\s\S]*"status":400[\s\S]*Unknown name responseSchema/);
  assert.match(text, /"status":429[\s\S]*Quota exceeded/);
  assert.doesNotMatch(text, /gm-test-secret-key/);
});
