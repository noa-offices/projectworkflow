import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-provider.server.ts and the three capability files all carry "@/..." aliases and/or
// `import "server-only"`, neither resolvable by Node's plain ESM resolver outside the Next.js
// build - the same limitation documented throughout lib/noa/'s other *-safety.test.mts files.
// These are source-level wiring/regression checks, not runtime execution tests.

const providerSource = readFileSync("lib/noa/noa-provider.server.ts", "utf8");
const productCapabilitySource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const quotationCapabilitySource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const priceCapabilitySource = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");
const agentRegistrySource = readFileSync("lib/ai/agent-registry.ts", "utf8");

// PART 15 - NOA regression ------------------------------------------------------

test("11. noa-provider.server.ts no longer directly fetches the OpenAI endpoint", () => {
  assert.ok(!providerSource.includes("api.openai.com"));
  assert.ok(!/\bfetch\(/.test(providerSource));
});

test("12. noa-provider.server.ts resolves its runtime config via resolveAiAgentRuntimeConfig", () => {
  assert.ok(providerSource.includes('import { resolveAiAgentRuntimeConfig } from "@/lib/ai/resolve-agent-runtime-config.server";'));
  assert.ok(providerSource.includes('resolveAiAgentRuntimeConfig("noa_orchestrator")'));
});

test("13. noa-provider.server.ts executes every provider call through runAiProvider", () => {
  assert.ok(providerSource.includes('import { runAiProvider } from "@/lib/ai/provider-router.server";'));
  assert.match(providerSource, /await runAiProvider\(\{/);
});

test("14. NOA's schema and system prompt are unchanged", () => {
  assert.ok(providerSource.includes("You are NOA, the ProjectWorkflow assistant."));
  assert.ok(providerSource.includes('required: ["text"],'));
  assert.ok(providerSource.includes('name: "noa_answer_text"'));
  assert.ok(providerSource.includes("text: { type: \"string\", maxLength: 1200 },"));
});

test("15. no streaming was introduced in noa-provider.server.ts", () => {
  const streamingPattern = /ReadableStream|EventSource|text\/event-stream|stream:\s*true/;
  assert.ok(!streamingPattern.test(providerSource));
});

test("route.ts's NoaProviderError contract (class name, .kind values) is preserved", () => {
  assert.ok(providerSource.includes("export class NoaProviderError extends Error {"));
  assert.match(providerSource, /kind: "not_configured" \| "provider_failed" = "provider_failed"/);
});

// PART 16 - Permissions ----------------------------------------------------------

test("16. noa-product-capability.server.ts still invokes its existing product authorization helper", () => {
  assert.ok(productCapabilitySource.includes('import { requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(productCapabilitySource.includes("await requireProductLibraryManager();"));
});

test("17. noa-quotation-capability.server.ts still invokes its existing quotation authorization helper", () => {
  assert.ok(quotationCapabilitySource.includes('import { requireQuotationActionUser } from "@/lib/auth";'));
  assert.ok(quotationCapabilitySource.includes("await requireQuotationActionUser();"));
});

test("18. noa-price-capability.server.ts still invokes its existing product/price authorization helper", () => {
  assert.ok(priceCapabilitySource.includes('import { requireProductLibraryManager } from "@/lib/auth";'));
  assert.ok(priceCapabilitySource.includes("await requireProductLibraryManager();"));
});

test("22. registry NOA entry remains mode: read_only, canWrite: false", () => {
  const noaEntryMatch = agentRegistrySource.match(/id: "noa_orchestrator",[\s\S]*?\}\),/);
  assert.ok(noaEntryMatch);
  assert.match(noaEntryMatch![0], /mode: "read_only"/);
  assert.match(noaEntryMatch![0], /canWrite: false/);
});

test("capability files never received Supabase access, SQL, or credentials from the provider layer - they still create their own client", () => {
  for (const source of [productCapabilitySource, quotationCapabilitySource, priceCapabilitySource]) {
    assert.ok(source.includes('import { createClient } from "@/lib/supabase/server";'));
    assert.ok(!/provider-router|resolve-agent-runtime-config|providers\/openai/.test(source));
  }
});
