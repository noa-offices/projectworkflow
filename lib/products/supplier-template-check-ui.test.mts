import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { evaluateTemplateCheck, type TemplateCheckInput } from "./supplier-template-check";
import { supplierFamilyStatusPresentation, type SupplierFamilyPriceStatus } from "./supplier-family-status";
import type { PriceLine, PriceLineState } from "./supplier-price-lines";
import { keepSupplierStatus, withSupplierStatus } from "./supplier-status-record";

const popup = readFileSync("components/quotations/supplier-price-lines-popup.tsx", "utf8");
const bar = popup.slice(popup.indexOf("function CheckBar"), popup.indexOf("function SourceLines"));
const line = (state: PriceLineState, extra: Partial<PriceLine> = {}): PriceLine => ({ key: `${state}-${Math.random()}`, code: "C", field: "", ourPrice: 1, ourCurrency: "EUR", supplierPrice: 1, supplierCurrency: "EUR", difference: 0, state, ...extra });
const source = (lines: PriceLine[], extra: Partial<TemplateCheckInput> = {}): TemplateCheckInput => ({ lines, truncated: false, families: [], chosen: [], missing: [], ...extra });

test("the button is shown only when every line matches: each blocker hides it", () => {
  // The popup shows the button exactly when the server's own rules say the product can be checked.
  assert.match(bar, /const verdict = evaluateTemplateCheck\(source\);/);
  assert.match(bar, /if \(!verdict\.ok\) return null;/);
  assert.equal(evaluateTemplateCheck(source([line("same"), line("shared")])).ok, true, "eligible");
  const blockers: Array<[string, TemplateCheckInput]> = [
    ["changed", source([line("same"), line("changed")])],
    ["needs mapping", source([line("needs_mapping")])],
    ["other: unclear", source([line("ambiguous")])],
    ["other: not in the list", source([line("not_in_supplier_list")])],
    ["empty price", source([line("same", { ourPrice: null })])],
    ["choose a family first", source([line("same", { familyHint: "choose_family" })])],
    ["no lines", source([])],
  ];
  for (const [name, input] of blockers) assert.equal(evaluateTemplateCheck(input).ok, false, name);
  // A denied role never sees the popup at all, and the server refuses again.
  assert.match(popup, /if \(allowed !== true\) return null/);
  const action = readFileSync("components/quotations/supplier-template-check-actions.ts", "utf8");
  assert.match(action, /if \(!canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)\) throw Error\("Brand price approver permission required\."\)/);
});

