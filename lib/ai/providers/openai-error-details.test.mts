// Fake fetch only: no live call.
import assert from "node:assert/strict";
import test, { mock } from "node:test";

mock.module("server-only", { defaultExport: {} });
const { runOpenAiProvider } = await import("./openai.server");
const request = { provider: "openai", model: "m", systemInstructions: "i", userContent: "SECRET REQUEST TEXT", responseSchema: { name: "n", schema: {} } } as unknown as Parameters<typeof runOpenAiProvider>[0];

test("a failed request reports the status; schema errors log OpenAI's short message, never the key or the request", async () => {
  const realFetch = globalThis.fetch, realError = console.error;
  process.env.OPENAI_API_KEY = "sk-test-secret-key";
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => { logged.push(args); };
  try {
    globalThis.fetch = (async () => ({ ok: false, status: 400, json: async () => ({ error: { message: "Invalid schema for response_format" } }) })) as unknown as typeof fetch;
    await assert.rejects(runOpenAiProvider(request), (error: Error) => error.message === "OpenAI request failed (status 400).");
    globalThis.fetch = (async () => ({ ok: false, status: 401, json: async () => ({ error: { message: "Incorrect API key provided: sk-test-secret-key" } }) })) as unknown as typeof fetch;
    await assert.rejects(runOpenAiProvider(request), (error: Error) => error.message === "OpenAI request failed (status 401).");
  } finally { globalThis.fetch = realFetch; console.error = realError; }
  assert.match(JSON.stringify(logged[0]), /"status":400[\s\S]*Invalid schema/);
  assert.doesNotMatch(JSON.stringify(logged), /sk-test-secret-key|SECRET REQUEST TEXT/);
  assert.match(JSON.stringify(logged[1]), /"status":401/);
});
