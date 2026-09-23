import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("lib/noa/noa-quotation-capability.server.ts", "utf8");

test("B2 quotation reads retain authorization, bounds, deterministic facts, and snapshots", () => {
  assert.ok(source.includes("await requireQuotationActionUser();"));
  assert.ok(!/createAdminClient|service_role|\.insert\(|\.update\(|\.delete\(|\.upsert\(/.test(source));
  assert.ok(source.includes("MAX_QUOTATION_ROWS = 10"));
  assert.ok(source.includes("source_template_id"));
  assert.ok(source.includes("deterministicText"));
  assert.ok(source.includes("reduce((sum, row) => sum + (row.grand_total ?? 0)"));
  assert.ok(source.includes("identifiers.length !== 2"));
  assert.ok(!/\.from\("product_templates"\)/.test(source));
});
