import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";

type Runtime = { agentId: string; apiKeyConfigured: boolean; enabled: boolean; model: string; provider: string; source: unknown };
let runtimeResult: Runtime | Error = { agentId: "noa_orchestrator", apiKeyConfigured: true, enabled: true, model: "gpt-5.6-terra", provider: "openai", source: {} };
const resolverCalls: string[] = [];
const modelCalls: Array<{ provider: string; apiKey: string; model: string }> = [];
const generateTextArgs: Array<Record<string, unknown>> = [];

class FakeProviderError extends Error {
  constructor(message: string, readonly reason?: string) { super(message); }
}
mock.module("@/lib/ai/resolve-agent-runtime-config.server", { namedExports: { resolveAiAgentRuntimeConfig: async (id: string) => { resolverCalls.push(id); if (runtimeResult instanceof Error) throw runtimeResult; return runtimeResult; } } });
mock.module("@/lib/noa/noa-provider.server", { namedExports: { NoaProviderError: FakeProviderError } });
mock.module("@ai-sdk/openai", { namedExports: { createOpenAI: ({ apiKey }: { apiKey: string }) => (model: string) => { modelCalls.push({ provider: "openai", apiKey, model }); return { provider: "openai" }; } } });
mock.module("@ai-sdk/anthropic", { namedExports: { createAnthropic: ({ apiKey }: { apiKey: string }) => (model: string) => { modelCalls.push({ provider: "anthropic", apiKey, model }); return { provider: "anthropic" }; } } });
mock.module("ai", { namedExports: {
  generateText: async (args: Record<string, unknown>) => { generateTextArgs.push(args); return { text: "Hello." }; },
  hasToolCall: () => () => false,
  stepCountIs: () => () => false,
} });
mock.module("./noa-agent-tools.server", { namedExports: { createNoaAgentTools: () => ({ tools: {}, sources: [], getConfigurationAnswer: () => null }) } });
const { runNoaAgentLoop } = await import("./noa-agent-loop.server");

const request = { context: { pathname: "/", section: "other" }, message: "hi" } as Parameters<typeof runNoaAgentLoop>[0];
const ENV_KEYS = ["NOA_V2_PROVIDER", "NOA_V2_MODEL", "OPENAI_API_KEY", "SOURCE_QA_AI_API_KEY", "ANTHROPIC_API_KEY"] as const;

async function withEnv<T>(env: Partial<Record<(typeof ENV_KEYS)[number], string>>, run: () => Promise<T>) {
  const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  const logs: string[] = [];
  const warn = mock.method(console, "warn", (...args: unknown[]) => { logs.push(args.join(" ")); });
  const log = mock.method(console, "log", (...args: unknown[]) => { logs.push(args.join(" ")); });
  modelCalls.length = 0; generateTextArgs.length = 0; resolverCalls.length = 0;
  try { return { result: await run(), logs }; }
  finally { warn.mock.restore(); log.mock.restore(); for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; } }
}
const rejects = async (run: () => Promise<unknown>) => { try { await run(); } catch (error) { return error as FakeProviderError; } assert.fail("expected an error"); };
const runtime = (over: Partial<Runtime>): Runtime => ({ agentId: "noa_orchestrator", apiKeyConfigured: true, enabled: true, model: "gpt-5.6-terra", provider: "openai", source: {}, ...over });

