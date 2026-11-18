import assert from "node:assert/strict";
import test from "node:test";
import { evaluateSetup } from "../saved-setups/replay";
import { restorePlainState } from "../saved-setups/recipe";
import {
  GALLERY_MESSAGES,
  GALLERY_PAGE_SIZE,
  clampGalleryPage,
  cleanGalleryTag,
  completeGalleryRecipe,
  galleryDisplayName,
  galleryMessage,
  galleryQueryWords,
  gallerySortMode,
  galleryWordPattern,
  isGalleryId,
  neutralSpecOverrides,
  normaliseGalleryText,
  validateGalleryDisplayName,
  validateGalleryTags,
} from "./gallery";

const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ROW = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

test("the normaliser matches the database search_text rule", () => {
  assert.equal(normaliseGalleryText("BD-1"), "bd 1");
  assert.equal(normaliseGalleryText("Buddy  Chair"), "buddy chair");
  assert.equal(normaliseGalleryText("  EV_211 / Oak.Top  "), "ev 211 oak top");
  assert.equal(normaliseGalleryText("100%"), "100");
  assert.equal(normaliseGalleryText(42), "");
  assert.equal(normaliseGalleryText(null), "");
});

test("search words: normalised, unique, bounded", () => {
  assert.deepEqual(galleryQueryWords("Buddy  chair, BUDDY"), ["buddy", "chair"]);
  assert.deepEqual(galleryQueryWords("BD-1"), ["bd", "1"]);
  assert.deepEqual(galleryQueryWords("   "), []);
  assert.equal(galleryQueryWords("a b c d e f g h i j k l").length, 8);
  assert.equal(galleryQueryWords("x".repeat(200))[0].length, 40);
});

test("the LIKE pattern escapes % _ and a backslash so they only match themselves", () => {
  assert.equal(galleryWordPattern("desk"), "%desk%");
  assert.equal(galleryWordPattern("100%"), "%100\\\\%%");
  assert.equal(galleryWordPattern("a_b"), "%a\\\\_b%");
  assert.equal(galleryWordPattern("a\\b"), "%ab%", "a typed backslash cannot become an escape");
});

test("page size, page numbers and sort modes", () => {
  assert.equal(GALLERY_PAGE_SIZE, 30);
  assert.equal(clampGalleryPage(undefined), 1);
  assert.equal(clampGalleryPage("abc"), 1);
  assert.equal(clampGalleryPage(-3), 1);
  assert.equal(clampGalleryPage("4"), 4);
  assert.equal(clampGalleryPage(10 ** 9), 10_000);
  assert.equal(gallerySortMode(undefined), "popular");
  assert.equal(gallerySortMode("weird"), "popular");
  assert.equal(gallerySortMode("newest"), "newest");
  assert.equal(gallerySortMode("name"), "name");
});

test("display name: the curated name, else the product name", () => {
  assert.equal(galleryDisplayName({ displayName: "Buddy Chair", itemName: "BD-1" }), "Buddy Chair");
  assert.equal(galleryDisplayName({ displayName: null, itemName: "BD-1" }), "BD-1");
  assert.equal(galleryDisplayName({ displayName: "  ", itemName: "BD-1" }), "BD-1");
});

test("curation input: names 1-120 characters (or empty to clear), tags max 20 of 1-30 characters, lower-cased and de-duplicated", () => {
  assert.deepEqual(validateGalleryDisplayName("  Buddy  "), { ok: true, value: "Buddy" });
  assert.deepEqual(validateGalleryDisplayName(""), { ok: true, value: null });
  assert.deepEqual(validateGalleryDisplayName(null), { ok: true, value: null });
  assert.deepEqual(validateGalleryDisplayName("x".repeat(121)), { ok: false });
  assert.deepEqual(validateGalleryDisplayName(5), { ok: false });
  assert.deepEqual(validateGalleryTags([" Chair ", "chair", "OFFICE", ""]), { ok: true, value: ["chair", "office"] });
  assert.deepEqual(validateGalleryTags(undefined), { ok: true, value: [] });
  assert.deepEqual(validateGalleryTags("chair"), { ok: false });
  assert.deepEqual(validateGalleryTags(["x".repeat(31)]), { ok: false });
  assert.deepEqual(validateGalleryTags([1]), { ok: false });
  assert.deepEqual(validateGalleryTags(Array.from({ length: 21 }, (_, index) => `t${index}`)), { ok: false });
  assert.equal(validateGalleryTags(Array.from({ length: 20 }, (_, index) => `t${index}`)).ok, true);
  assert.equal(cleanGalleryTag(" Office "), "office");
  assert.equal(cleanGalleryTag("x".repeat(31)), null);
  assert.equal(isGalleryId(TEMPLATE), true);
  assert.equal(isGalleryId("nope"), false);
});