test("nothing is written on load or on the first click; the confirm calls the action once", () => {
  assert.equal((popup.match(/await markTemplateSupplierPriceChecked\(/g) ?? []).length, 1, "one call in the whole popup");
  const confirm = bar.slice(bar.indexOf("const confirm = async"), bar.indexOf("return (\n    <div className=\"mt-3\">"));
  assert.match(confirm, /await markTemplateSupplierPriceChecked\(templateId, source\.sourceId\)/);
  const outsideConfirm = bar.replace(confirm, "");
  assert.doesNotMatch(outsideConfirm, /markTemplateSupplierPriceChecked\(/, "not on render, not on the first click");
  assert.match(bar, /onClick=\{\(\) => \{ setError\(""\); setOpen\(true\); \}\}/, "the green button only opens the confirm step");
  assert.doesNotMatch(bar, /useEffect/);
  assert.match(bar, /All \{verdict\.lineCount\} lines match the supplier list\. This marks \{templateName\} as checked against \{source\.title\}\. Product prices do not change\./);
  assert.match(bar, /bg-emerald-800[^"]*">Mark prices as checked<\/button>/, "the green button");
  assert.match(bar, /if \(busy\) return;/, "a second click while saving does nothing");
});

test("failure shows the exact error and 'Nothing was saved.'; success reloads the lines and updates the badge", () => {
  assert.match(bar, /setError\(`\$\{reason instanceof Error \? reason\.message : "Something went wrong\."\} Nothing was saved\.`\)/);
  const failure = bar.slice(bar.indexOf("} catch (reason) {"), bar.indexOf("// Saved."));
  assert.doesNotMatch(failure, /onStatus|onDone/, "a failed save changes nothing else");
  assert.match(bar, /onStatus\?\.\(templateId, await supplierTemplateStatusPresentation\(templateId\)\)/);
  assert.match(bar, /onDone\(`Marked as checked: all \$\{verdict\.lineCount\} lines match the supplier list\.\$\{note\}`\)/);
  assert.match(bar, /Reload the page to update the badge\./, "if only the badge read fails the check is still saved");
  assert.ok(bar.indexOf("await markTemplateSupplierPriceChecked(") < bar.indexOf("supplierTemplateStatusPresentation("), "the badge is read after the save");
  // The selector hands the open Product Library a way to update its record, the same pattern the saved-template fix uses.
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /template\.id === templateId \? withSupplierStatus\(template, presentation\) : template/);
  assert.equal((selector.match(/onSupplierStatus=\{updateSupplierStatus\}/g) ?? []).length, 2, "both detail views");
  assert.match(selector, /<SupplierPriceLinesAction templateId=\{template\.id\} templateName=\{templateSelectionName\(template\)\} onSupplierStatus=\{onSupplierStatus\} \/>/);
});

test("the badge shows exactly what the status engine says after the check, and a later save keeps it", () => {
  const status: SupplierFamilyPriceStatus = { familyId: "T1", brandId: "B", status: "price_checked", label: "Price checked", checkedAt: "2026-11-03T10:00:00Z", detail: "x",
    source: { definitionId: "D", definitionName: "INTERSTUHL", sourceId: "S", title: "October 2026", effectiveFrom: "2026-01-02" } };
  const presentation = supplierFamilyStatusPresentation(status);
  assert.deepEqual([presentation.label, presentation.tone, presentation.detail], ["Price checked", "success", "Checked on 3 Nov 2026"]);
  const record = { id: "T1", supplier_family_price_presentation: { label: "Needs attention", tone: "danger", detail: "old" }, supplier_family_price_load_state: "loaded" };
  const updated = withSupplierStatus(record, presentation) as Record<string, unknown>;
  assert.deepEqual(updated.supplier_family_price_presentation, presentation, "the engine's wording and colour, not invented text");
  assert.deepEqual([updated.supplier_family_price_load_state, updated.supplier_family_price_loading], ["loaded", false]);
  assert.equal((withSupplierStatus(record, null) as Record<string, unknown>).supplier_family_price_presentation, undefined);
  // A later save (server copy without supplier fields) keeps the new status.
  assert.deepEqual((keepSupplierStatus({ id: "T1" }, updated) as Record<string, unknown>).supplier_family_price_presentation, presentation);
  const statusAction = readFileSync("components/quotations/supplier-template-status-actions.ts", "utf8");
  assert.match(statusAction, /canApproveBrandPrices\(profile\?\.role, profile\?\.account_status\)/);
  assert.match(statusAction, /loadSupplierFamilyPriceStatusMap\(client, \[template\]\)/);
  assert.doesNotMatch(statusAction, /supplierWrite|\.rpc\(|\.insert\(|\.update\(|\.delete\(|markTemplateSupplierPriceChecked/);
});

test("already checked shows 'Checked on <date>'; edited since the check shows the message and the button again", () => {
  assert.match(bar, /if \(source\.check\?\.valid\) return <p className="mt-3 text-sm font-semibold text-emerald-900">Checked on \{checkedDate\(source\.check\.checkedAt\)\}<\/p>;/);
  assert.ok(bar.indexOf("source.check?.valid") < bar.indexOf("if (!verdict.ok) return null"), "a valid check shows the date even if lines changed shape later");
  assert.match(bar, /\{source\.check \? <p className="mb-1 text-sm font-medium text-amber-900">Prices changed since the last check<\/p> : null\}/);
  assert.ok(bar.indexOf("Prices changed since the last check") < bar.indexOf(">Mark prices as checked</button>"), "the message sits above the green button");
  const lines = readFileSync("components/quotations/supplier-price-lines-actions.ts", "utf8");
  assert.match(lines, /supplierLatestTemplateChecks\(client, \[template\.brand_id\]\)/);
  assert.match(lines, /valid: String\(newest\.pricing_version\) === String\(template\.pricing_version\)/);
  assert.match(lines, /"id,brand_id,pricing_version"/);
  assert.doesNotMatch(lines, /markTemplateSupplierPriceChecked|supplierMarkTemplateChecked|\.rpc\(/, "the lines action stays read only");
  const local = readFileSync("app/quotations/[id]/local-builder/page.tsx", "utf8");
  assert.match(local.match(/\.from\("product_templates"\)\s*\.select\("([^"]+)"/)?.[1] ?? "", /pricing_version/, "the page loads the version the status engine needs");
});
