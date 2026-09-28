import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// noa-orchestrator.ts has "@/..." aliases (server auth/Supabase/provider imports), which Node's
// plain ESM resolver can't resolve outside the Next.js build - the same limitation documented for
// other "use client"/"use server"-adjacent files in this repo (see
// components/quotations/product-library-selector.test.mts for the established precedent). These
// are source-level wiring checks, not runtime execution tests.

const orchestratorSource = readFileSync("lib/noa/noa-orchestrator.ts", "utf8");

function branchReturnsBeforeIndex(source: string, branchMarker: string, laterMarker: string) {
  const branchIndex = source.indexOf(branchMarker);
  const laterIndex = source.indexOf(laterMarker);
  return branchIndex >= 0 && laterIndex >= 0 && branchIndex < laterIndex;
}

test('12. the "context" (self/page-context) route returns before any capability call or runNoaProvider()', () => {
  const contextBranchIndex = orchestratorSource.indexOf('route === "context"');
  // Anchored to the real capability-dispatch block (`const capabilityResult =`, used by the tests
  // below too) rather than the bare `fetchNoaProductCapability(` name: a later, unrelated Guided
  // Product Configuration feature added its own earlier call to that same function for its own
  // purposes, which is not the dispatch this test means to check.
  const capabilityDispatchIndex = orchestratorSource.indexOf("const capabilityResult =");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(contextBranchIndex >= 0 && capabilityDispatchIndex >= 0 && providerCallIndex >= 0);
  assert.ok(contextBranchIndex < capabilityDispatchIndex);
  assert.ok(contextBranchIndex < providerCallIndex);
  // The context branch itself must return synchronously, not await anything.
  const contextBranch = orchestratorSource.slice(contextBranchIndex, orchestratorSource.indexOf("}", contextBranchIndex));
  assert.ok(contextBranch.includes("return {"));
  assert.ok(!contextBranch.includes("await"));
});

test("13. Project/Procurement are real, fully-supported domains - the old unsupported-domain placeholder route was retired, not left as a bypassable branch", () => {
  // Project and Procurement were later promoted to real NoaDomain capabilities (see
  // lib/noa/noa-phase-b5-safety.test.mts's own "17. Procurement is a real NoaDomain and the
  // unsupported_procurement route is fully retired") - there is no longer an "unsupported_project"
  // / "unsupported_procurement" route to check the ordering of; confirm it stays fully removed
  // rather than silently reintroduced as a bypass around the real capability dispatch.
  assert.ok(!orchestratorSource.includes("unsupported_project"));
  assert.ok(!orchestratorSource.includes("unsupported_procurement"));
});

test("context answers are surfaced under the existing Help domain, never a new user-facing domain", () => {
  assert.match(orchestratorSource, /route === "context"[\s\S]{0,120}domain: "Help"/);
});

test("Help/context are handled before the Product/Quotation/Price capability dispatch", () => {
  assert.ok(branchReturnsBeforeIndex(orchestratorSource, 'route === "context"', "const capabilityResult ="));
  assert.ok(branchReturnsBeforeIndex(orchestratorSource, 'dispatchRoute === "Help"', "const capabilityResult ="));
});

test("the orchestrator still classifies via the single pure router (classifyNoaRoute), no duplicated routing logic", () => {
  assert.ok(orchestratorSource.includes('classifyNoaRoute,'));
  assert.ok(orchestratorSource.includes('from "@/lib/noa/noa-intent-router";'));
  assert.equal((orchestratorSource.match(/includesAny\(/g) ?? []).length, 0, "orchestrator must not reimplement keyword matching itself");
});
