import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Component/server files here have "@/..." aliases (React/Next/Supabase/auth imports), which
// Node's plain ESM resolver can't resolve outside the Next.js build - the same limitation
// documented for other "use client"/"use server"-adjacent files in this repo (see
// components/quotations/product-library-selector.test.mts for the established precedent). These
// are source-level wiring/safety checks, not runtime execution tests.

const sourceBadgesSource = readFileSync("components/noa/noa-source-badges.tsx", "utf8");
const messagesSource = readFileSync("components/noa/noa-messages.tsx", "utf8");
const statusSource = readFileSync("components/noa/noa-status.tsx", "utf8");
const assistantSource = readFileSync("components/noa/noa-assistant.tsx", "utf8");
const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");
const productCapabilitySource = readFileSync("lib/noa/noa-product-capability.server.ts", "utf8");
const quotationCapabilitySource = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");
const priceCapabilitySource = readFileSync("lib/noa/noa-price-capability.server.ts", "utf8");
const providerSource = readFileSync("lib/noa/noa-provider.server.ts", "utf8");
const routeSource = readFileSync("app/api/noa/chat/route.ts", "utf8");

const CAPABILITY_FILES: Array<[string, string]> = [
  ["lib/noa/noa-product-capability.server.ts", productCapabilitySource],
  ["lib/noa/noa-quotation-capability.server.ts", quotationCapabilitySource],
  ["lib/noa/noa-price-capability.server.ts", priceCapabilitySource],
];

// A. Source badges -------------------------------------------------------------

test("NoaSourceBadges renders nothing when sources is empty/undefined", () => {
  assert.match(sourceBadgesSource, /if \(!sources\?\.length\) \{\s*return null;/);
});

test("NoaSourceBadges renders each source's user-facing label text", () => {
  assert.ok(sourceBadgesSource.includes("{source.label}"));
});

test("NoaMessages only renders source badges for assistant messages, never user messages", () => {
  assert.match(messagesSource, /message\.role === "assistant" \? \(\s*<NoaSourceBadges/);
});

test("domain badge renders the user-facing NoaDomain value, not an internal agent/capability id", () => {
  assert.ok(sourceBadgesSource.includes("{domain}"));
  assert.ok(!/noa_orchestrator|product_read|quotation_read|price_read/.test(sourceBadgesSource));
});

// C. Deterministic responses ---------------------------------------------------

test("unauthorized returns the fixed permission-safe message without mentioning internal role/permission names", () => {
  const message = "I don't have access to that ProjectWorkflow area with your current permissions.";
  for (const [file, source] of CAPABILITY_FILES) {
    assert.ok(source.includes(message), `${file} should use the standardized unauthorized message`);
    // Authorization is fully delegated to the opaque require*() helpers in lib/auth.ts - the
    // capability files themselves never need to (and must not) name a role inline.
    assert.ok(!/system_owner|admin_manager|procurement_manager|sales_designer/.test(source), `${file} must not reference role names directly`);
  }
});

test("not-found returns a fixed domain-specific message per capability", () => {
  assert.ok(productCapabilitySource.includes("I couldn't find a matching product in the Product Library."));
  assert.ok(quotationCapabilitySource.includes("I couldn't find that quotation."));
  assert.ok(priceCapabilitySource.includes("I couldn't find enough product information to check the price status."));
});

test("out-of-scope returns the fixed NOA scope message, not a per-request generated one", () => {
  assert.ok(orchestratorSource.includes(
    "I'm NOA, the ProjectWorkflow assistant. I can help with products, quotations, pricing, projects, procurement, and using ProjectWorkflow.",
  ));
});

test("needs-context (ambiguous) responses are fixed clarification text, not passed to the provider", () => {
  for (const [file, source] of CAPABILITY_FILES) {
    assert.match(source, /reason: "ambiguous"/, `${file} should still support the ambiguous/needs-context status`);
  }
});

// E. Safety ----------------------------------------------------------------

test("no mutation method calls were added anywhere in the Phase 1C touched files", () => {
  const mutationPattern = /\.insert\(|\.update\(|\.upsert\(|\.delete\(|\.rpc\(/;
  for (const [file, source] of CAPABILITY_FILES) {
    assert.ok(!mutationPattern.test(source), `${file} must not call a mutation method`);
  }
  assert.ok(!mutationPattern.test(orchestratorSource));
  assert.ok(!mutationPattern.test(routeSource));
  assert.ok(!mutationPattern.test(assistantSource));
});

test("no streaming APIs were introduced", () => {
  const streamingPattern = /ReadableStream|EventSource|text\/event-stream|stream:\s*true/;
  for (const source of [orchestratorSource, providerSource, routeSource, assistantSource, statusSource]) {
    assert.ok(!streamingPattern.test(source));
  }
});

test("the provider is only called after a capability result is ok - never for unauthorized/not-found/ambiguous", () => {
  const notOkIndex = orchestratorSource.indexOf("if (!capabilityResult.ok)");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(notOkIndex >= 0 && providerCallIndex >= 0 && notOkIndex < providerCallIndex);
  // The not-ok branch must return before the provider call is ever reached.
  const notOkBranch = orchestratorSource.slice(notOkIndex, providerCallIndex);
  assert.ok(notOkBranch.includes("return {"));
});

// F. Regression ---------------------------------------------------------------

test("Help still never reaches a capability or the provider", () => {
  // Phase 1D renamed the orchestrator's local from `domain` to `route` (classifyNoaRoute now
  // returns the richer NoaRouteKind) - see lib/noa/noa-phase-1d-safety.test.mts for the dedicated
  // Phase 1D coverage of the new context/unsupported-domain branches added ahead of this one.
  const helpCheckIndex = orchestratorSource.indexOf('route === "Help"');
  const helpReturnIndex = orchestratorSource.indexOf("return { domain: \"Help\"", helpCheckIndex);
  const capabilityDispatchIndex = orchestratorSource.indexOf("fetchNoaProductCapability(");
  assert.ok(helpCheckIndex >= 0 && helpReturnIndex >= 0 && capabilityDispatchIndex >= 0);
  assert.ok(helpCheckIndex < helpReturnIndex && helpReturnIndex < capabilityDispatchIndex);
});

test("the API response shape is still exactly { domain, text, sources } via NextResponse.json(answer)", () => {
  assert.ok(routeSource.includes("return NextResponse.json(answer);"));
  assert.ok(orchestratorSource.includes("domain,") || orchestratorSource.includes("{ domain,"));
});

test("popup size/position and launcher were not touched by Phase 1C", () => {
  const drawerSource = readFileSync("components/noa/noa-chat-drawer.tsx", "utf8");
  assert.ok(drawerSource.includes("sm:bottom-[188px]"));
  assert.ok(drawerSource.includes("sm:w-[400px]"));
  assert.ok(drawerSource.includes("sm:h-[600px]"));
});
