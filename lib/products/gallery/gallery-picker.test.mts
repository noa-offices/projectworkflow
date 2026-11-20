import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import type { GalleryListItem } from "./gallery";
import { EMPTY_PICKER_FILTERS, appendPickerPage, hasPickerFilters, isPickable, pickPayload, pickerKindLine, pickerListInput } from "./gallery-picker";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const picker = read("../../../components/quotations/add-from-gallery-picker.tsx");
const helper = read("./gallery-picker.ts");
const code = (text: string) => text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const item = (id: string, extra: Partial<GalleryListItem> = {}): GalleryListItem => ({
  id, templateId: "t", displayName: `Item ${id}`, itemName: id, itemCode: "", brandId: "b", brandName: "LAS MOBILI", categoryId: "c", categoryName: "Seating",
  subCategoryName: "", currency: "EUR", tags: [], quotedCount: 1, lastQuotedAt: "2026-11-01", isHidden: false, available: true, updateAvailable: false, picture: null as never, ...extra,
});

test("pick: the parent gets only the id and the name; unavailable items cannot be picked; Update available stays pickable", () => {
  assert.deepEqual(pickPayload(item("a1")), { id: "a1", name: "Item a1" });
  assert.equal(isPickable(item("a1")), true);
  assert.equal(isPickable(item("a2", { available: false })), false);
  assert.equal(isPickable(item("a3", { updateAvailable: true })), true);
  assert.equal(pickerKindLine(item("a1")), "LAS MOBILI · Seating");
  assert.equal(pickerKindLine(item("a1", { brandName: "" })), "Seating");
  assert.match(picker, /onClick=\{\(\) => \{ if \(pickable\) onPick\(pickPayload\(item\)\); \}\}/);
  assert.match(picker, /disabled=\{!pickable\}/);
  assert.match(picker, /No longer available/);
});

test("list: same action and paging as the gallery page, hidden items never requested, Load more appends without repeats", () => {
  assert.deepEqual(pickerListInput({ ...EMPTY_PICKER_FILTERS, query: "oxi", brandId: "b1" }, 2), { query: "oxi", brandId: "b1", categoryId: null, subCategoryId: null, sort: "popular", page: 2 });
  assert.doesNotMatch(code(helper), /includeHidden/);
  assert.equal(hasPickerFilters(EMPTY_PICKER_FILTERS), false);
  assert.equal(hasPickerFilters({ ...EMPTY_PICKER_FILTERS, categoryId: "c" }), true);
  assert.deepEqual(appendPickerPage([item("a"), item("b")], [item("b"), item("c")]).map((entry) => entry.id), ["a", "b", "c"]);
  assert.match(picker, /listGalleryItemsAction\(pickerListInput\(filters, 1\)\)/);
  assert.match(picker, /listGalleryItemsAction\(pickerListInput\(filters, page \+ 1\)\)/);
  assert.match(picker, /Load more/);
  assert.match(picker, /No gallery items yet/);
});

test("size: read from the batched call (dimensions only); no money is rendered or stored", () => {
  assert.match(picker, /const \{ dimensions: found \} = await fetchGalleryListFacts\(ids, getGalleryPricesAction\)/);
  assert.match(picker, /dimension \? <span[^>]*data-testid="gallery-picker-size"/);
  const text = code(picker);
  assert.doesNotMatch(text, /\.prices|prices\b|ProductGalleryPrice|GalleryPriceState|GalleryRatesContext|formatMoney|sourceTotals|priceCheck|currency|AED/, "no price code or text in the picker");
  assert.doesNotMatch(text, /tags|specification|quotedCount|quoted/i, "no tags, spec or quoted count on the card");
});

test("read-only: no edit controls, no URL sync, no storage, no admin client, and nothing is wired to adding", () => {
  const text = code(picker) + code(helper);
  assert.doesNotMatch(text, /history\.replaceState|pushState|localStorage|sessionStorage|createAdminClient|supabase\/admin|service_role/i);
  assert.doesNotMatch(text, /Remove|Restore|Merge|Rename|Edit mode|Check for updates|RatePopover|setHidden|removeGalleryItem|updateGalleryItem|mergeGalleryItems/);
  assert.doesNotMatch(text, /getGalleryItemForAdd|openSetupFromCollection|product-library-selector|app\/quotations|addProductTemplateToQuotation|loadSetupForReplay/);
  assert.match(picker, /if \(event\.key === "Escape"\) onClose\(\)/);
  assert.match(picker, /role="dialog"/);
});

test("not mounted: nothing imports the picker yet, and the protected files are untouched", () => {
  const sources = ["../../../components/quotations/product-library-selector.tsx", "../../../components/quotations/local-quotation-builder.tsx", "../../../app/quotations/[id]/builder/page.tsx", "../../../components/products/product-gallery-browser.tsx"];
  for (const path of sources) assert.doesNotMatch(read(path), /add-from-gallery-picker|AddFromGalleryPicker/, path);
});
