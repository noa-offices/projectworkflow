import assert from "node:assert/strict";
import test, { mock } from "node:test";

const ok = async () => ({ ok: true, data: {}, sources: [{ label: "Fake", type: "product" }] });
mock.module("@/lib/noa/noa-product-capability.server", { namedExports: { fetchNoaProductCapability: ok } });
mock.module("@/lib/noa/noa-price-capability.server", { namedExports: { fetchNoaPriceCapability: ok } });
mock.module("@/lib/noa/noa-quotation-capability.server", { namedExports: { fetchNoaQuotationCapability: ok } });
mock.module("@/lib/noa/noa-attention-capability.server", { namedExports: { fetchNoaAttentionCapability: ok } });
mock.module("@/lib/noa/noa-user-activity-capability.server", { namedExports: { fetchNoaUserActivityCapability: ok } });
const { createNoaAgentTools } = await import("./noa-agent-tools.server");

test("NOA v2 exposes exactly 6 read-only tools", async () => {
  const { tools, sources } = createNoaAgentTools({ pathname: "", section: "other" });
  const names = Object.keys(tools);
  assert.deepEqual(names.sort(), ["getAttentionItems", "getProductPrice", "getQuotation", "getTeamActivity", "searchProducts", "searchQuotations"]);
  for (const name of names) assert.doesNotMatch(name, /create|update|delete|archive/i);
  await (tools.searchProducts as unknown as { execute: (i: { query: string }, o: unknown) => Promise<unknown> }).execute({ query: "chair" }, {});
  assert.equal(sources.length, 1, "sources are collected from successful results");
});
