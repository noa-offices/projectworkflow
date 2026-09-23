import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// lib/ai/providers/openai.server.ts, lib/ai/provider-router.server.ts, and
// lib/ai/resolve-agent-runtime-config.server.ts each start with `import "server-only"` (matching
// every other AI-agent provider file in this codebase - source-qa/specification-enrichment/
// final-specification), and the `server-only` package itself is not resolvable by Node's plain
// ESM resolver outside the Next.js build (it isn't even present in node_modules as a physical
// package - Next.js provides it specially). So despite these three files otherwise using only
// relative imports (alias-free, unlike most "@/..." files elsewhere in this repo), they still
// can't be executed directly by `node --test`. These are source-level wiring/safety checks, not
// runtime execution tests - the same convention already used throughout lib/noa/ for
// "server-only"/"@/..."-blocked files.

const openaiSource = readFileSync("lib/ai/providers/openai.server.ts", "utf8");
const anthropicSource = readFileSync("lib/ai/providers/anthropic.server.ts", "utf8");
const geminiSource = readFileSync("lib/ai/providers/gemini.server.ts", "utf8");
const typesSource = readFileSync("lib/ai/types.ts", "utf8");
const routerSource = readFileSync("lib/ai/provider-router.server.ts", "utf8");
const resolverSource = readFileSync("lib/ai/resolve-agent-runtime-config.server.ts", "utf8");

// PART 14 - Provider contract ---------------------------------------------------

test("1. runtime resolution retains the registry as the safe provider fallback", () => {
  assert.ok(resolverSource.includes("let provider = agentConfig.provider;"));
  assert.ok(resolverSource.includes('providerSource: AiRuntimeConfigSource["provider"] = "registry_default"'));
});

test("2. model resolution retains env-over-registry fallback after DB settings", () => {
  assert.ok(resolverSource.includes("const modelFromEnv = agentConfig.modelEnv ? process.env[agentConfig.modelEnv]?.trim() : undefined;"));
  assert.ok(resolverSource.includes("agentModel || providerDefaultModel || modelFromEnv || agentConfig.defaultModel"));
});

test("3. missing model env falls back to registry defaultModel (same `||` expression covers both 2 and 3)", () => {
  assert.match(resolverSource, /modelFromEnv \|\| agentConfig\.defaultModel/);
});

test("4. apiKeyConfigured exposes a boolean only, never a credential value", () => {
  assert.match(resolverSource, /apiKeyConfigured: isProviderCredentialConfigured\(provider\)/);
  assert.match(resolverSource, /function isProviderCredentialConfigured\(provider: AiProviderId\): boolean/);
  // The resolver's return type/shape never carries a raw env value.
  assert.ok(!/apiKey:\s*process\.env|key:\s*process\.env/.test(resolverSource));
});

test("5. OpenAI adapter maps model, instructions, user content, strict response schema, and store:false", () => {
  assert.ok(openaiSource.includes("model: request.model,"));
  assert.ok(openaiSource.includes("store: false,"));
  assert.ok(openaiSource.includes("instructions: request.systemInstructions,"));
  assert.ok(openaiSource.includes("typeof request.userContent === \"string\" ? request.userContent : JSON.stringify(request.userContent)"));
  assert.ok(openaiSource.includes('type: "json_schema",'));
  assert.ok(openaiSource.includes("name: request.responseSchema.name,"));
  assert.ok(openaiSource.includes("strict: true,"));
  assert.ok(openaiSource.includes("schema: request.responseSchema.schema,"));
});