test("messages: one place, friendly text, no ids, paths or database words", () => {
  for (const [kind, text] of Object.entries(GALLERY_MESSAGES)) {
    assert.ok(text.length > 10, kind);
    assert.doesNotMatch(text, /supabase|uuid|recipe|rpc|policy|[0-9a-f]{8}-[0-9a-f]{4}/i, kind);
  }
  assert.equal(galleryMessage("product_unavailable"), "This product is no longer available.");
});

const stored = {
  recipe_version: 1,
  template_id: TEMPLATE,
  selections: {
    variant_row_id: ROW,
    modular_quantities: {},
    pricing_accessory_quantities: { [ROW]: 2 },
    component_accessory_quantities: {},
    skipped_accessory_group_ids: ["g1"],
    component_option_selections: {},
    accessory_category_choices: {},
  },
  linked: { selections: {} },
};

test("a stored structural recipe becomes a full recipe the existing replay can read", () => {
  const recipe = completeGalleryRecipe(stored, TEMPLATE);
  assert.ok(recipe);
  assert.equal(recipe?.template_id, TEMPLATE);
  assert.deepEqual(recipe?.finishes, []);
  assert.equal(recipe?.selected_image, null);
  assert.deepEqual(recipe?.linked.instances, {});
  assert.deepEqual(recipe?.selections.required_overrides, {});
  assert.equal(recipe?.selections.variant_row_id, ROW);
  assert.deepEqual(recipe?.selections.pricing_accessory_quantities, { [ROW]: 2 });
  assert.deepEqual(recipe?.selections.skipped_accessory_group_ids, ["g1"]);
});

test("an unreadable stored recipe is refused: wrong product, wrong version, price or discount keys, not an object", () => {
  assert.equal(completeGalleryRecipe(stored, "cccccccc-cccc-4ccc-8ccc-ccccccccccc1"), null, "template id differs");
  assert.equal(completeGalleryRecipe({ ...stored, recipe_version: 2 }, TEMPLATE), null);
  assert.equal(completeGalleryRecipe({ ...stored, selections: { ...stored.selections, discount: 5 } }, TEMPLATE), null);
  assert.equal(completeGalleryRecipe({ ...stored, selections: { ...stored.selections, price: 5 } }, TEMPLATE), null);
  assert.equal(completeGalleryRecipe({ ...stored, selections: null }, TEMPLATE), null);
  assert.equal(completeGalleryRecipe("x", TEMPLATE), null);
  assert.equal(completeGalleryRecipe(null, TEMPLATE), null);
  assert.equal(completeGalleryRecipe(stored, "nope"), null);
});

test("neutral spec overrides: no edited text; the EXISTING replay accepts them without any change to replay code", () => {
  const neutral = neutralSpecOverrides();
  assert.deepEqual(neutral, { specification_edited: false, edited_specification: null, generated_specification_hash: null });
  const recipe = completeGalleryRecipe(stored, TEMPLATE)!;
  const plain = restorePlainState(recipe, neutral);
  assert.equal(plain.specificationEdited, false);
  assert.equal(plain.editedSpecification, null);
  assert.equal(plain.dimensionOverride, null);
  assert.equal(plain.brandOverride, null);
  assert.deepEqual(plain.finishes, []);
  assert.deepEqual(plain.linkedInstances, {});
  const evaluation = evaluateSetup(recipe, neutral, { id: TEMPLATE, template_name: "Chair", currency: "AED", default_unit_price: 0, is_active: true, lifecycle_status: "active" }, { componentIds: [], materialIds: [], linkedFamilyIds: [] });
  assert.ok(evaluation.state, "the setup is restored");
  assert.notEqual(evaluation.validation.status, "unavailable");
  assert.ok(!evaluation.validation.problems.some((problem) => problem.kind === "unverified"), "the engine could check it");
  const unavailable = evaluateSetup(recipe, neutral, { id: TEMPLATE, template_name: "Chair", currency: "AED", default_unit_price: 0, is_active: true, lifecycle_status: "archived" });
  assert.equal(unavailable.validation.status, "unavailable");
});
