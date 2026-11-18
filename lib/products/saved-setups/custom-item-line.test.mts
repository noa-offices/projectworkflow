/* eslint-disable @typescript-eslint/no-explicit-any -- tiny fake client and deliberately hostile input */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createEmptyItem, type LocalQuotationWorkspace } from "@/lib/local/quotation-workspace";
import type { CustomItemListItem } from "./custom-item";
import { customItemFromRow, isManualItemRow, overlayFields, rowOverlayFromCustomItem } from "./custom-item-line";
import { loadCustomItemForUser, markCustomItemUsedForUser } from "./saved-custom-items-service";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const USER_A = "11111111-1111-4111-8111-111111111111";
const USER_B = "22222222-2222-4222-8222-222222222222";
const ITEM = "33333333-3333-4333-8333-333333333333";

const manualRow = {
  item_type: "custom", line_style: "normal", source_template_id: null,
  item_name_snapshot: " Special desk ", item_code_snapshot: "SD-1", brand_name_snapshot: "Acme",
  specification_snapshot: "Oak top", unit_label: "Set", unit_price: 1200, currency: "USD",
  // fields that must never be copied
  qty: 7, discount_type: "percent", discount_value: 10, net_price: 1080, net_total: 7560, section_id: "sec", notes: "private", internal_cost: 500,
};

function item(patch: Partial<CustomItemListItem> = {}): CustomItemListItem {
  return { id: ITEM, brandName: "Acme", itemName: "Desk", itemCode: "D-1", specification: "Oak", unitLabel: "Set", sellingPrice: 1200, currency: "AED", priceSavedAt: "2026-11-17T08:00:00Z", createdAt: "2026-01-01T00:00:00Z", lastUsedAt: null, useCount: 0, ...patch };
}

// ── customItemFromRow ────────────────────────────────────────────────────────────────────────────────────────
test("customItemFromRow: a manual row gives trimmed defaults and never copies quantity, discount, totals, section, notes or cost", () => {
  const result = customItemFromRow(manualRow);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.deepEqual(result.defaults, { brandName: "Acme", itemName: "Special desk", itemCode: "SD-1", specification: "Oak top", unitLabel: "Set", sellingPrice: "1200", currency: "USD" });
  assert.deepEqual(Object.keys(result.defaults).sort(), ["brandName", "currency", "itemCode", "itemName", "sellingPrice", "specification", "unitLabel"]);
});

test("customItemFromRow: brand is empty when the row has none; unit defaults to Pc; zero price is left empty", () => {
  const result = customItemFromRow({ ...manualRow, brand_name_snapshot: null, unit_label: "", unit_price: 0, currency: "GBP" });
  assert.ok(result.ok);
  if (result.ok) assert.deepEqual([result.defaults.brandName, result.defaults.unitLabel, result.defaults.sellingPrice, result.defaults.currency], ["", "Pc", "", "AED"]);
});