test("v2 resolves the NOA Assistant settings and uses a supported provider and model with the same env keys", async () => {
  runtimeResult = runtime({ provider: "openai", model: "gpt-5.6-terra" });
  const openai = await withEnv({ OPENAI_API_KEY: "sk-openai", NOA_V2_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-anthropic" }, () => runNoaAgentLoop(request));
  assert.deepEqual(resolverCalls, ["noa_orchestrator"]);
  assert.deepEqual(modelCalls, [{ provider: "openai", apiKey: "sk-openai", model: "gpt-5.6-terra" }], "settings win over NOA_V2_PROVIDER");
  assert.equal(openai.result.engine, "v2");
  runtimeResult = runtime({ provider: "anthropic", model: "claude-x" });
  await withEnv({ ANTHROPIC_API_KEY: "sk-anthropic" }, () => runNoaAgentLoop(request));
  assert.deepEqual(modelCalls, [{ provider: "anthropic", apiKey: "sk-anthropic", model: "claude-x" }]);
  runtimeResult = runtime({ provider: "openai", model: "m" });
  await withEnv({ SOURCE_QA_AI_API_KEY: "sk-source" }, () => runNoaAgentLoop(request));
  assert.deepEqual(modelCalls, [{ provider: "openai", apiKey: "sk-source", model: "m" }], "SOURCE_QA_AI_API_KEY is still the OpenAI fallback key");
});

test("a disabled agent throws the old NOA's disabled message", async () => {
  runtimeResult = runtime({ enabled: false });
  const { result } = await withEnv({ OPENAI_API_KEY: "sk-openai" }, () => rejects(() => runNoaAgentLoop(request)));
  assert.equal(result.message, "NOA is currently disabled by the system administrator.");
  assert.equal(result.reason, "not_configured");
  assert.deepEqual(modelCalls, []);
});

test("a supported provider without a key throws 'not configured' and never falls back to another provider", async () => {
  runtimeResult = runtime({ provider: "openai", apiKeyConfigured: false });
  const { result } = await withEnv({ NOA_V2_PROVIDER: "anthropic", ANTHROPIC_API_KEY: "sk-anthropic" }, () => rejects(() => runNoaAgentLoop(request)));
  assert.equal(result.message, "NOA is not configured.");
  assert.equal(result.reason, "not_configured");
  assert.deepEqual(modelCalls, [], "no other provider is tried");
});

test("an unsupported provider or a resolver error falls back to NOA_V2_* and logs one safe line", async () => {
  runtimeResult = runtime({ provider: "gemini", model: "gemini-x" });
  const gemini = await withEnv({ NOA_V2_PROVIDER: "openai", NOA_V2_MODEL: "gpt-env", OPENAI_API_KEY: "sk-secret-value" }, () => runNoaAgentLoop(request));
  assert.deepEqual(modelCalls, [{ provider: "openai", apiKey: "sk-secret-value", model: "gpt-env" }]);
  assert.deepEqual(gemini.logs, ["[NOA_V2_PROVIDER_FALLBACK] gemini"], "exactly one line, provider name only, no env values");
  runtimeResult = new Error("db down sk-secret-value");
  const failed = await withEnv({ ANTHROPIC_API_KEY: "sk-anthropic" }, () => runNoaAgentLoop(request));
  assert.deepEqual(modelCalls, [{ provider: "anthropic", apiKey: "sk-anthropic", model: "claude-sonnet-5-5" }], "today's defaults when the resolver throws");
  assert.equal(failed.logs.length, 1);
  assert.ok(failed.logs[0].startsWith("[NOA_V2_PROVIDER_FALLBACK]") && !failed.logs[0].includes("sk-") && !failed.logs[0].includes("db down"));
});

test("the fallback keeps today's rules: openai without NOA_V2_MODEL or any key still refuses", async () => {
  runtimeResult = runtime({ provider: "gemini" });
  const noModel = await withEnv({ NOA_V2_PROVIDER: "openai", OPENAI_API_KEY: "sk-openai" }, () => rejects(() => runNoaAgentLoop(request)));
  assert.equal(noModel.result.message, "NOA v2 model is not set.");
  const noKey = await withEnv({}, () => rejects(() => runNoaAgentLoop(request)));
  assert.equal(noKey.result.message, "NOA is not configured.");
});

test("nothing in the v2 loop sets temperature, maxOutputTokens or providerOptions", async () => {
  const source = readFileSync("lib/noa/v2/noa-agent-loop.server.ts", "utf8");
  assert.ok(!/temperature|maxOutputTokens|maxTokens|providerOptions/.test(source));
  assert.ok(source.includes('resolveAiAgentRuntimeConfig("noa_orchestrator")'));
  runtimeResult = runtime({});
  await withEnv({ OPENAI_API_KEY: "sk-openai" }, () => runNoaAgentLoop(request));
  assert.ok(generateTextArgs.length === 1 && !("temperature" in generateTextArgs[0]) && !("providerOptions" in generateTextArgs[0]) && !("maxOutputTokens" in generateTextArgs[0]));
});
