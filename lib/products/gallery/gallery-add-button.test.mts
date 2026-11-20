import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { completeGalleryRecipe, GALLERY_MESSAGES } from "./gallery";
import { GALLERY_PICK_MESSAGES, galleryPickMessage, openGalleryPick } from "./gallery-add-flow";
import type { GalleryAddItem } from "./gallery-service";
import { buildRecipe } from "../saved-setups/recipe";
import { evaluateSetup, type SetupTemplateInput } from "../saved-setups/replay";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const code = (text: string) => text.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
const button = read("../../../components/quotations/add-from-gallery-button.tsx");
const flow = read("./gallery-add-flow.ts");
const selector = read("../../../components/quotations/product-library-selector.tsx");

const TPL = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ITEM = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";

test("wiring: mounted once in the selector, right after My Collection, with the same replay handler", () => {
  assert.match(selector, /import \{ AddFromGalleryButton \} from "\.\/add-from-gallery-button";/);
  assert.match(selector, /<AddFromMyCollectionButton onChoose=\{openSetupFromCollection\} \/>\n\s*<AddFromGalleryButton onChoose=\{openSetupFromCollection\} \/>\n\s*\{clientHistory \?/);
  assert.equal((selector.match(/<AddFromGalleryButton/g) ?? []).length, 1);
  // Inside the same `!reconfigure` fragment as its siblings (hidden when reconfiguring).
  const fragment = selector.slice(selector.indexOf("{!reconfigure ? <><button"), selector.indexOf("</> : null}", selector.indexOf("<AddFromGalleryButton")));
  assert.ok(fragment.includes("<AddFromGalleryButton") && fragment.includes("<AddFromMyCollectionButton"));
  // The selector gets no gallery price, rate or state.
  assert.doesNotMatch(code(selector), /gallery-price|GalleryPrice|GalleryRates|getGalleryPricesAction|fetchGalleryListFacts/);
});

test("the button and flow: no price code, no quote actions, no storage, no admin client, no direct add", () => {
  const text = code(button) + code(flow);
  assert.doesNotMatch(text, /gallery-price|GalleryPrice|GalleryRates|getGalleryPricesAction|fetchGalleryListFacts|formatMoney|sourceTotals|currency|AED/);
  assert.doesNotMatch(text, /app\/quotations|addProductTemplateToQuotation|onAddLocalItem|localStorage|sessionStorage|createAdminClient|supabase\/admin|service_role/i);
  assert.match(button, /openGalleryPick\(item\.id, getGalleryItemForAddAction, onChoose\)/);
  assert.match(button, /<AddFromGalleryPicker open onClose=\{\(\) => setOpen\(false\)\} onPick=\{pick\} \/>/);
  assert.match(button, /if \(result\.ok\) setOpen\(false\);\n\s*else setNotice\(result\.message\)/, "closes on success only; a failure keeps the dialog open with a notice");
  assert.match(button, /Add from Gallery/);
});

const setup = { id: ITEM, templateId: TPL, setupName: "Oxi_Q", recipe: completeGalleryRecipe({ recipe_version: 1, template_id: TPL, selections: { variant_row_id: "row1" }, linked: { selections: {} } }, TPL)!, specOverrides: {} as never };
const added: GalleryAddItem = { id: ITEM, templateId: TPL, itemName: "Oxi_Q", setup };

test("pick flow: success hands the setup to onChoose and closes; failures show the plain message and keep it open", async () => {
  const seen: unknown[] = [];
  const ok = await openGalleryPick(ITEM, async (input) => { seen.push(input); return { ok: true, item: added }; }, (given) => { seen.push(given.templateId); return null; });
  assert.deepEqual(ok, { ok: true });
  assert.deepEqual(seen, [{ id: ITEM }, TPL]);

  const fail = (message: string) => openGalleryPick(ITEM, async () => ({ ok: false, message }), () => assert.fail("onChoose must not run"));
  assert.deepEqual(await fail(GALLERY_MESSAGES.item_not_found), { ok: false, message: "This gallery item could not be found." });
  assert.deepEqual(await fail(GALLERY_MESSAGES.product_unavailable), { ok: false, message: "This product is no longer available." });
  assert.deepEqual(await fail(GALLERY_MESSAGES.load_failed), { ok: false, message: "Could not open this item. Please try again." });
  assert.equal(galleryPickMessage(GALLERY_MESSAGES.recipe_unreadable), GALLERY_PICK_MESSAGES.failed);
  assert.deepEqual(await openGalleryPick(ITEM, async () => { throw new Error("offline"); }, () => null), { ok: false, message: GALLERY_PICK_MESSAGES.failed }, "never throws to the browser");
  assert.deepEqual(await openGalleryPick(ITEM, async () => ({ ok: true, item: added }), () => "This product is not available in this Product Library."), { ok: false, message: "This product is not available in this Product Library." }, "the replay's own refusal keeps the dialog open");
});

// ── Golden replay of a gallery-style recipe (stored shape, completed by completeGalleryRecipe) ──
const variantRows = [{ id: "grp1", pricing_type: "base_model_group", group_name: "Models", is_active: true, sort_order: 0, items: [
  { id: "row1", display_name: "1800x900", price: 500, is_active: true, sort_order: 0 },
  { id: "row2", display_name: "2000x900", price: 600, is_active: true, sort_order: 1 },
] }];
const template = (extra: Partial<SetupTemplateInput> = {}): SetupTemplateInput => ({ id: TPL, template_name: "Oxi_Q", currency: "EUR", default_unit_price: 0, variant_pricing: variantRows, ...extra });
const stored = (selections: Record<string, unknown>) => completeGalleryRecipe({ recipe_version: 1, template_id: TPL, selections, linked: { selections: {} } }, TPL)!;

test("golden replay: a clean gallery recipe has no problems; removed option, retired template and removed finish give plain-words problems", () => {
  const clean = evaluateSetup(stored({ variant_row_id: "row1" }), undefined, template(), { componentIds: [], materialIds: [], linkedFamilyIds: [] });
  assert.deepEqual(clean.validation, { status: "ok", problems: [] });

  const option = evaluateSetup(stored({ variant_row_id: "row1", component_option_selections: { "Armrest:1": "opt-gone" } }), undefined, template(), { componentIds: ["other"] });
  assert.equal(option.validation.status, "needs_review");
  assert.match(option.validation.problems[0].label, /option you chose in "Armrest" no longer exists/);

  const rowGone = evaluateSetup(stored({ variant_row_id: "row-gone" }), undefined, template());
  assert.ok(rowGone.validation.problems.some((problem) => problem.kind === "model_removed"));
  assert.equal(rowGone.state?.variantRowId, null);

  for (const retired of [template({ is_active: false }), template({ lifecycle_status: "retired" })]) {
    const gone = evaluateSetup(stored({ variant_row_id: "row1" }), undefined, retired);
    assert.deepEqual(gone.validation, { status: "unavailable", problems: [{ kind: "model_removed", label: "This product is no longer available." }] });
    assert.equal(gone.state, null);
  }

  // Gallery recipes carry no finishes (completeGalleryRecipe empties them); a setup recipe that does is still reported.
  assert.deepEqual(stored({ variant_row_id: "row1" }).finishes, []);
  const { recipe } = buildRecipe({ templateId: TPL, variantRowId: "row1", finishes: [{ brand_material_id: "mX", finish_name: "Walnut" }] });
  const finish = evaluateSetup(recipe, undefined, template(), { materialIds: ["m1"] });
  assert.match(finish.validation.problems[0].label, /The finish "Walnut" is no longer available\./);
});

test("price integrity: the setup handed to the replay has only ids and neutral overrides", () => {
  const text = JSON.stringify(setup.recipe);
  assert.doesNotMatch(text, /price|amount|currency|total|rate/i);
  assert.doesNotMatch(read("./gallery-service.ts").slice(read("./gallery-service.ts").indexOf("export async function getGalleryItemForAdd"), read("./gallery-service.ts").indexOf("// ── One item in full")), /sourceTotals|priceCheck|loadGalleryPrices/);
});