test("customItemFromRow: product, note, blank, heading and template rows give null with a reason", () => {
  for (const row of [
    { ...manualRow, item_type: "product" },
    { ...manualRow, item_type: "product", source_template_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { ...manualRow, item_type: "note" },
    { ...manualRow, item_type: "blank" },
    { ...manualRow, line_style: "note" },
    { ...manualRow, line_style: "blank" },
    { ...manualRow, line_style: "heading" },
  ]) {
    const result = customItemFromRow(row);
    assert.equal(result.ok, false, JSON.stringify([row.item_type, row.line_style]));
    if (!result.ok) assert.equal(result.reason, "not_a_manual_row");
  }
  assert.equal(isManualItemRow(manualRow), true);
});

// ── rowOverlayFromCustomItem ─────────────────────────────────────────────────────────────────────────────────
test("overlay: same currency puts the price straight in, with no source keys", () => {
  const overlay = rowOverlayFromCustomItem(item(), "AED");
  assert.equal(overlay.unit_price, 1200);
  assert.equal(overlay.currency, "AED");
  assert.equal(overlay.source_component_data, undefined);
  assert.equal(overlay.conversionNote, null);
});

test("overlay: different currency adds price 0 plus the existing manual-source keys and a plain note", () => {
  const overlay = rowOverlayFromCustomItem(item({ currency: "USD", sellingPrice: 350.5 }), "AED");
  assert.equal(overlay.unit_price, 0, "an unconverted foreign price never reaches the totals");
  assert.equal(overlay.currency, "AED", "the row stays in the quote currency");
  assert.deepEqual(overlay.source_component_data, { manual_source_price: 350.5, manual_source_currency: "USD" });
  assert.equal(overlay.conversionNote, "Price is in USD. Convert it to AED before sending.");
  // EUR item in a USD-free quote, and an unknown quote currency falls back to AED like the rest of the app
  assert.equal(rowOverlayFromCustomItem(item({ currency: "EUR" }), undefined).source_component_data?.manual_source_currency, "EUR");
  assert.equal(rowOverlayFromCustomItem(item({ currency: "AED" }), "XXX").unit_price, 1200);
});

test("overlay: only the allowed fields are overlaid (no quantity, discount, totals, section, notes, image, ids)", () => {
  const same = Object.keys(overlayFields(rowOverlayFromCustomItem(item(), "AED"))).sort();
  assert.deepEqual(same, ["brand_name_snapshot", "currency", "item_code_snapshot", "item_name_snapshot", "specification_snapshot", "unit_label", "unit_price"]);
  const foreign = Object.keys(overlayFields(rowOverlayFromCustomItem(item({ currency: "USD" }), "AED"))).sort();
  assert.deepEqual(foreign, [...same, "source_component_data"].sort());
});

test("snapshot comparison: the resulting row equals createEmptyItem plus only the overlay", () => {
  const workspace = { server_quotation_id: "q1", currency: "AED", items: [] } as unknown as LocalQuotationWorkspace;
  for (const currency of ["AED", "USD"]) {
    const empty = createEmptyItem(workspace, "custom", "sec-1");
    const overlay = overlayFields(rowOverlayFromCustomItem(item({ currency }), "AED"));
    const { source_component_data: sourceData, ...fields } = overlay;
    const row = { ...empty, ...fields, ...(sourceData ? { source_component_data: sourceData } : {}) } as Record<string, unknown>;
    const changed = Object.keys(row).filter((key) => key !== "id" && JSON.stringify(row[key]) !== JSON.stringify((empty as any)[key])).sort();
    const expected = Object.keys(overlay).filter((key) => JSON.stringify((overlay as any)[key]) !== JSON.stringify((empty as any)[key])).sort();
    assert.deepEqual(changed, expected, currency);
    // quantity, discount, section, serial and ids stay at the createEmptyItem defaults
    for (const key of ["qty", "discount_type", "discount_value", "section_id", "item_type", "line_style", "source_template_id", "notes", "internal_cost", "specified_image_url_snapshot", "proposed_image_url_snapshot", "is_optional", "include_in_total"]) {
      assert.equal(JSON.stringify(row[key]), JSON.stringify((empty as any)[key]), key);
    }
    assert.equal(row.qty, 1);
    assert.equal(row.item_type, "custom");
    if (currency === "AED") assert.equal(row.source_component_data, null, "same currency: no new key in source_component_data");
    else assert.deepEqual(row.source_component_data, { manual_source_price: 1200, manual_source_currency: "USD" });
  }
});

test("no custom_item_id and no other new source_component_data key is ever written", () => {
  const helper = read("./custom-item-line.ts");
  assert.doesNotMatch(helper, /custom_item_id|custom_item_saved|source_item_id/);
  assert.equal((helper.match(/manual_source_price|manual_source_currency/g) ?? []).length >= 2, true);
  const builder = read("../../../components/quotations/local-quotation-builder.tsx");
  assert.doesNotMatch(builder, /custom_item_id|custom_item_saved_at/);
  const actions = read("../../../app/quotations/actions.ts");
  assert.doesNotMatch(actions, /custom_item_saved_at/);
  // the manual-source keys are the ones applyManualCurrencyConversion already reads
  assert.match(actions, /data\?\.manual_source_price/);
  assert.match(actions, /data\?\.manual_source_currency/);
});

// ── markCustomItemUsed / ownership ───────────────────────────────────────────────────────────────────────────
type Row = Record<string, any>;
function fake(rows: Row[], session: string, options: { throwOnUpdate?: boolean } = {}) {
  class Query {
    private op: "select" | "update" = "select";
    private payload: Row = {};
    private filters: Array<(row: Row) => boolean> = [];
    select() { return this; }
    update(payload: Row) { if (options.throwOnUpdate) throw new Error("boom"); this.op = "update"; this.payload = payload; return this; }
    eq(column: string, value: unknown) { this.filters.push((row) => row[column] === value); return this; }
    order() { return this; }
    private run() {
      const matched = rows.filter((row) => row.owner_id === session && this.filters.every((filter) => filter(row)));
      if (this.op === "update") matched.forEach((row) => Object.assign(row, this.payload));
      return { data: matched.map((row) => ({ ...row })), error: null };
    }
    maybeSingle() { return Promise.resolve({ data: this.run().data[0] ?? null, error: null }); }
    then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return Promise.resolve(this.run()).then(resolve, reject); }
  }
  return { from: () => new Query() } as unknown as SupabaseClient;
}
const storedRow = (): Row => ({ id: ITEM, owner_id: USER_A, brand_name: "Acme", item_name: "Desk", item_code: null, specification: null, unit_label: "Pc", selling_price: 1200, currency: "AED", price_saved_at: "2026-11-17T08:00:00Z", created_at: "2026-01-01", last_used_at: null, use_count: 2 });

