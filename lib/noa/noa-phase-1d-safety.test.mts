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
  const firstCapabilityCallIndex = orchestratorSource.indexOf("fetchNoaProductCapability(");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(contextBranchIndex >= 0 && firstCapabilityCallIndex >= 0 && providerCallIndex >= 0);
  assert.ok(contextBranchIndex < firstCapabilityCallIndex);
  assert.ok(contextBranchIndex < providerCallIndex);
  // The context branch itself must return synchronously, not await anything.
  const contextBranch = orchestratorSource.slice(contextBranchIndex, orchestratorSource.indexOf("}", contextBranchIndex));
  assert.ok(contextBranch.includes("return {"));
  assert.ok(!contextBranch.includes("await"));
});

test("13. the unsupported-domain (Project/Procurement) route returns before any capability call or runNoaProvider()", () => {
  const unsupportedBranchIndex = orchestratorSource.indexOf('route === "unsupported_project"');
  const firstCapabilityCallIndex = orchestratorSource.indexOf("fetchNoaProductCapability(");
  const providerCallIndex = orchestratorSource.indexOf("runNoaProvider(");
  assert.ok(unsupportedBranchIndex >= 0 && firstCapabilityCallIndex >= 0 && providerCallIndex >= 0);
  assert.ok(unsupportedBranchIndex < firstCapabilityCallIndex);
  assert.ok(unsupportedBranchIndex < providerCallIndex);
  const unsupportedBranch = orchestratorSource.slice(unsupportedBranchIndex, orchestratorSource.indexOf("}", unsupportedBranchIndex));
  assert.ok(unsupportedBranch.includes("return {"));
  assert.ok(!unsupportedBranch.includes("await"));
});

test("context and unsupported-domain answers are surfaced under the existing Help domain, never a new user-facing domain", () => {
  assert.match(orchestratorSource, /route === "context"[\s\S]{0,120}domain: "Help"/);
  assert.match(orchestratorSource, /route === "unsupported_project" \|\| route === "unsupported_procurement"[\s\S]{0,150}domain: "Help"/);
});

test("Help/context/unsupported are all handled before the Product/Quotation/Price capability dispatch", () => {
  assert.ok(branchReturnsBeforeIndex(orchestratorSource, 'route === "context"', "const capabilityResult"));
  assert.ok(branchReturnsBeforeIndex(orchestratorSource, 'route === "unsupported_project"', "const capabilityResult"));
  assert.ok(branchReturnsBeforeIndex(orchestratorSource, 'route === "Help"', "const capabilityResult"));
});

test("the orchestrator still classifies via the single pure router (classifyNoaRoute), no duplicated routing logic", () => {
  assert.ok(orchestratorSource.includes('import { classifyNoaRoute, describeNoaPageContext } from "@/lib/noa/noa-intent-router";'));
  assert.equal((orchestratorSource.match(/includesAny\(/g) ?? []).length, 0, "orchestrator must not reimplement keyword matching itself");
});
