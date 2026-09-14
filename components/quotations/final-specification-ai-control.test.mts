import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./final-specification-ai-control.tsx", import.meta.url), "utf8");
const selectorSource = readFileSync(new URL("./product-library-selector.tsx", import.meta.url), "utf8");
const actionSource = readFileSync(new URL("../../app/quotations/final-specification-ai-actions.ts", import.meta.url), "utf8");

test("preview is editable and does not auto-apply", () => {
  assert.match(source, /value=\{visiblePreview\.suggestedValue\}/);
  assert.match(source, /onChange=\{\(event\) => setPreview/);
  assert.match(source, /onClick=\{useSuggestion\}/);
  assert.doesNotMatch(source, /onAddLocalItem|Add to Local Workspace/);
});

test("Use Suggestion reuses the existing final specification state only", () => {
  assert.match(selectorSource, /<FinalSpecificationAiControl/);
  assert.match(selectorSource, /setFinalSpecifications/);
  assert.match(selectorSource, /\[template\.id\]: specification/);
  assert.doesNotMatch(source, /unit_price|discount|quantity|currency|selectedOptions/);
});

test("Keep Current discards preview and stale fingerprints hide old suggestions", () => {
  assert.match(source, /Keep Current/);
  assert.match(source, /setPreview\(null\)/);
  assert.match(source, /preview\?\.fingerprint === fingerprint/);
});

test("all AI controls are non-submit buttons and introduce no persistence", () => {
  assert.equal((source.match(/type="button"/g) ?? []).length, 3);
  assert.doesNotMatch(source, /localStorage|sessionStorage|supabase|saveWorkspace|requestSubmit|\.submit\(/i);
  assert.match(actionSource, /requireQuotationActionUser/);
  assert.doesNotMatch(actionSource, /supabase|insert\(|update\(|storage|localStorage|sessionStorage/i);
});