test("6. provider router sends openai requests to the OpenAI adapter", () => {
  assert.match(routerSource, /if \(provider === "openai"\) \{\s*return runOpenAiProvider\(request\);/);
});

test("7. unsupported provider produces a normalized AiProviderError", () => {
  assert.match(routerSource, /throw new AiProviderError\(`Unsupported AI provider: \$\{provider\}`, "not_configured"\);/);
});

test("8. OpenAI output_text extraction is implemented", () => {
  assert.ok(openaiSource.includes('(content as { type?: unknown }).type === "output_text"'));
});

test('9. timeout maps to kind = "timeout"', () => {
  assert.match(openaiSource, /error\.name === "AbortError"[\s\S]{0,80}"timeout"/);
});

test('10. missing credential maps to kind = "not_configured"', () => {
  assert.match(openaiSource, /if \(!apiKey\) \{\s*throw new AiProviderError\("OpenAI is not configured\.", "not_configured"\);/);
});

// PART 16 - Permission/infrastructure-boundary safety ----------------------------

test("19. provider-router.server.ts imports no product/quotation/price capability", () => {
  assert.ok(!/from ["'].*capability/i.test(routerSource));
  assert.ok(!routerSource.includes("noa-product-capability"));
  assert.ok(!routerSource.includes("noa-quotation-capability"));
  assert.ok(!routerSource.includes("noa-price-capability"));
});

test("20. openai.server.ts imports no Supabase or business-query code", () => {
  assert.ok(!/from ["'].*supabase/i.test(openaiSource));
  assert.ok(!openaiSource.includes("createClient"));
});

test("21. resolve-agent-runtime-config.server.ts never reads or returns canWrite/mode/capabilities off the resolved agent", () => {
  assert.ok(!/agentConfig\.canWrite\b|agentConfig\.mode\b|agentConfig\.capabilities\b/.test(resolverSource));
});

test("23. no service-role credential/client appears in provider infrastructure; resolver uses the user-scoped server client", () => {
  for (const source of [openaiSource, routerSource, resolverSource]) {
    assert.ok(!/SUPABASE_SERVICE_ROLE|createServiceRoleClient|service_role/i.test(source));
  }
  assert.ok(resolverSource.includes('import { createClient } from "@/lib/supabase/server";'));
});

test("24. no mutation method calls are introduced by the provider infrastructure", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  for (const source of [openaiSource, routerSource, resolverSource]) {
    assert.ok(!mutationPattern.test(source));
  }
});

test("no streaming APIs anywhere in the new provider infrastructure", () => {
  const streamingPattern = /ReadableStream|EventSource|text\/event-stream|stream:\s*true/;
  for (const source of [openaiSource, routerSource, resolverSource]) {
    assert.ok(!streamingPattern.test(source));
  }
});

test("provider-neutral request content remains additive to userContent", () => {
  assert.ok(typesSource.includes('type: "text"; text: string'));
  assert.ok(typesSource.includes('type: "file"; mimeType: string; data: string; filename?: string'));
  assert.ok(typesSource.includes("content?: AiProviderContentPart[];"));
  assert.ok(typesSource.includes("userContent?: unknown;"));
});

test("OpenAI preserves ordered text/file content and MIME type", () => {
  assert.ok(openaiSource.includes("request.content.map((part)"));
  assert.ok(openaiSource.includes('type: "input_text"'));
  assert.ok(openaiSource.includes('type: "input_file"'));
  assert.ok(openaiSource.includes('`data:${part.mimeType};base64,${part.data}`'));
});

test("Anthropic maps ordered files to base64 document blocks", () => {
  assert.ok(anthropicSource.includes("request.content.map((part)"));
  assert.ok(anthropicSource.includes('type: "document"'));
  assert.ok(anthropicSource.includes('media_type: part.mimeType'));
});

test("Gemini maps ordered files to inlineData parts", () => {
  assert.ok(geminiSource.includes("request.content.map((part)"));
  assert.ok(geminiSource.includes("inlineData: { mimeType: part.mimeType, data: part.data }"));
});

test("all adapters reject empty mixed content locally", () => {
  for (const source of [openaiSource, anthropicSource, geminiSource]) {
    assert.ok(source.includes('throw new AiProviderError("AI provider content is invalid.", "provider_failed")'));
  }
});
