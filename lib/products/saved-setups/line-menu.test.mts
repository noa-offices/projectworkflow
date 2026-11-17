import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { LINE_ADDED_BEFORE_HINT, isLineSaveable, withConfigurationRecipe } from "./line-recipe";

const TPL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const read = (p: string) => readFileSync(p, "utf8");
const ENTRY = 'item.item_type === "product" && item.source_template_id ? (';

test("local builder: the More menu (desktop and mobile) has the entry first, for product lines only", () => {
  const src = read("components/quotations/local-quotation-builder.tsx");
  assert.match(src, /<SharedQuotationMoreMenu actionButtons=\{\(<>\{item\.item_type === "product" && item\.source_template_id \? \(<SaveLineToMyCollectionButton line=\{item\} \/>\) : null\}\{copiedRowClipboard/);
  assert.match(src, /mobileMoreItemId === item\.id \? \(\s*<div[^>]*>\s*\{item\.item_type === "product" && item\.source_template_id \? \(<SaveLineToMyCollectionButton/);
  // the existing button inside the details modal stays
  assert.match(src, /<div className="border border-zinc-300 bg-white p-3">\s*<SaveLineToMyCollectionButton line=\{item\} \/>/);
});

test("server builder: the entry is the first item of the row More menu", () => {
  const src = read("app/quotations/[id]/builder/page.tsx");
  const start = src.indexOf("<SharedQuotationMoreMenu");
  const menu = src.slice(start);
  assert.ok(menu.indexOf("<SaveLineToMyCollectionButton") > 0);
  assert.ok(menu.indexOf("<SaveLineToMyCollectionButton") < menu.indexOf("duplicateQuotationItemBelow"));
  assert.ok(menu.indexOf(ENTRY) < menu.indexOf("duplicateQuotationItemBelow"));
});

test("old product lines show the disabled hint; custom, note and blank rows get no entry", () => {
  const old = isLineSaveable({ item_type: "product", source_template_id: TPL, source_component_data: {} });
  assert.deepEqual(old, { saveable: false, reason: "added_before", message: LINE_ADDED_BEFORE_HINT });
  const fresh = withConfigurationRecipe({}, { templateId: TPL, variantRowId: "v", generatedSpecification: "x" });
  assert.equal(isLineSaveable({ item_type: "product", source_template_id: TPL, source_component_data: fresh }).saveable, true);
  for (const item_type of ["custom", "note", "blank"]) {
    assert.equal((isLineSaveable({ item_type, source_template_id: null }) as { reason?: string }).reason, "not_a_template_line");
  }
  const button = read("components/quotations/save-line-to-my-collection-button.tsx");
  assert.match(button, /not_a_template_line"\) return null/);
  assert.match(button, /disabled/);
  assert.match(button, /\{result\.message\}/);
});