test("markCustomItemUsed: owner-only, counts the use, and a failure never throws", async () => {
  const rows = [storedRow()];
  assert.deepEqual(await markCustomItemUsedForUser(fake(rows, USER_B), USER_B, ITEM), { ok: false, error: "Item not found." }, "another user");
  assert.equal(rows[0].use_count, 2);
  assert.equal((await markCustomItemUsedForUser(fake(rows, USER_A), USER_A, ITEM)).ok, true);
  assert.equal(rows[0].use_count, 3);
  assert.ok(rows[0].last_used_at);
  assert.equal((await markCustomItemUsedForUser(fake(rows, USER_A), USER_A, "nope")).ok, false);
  const failing = await markCustomItemUsedForUser(fake(rows, USER_A, { throwOnUpdate: true }), USER_A, ITEM);
  assert.equal(failing.ok, false, "a failure returns a result instead of throwing, so it cannot block the add");
  const actions = read("./saved-custom-items-actions.ts");
  assert.match(actions, /export async function markCustomItemUsed[\s\S]*?catch \(error\)[\s\S]*?isNextRedirect/);
  assert.equal((actions.match(/await requireActiveUser\(\)/g) ?? []).length, 5);
});

test("server add: another user's item cannot be added (loaded under the session user)", async () => {
  const rows = [storedRow()];
  assert.equal((await loadCustomItemForUser(fake(rows, USER_B), USER_B, ITEM)).ok, false);
  assert.equal((await loadCustomItemForUser(fake(rows, USER_A), USER_A, ITEM)).ok, true);
  assert.equal((await loadCustomItemForUser(fake(rows, USER_A), USER_A, "not-a-uuid")).ok, false);
});

