import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const provider = readFileSync("lib/noa/noa-provider.server.ts", "utf8");

test("TC-3B.3 makes current capabilityData the sole source of product category/type facts", () => {
  assert.ok(provider.includes("Never infer a product category or type"));
  assert.ok(provider.includes("from a product name, page context, or recentMessages"));
  assert.ok(provider.includes("only when it is explicitly present in the current capabilityData"));
});

test("TC-3B.3 prohibits unsupported extra-record implications", () => {
  assert.ok(provider.includes("Do not imply additional matching records, availability, or follow-up actions"));
  assert.ok(provider.includes("unless the current capabilityData establishes them"));
});

test("TC-3B.3 preserves recentMessages for context but prohibits facts from it", () => {
  assert.ok(provider.includes("Use recentMessages only for conversational context and referent resolution"));
  assert.ok(provider.includes("Facts appearing only in recentMessages are unavailable for the current answer"));
  assert.ok(provider.includes("classifications from prior messages unless those facts are also present in the current capabilityData"));
});