test("server add action: same permission and lock checks as the blank-row path, same payload plus only the overlay", () => {
  const actions = read("../../../app/quotations/actions.ts");
  const start = actions.indexOf("export async function addCustomItemToQuotation");
  const body = actions.slice(start, actions.indexOf("\nexport async function", start + 10));
  assert.match(body, /await requireRecordsManager\(\)/);
  assert.ok(body.indexOf("quotationFormLockReason") > 0 && body.indexOf("quotationFormLockReason") < body.indexOf("loadCustomItemForUser"), "locked quotation is refused before anything is read");
  assert.match(body, /loadCustomItemForUser\(supabase, user\.id, customItemId\)/);
  assert.match(body, /rowOverlayFromCustomItem\(loaded\.item/);
  assert.match(body, /roundedLinePricing\(overlay\.unit_price, "amount", 0, 1, pricingRule\)/);
  assert.match(body, /createBlankQuotationItemRecord\(/);
  assert.match(body, /markCustomItemUsedForUser/);
  assert.ok(!/admin|service[_-]?role/i.test(body));
  assert.ok(!/owner_id/.test(body));
  // the blank-row insert gets the overlay laid over the unchanged payload
  assert.match(actions, /\.insert\(overlay \? \{ \.\.\.payload, \.\.\.overlay \} : payload\)/);
  // the blank-row and optimistic paths are not given an overlay
  assert.equal((actions.match(/createBlankQuotationItemRecord\(\{/g) ?? []).length, 5, "definition + blank + optimistic + custom item + client history item");
});

// ── Picker ───────────────────────────────────────────────────────────────────────────────────────────────────
test("picker: two tabs; the Configured tab keeps its behaviour and shows no price; the Custom tab shows price and saved date", () => {
  const picker = read("../../../components/quotations/add-from-my-collection-button.tsx");
  assert.match(picker, /Configured products/);
  assert.match(picker, /Custom items/);
  assert.match(picker, /customTarget \? \(\s*<div role="tablist"/);
  assert.match(picker, /const showConfigured = tab === "configured" \|\| !customTarget;/);
  // existing lines are untouched
  for (const line of ["const result = await loadSetupForReplay(id);", "const problem = onChoose(result.setup);", "void markSetupUsed(id).catch(() => undefined);", "setSetups(await listPickerSetups());", "Search by name, product or brand", "Open My Collection page"]) assert.ok(picker.includes(line), line);
  assert.doesNotMatch(picker, /sellingPrice|customItemPriceLine|selling_price/, "no price in the Configured tab file");
  const pane = read("../../../components/quotations/custom-item-picker-pane.tsx");
  assert.match(pane, /customItemPriceLine\(item\)/);
  // PR 2b-2b: the picker now filters by brand and has a sort choice (default "recent").
  assert.match(pane, /groupByBrand\(sortSetups\(filterSetups\(filterByBrand\(entries, activeBrand\), search\), sort\)\)/);
  assert.match(pane, /Search by name, code or brand/);
  assert.match(pane, /CustomItemThumb/);
  assert.match(pane, /markCustomItemUsed\(item\.id\)\.catch/);
  assert.match(pane, /form\.set\("custom_item_id", item\.id\)/);
  assert.doesNotMatch(pane, /unit_price|net_total|qty/);
  const selector = read("../../../components/quotations/product-library-selector.tsx");
  assert.ok(selector.includes("<AddFromMyCollectionButton onChoose={openSetupFromCollection} />"));
  assert.doesNotMatch(selector, /custom-item|CustomItem/, "the Product Library selector is untouched");
});

test("builders provide the target: local adds an ordinary row through the builder, server through the action", () => {
  const local = read("../../../components/quotations/local-quotation-builder.tsx");
  assert.equal((local.match(/<CustomItemTargetProvider value=\{\{ kind: "local"/g) ?? []).length, 2);
  assert.match(local, /createEmptyItem\(current, "custom", sectionId\), \.\.\.fields/);
  assert.match(local, /rowOverlayFromCustomItem\(item, workspace\.currency\)/);
  assert.match(local, /if \(overlay\.conversionNote\) setSaveMessage\(overlay\.conversionNote\)/);
  const server = read("../../../app/quotations/[id]/builder/page.tsx");
  assert.match(server, /<CustomItemTargetProvider value=\{\{ kind: "server", quotationId: quotation\.id, sectionId \}\}>/);
});

// ── Menu ─────────────────────────────────────────────────────────────────────────────────────────────────────
test("menu: Save as custom item is in the local desktop and mobile More menus and the server More menu, for manual rows only", () => {
  const local = read("../../../components/quotations/local-quotation-builder.tsx");
  assert.equal((local.match(/<SaveAsCustomItemButton row=\{item\} \/>/g) ?? []).length, 2);
  assert.match(local, /Remove<\/button><SaveAsCustomItemButton row=\{item\} \/><\/>\)\} itemId=\{item\.id\}/);
  const server = read("../../../app/quotations/[id]/builder/page.tsx");
  assert.match(server, /item\.item_type === "custom" && !item\.source_template_id \? \(\s*<SaveAsCustomItemButton/);
  const button = read("../../../components/quotations/save-as-custom-item-button.tsx");
  assert.match(button, /if \(!prefilled\.ok\) return null;/);
  assert.match(button, /role="dialog" aria-modal="true"/);
  assert.match(button, /Open My Collection/);
  assert.match(button, /CustomItemForm item=\{null\} defaults=\{prefilled\.defaults\}/);
  // the existing product entry and its test shape are unchanged
  assert.match(local, /<SharedQuotationMoreMenu actionButtons=\{\(<>\{item\.item_type === "product" && item\.source_template_id \? \(<SaveLineToMyCollectionButton line=\{item\} \/>\) : null\}\{copiedRowClipboard/);
  // logic: absent for product, note, blank, heading rows
  for (const row of [{ item_type: "product" }, { item_type: "note" }, { item_type: "blank" }, { item_type: "custom", line_style: "heading" }]) assert.equal(isManualItemRow(row), false);
  assert.equal(isManualItemRow({ item_type: "custom", line_style: "normal" }), true);
});

// ── Consumers ────────────────────────────────────────────────────────────────────────────────────────────────
test("a row created from a custom item is an ordinary manual row for duplicate, paste, approval and project snapshots", () => {
  // Only existing keys are written, so every consumer that copies source_component_data whole behaves as for any manual row.
  const builder = read("../../../components/quotations/local-quotation-builder.tsx");
  assert.match(builder, /function duplicateItem[\s\S]*?\.\.\.source,/);
  assert.match(builder, /function cloneQuotationRowForSection[\s\S]*?cloneUnknown\(source\)/);
  assert.match(read("../../../app/quotations/actions.ts"), /source_component_data: source\.source_component_data \?\? null,/);
  assert.match(read("../../../lib/local/quotation-publication-payload.ts"), /source_component_data: jsonValue\(item\.source_component_data\)/);
  for (const file of ["lib/local/quotation-workspace.ts", "lib/local/quotation-publication-payload.ts", "lib/quotations/derived-document-data.ts"]) {
    assert.doesNotMatch(read(`../../../${file}`), /custom-item|saved_custom_items|CustomItem/, file);
  }
  // the PR 2b-1 table code and saved_setups code are untouched by this PR
  assert.doesNotMatch(read("./saved-setups-service.ts"), /saved_custom_items/);
  assert.doesNotMatch(read("./recipe.ts"), /custom/i);
});
