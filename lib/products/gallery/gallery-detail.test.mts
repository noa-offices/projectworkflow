import assert from "node:assert/strict";
import test from "node:test";
import {
  GALLERY_DETAIL_IMAGES_MAX,
  GALLERY_DETAIL_MATERIALS_PER_GROUP_MAX,
  accessoryGroups,
  buildGalleryDetail,
  describeRecipe,
  galleryDetailImages,
  isPriceLikeKey,
  looksLikeMoneyText,
  type ComponentRow,
  type LinkedFamilyRow,
  mapMaterials,
  mapOptions,
  plainText,
  removePriceLikeKeys,
} from "./gallery-detail";

const TEMPLATE = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const ITEM = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const COMPONENT = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const PRICE_MARK = 98765; // a distinctive number used only as a price in the fixtures

// A template that DOES contain price data everywhere a template can.
const priceyTemplate = {
  id: TEMPLATE,
  template_name: "Buddy Chair",
  internal_selection_name: null,
  item_code: "BD1",
  template_code: "T-BD1",
  description: "A task chair.",
  default_specification: "Mesh back, 5-star base.",
  default_unit_price: PRICE_MARK,
  unit_price: PRICE_MARK,
  cost: PRICE_MARK,
  currency: "AED",
  default_image_url: "product-images/a.webp",
  reference_image_url: "product-images/ref.webp",
  proposed_image_url_1: "product-images/a.webp",
  proposed_image_url_2: "product-images/b.webp",
  proposed_image_url_3: "",
  variant_pricing: [
    {
      id: "vg1", pricing_type: "base_model_group", group_name: "Bases", is_active: true, sort_order: 0,
      items: [
        { id: "vr1", display_name: "Chrome", price: PRICE_MARK, is_active: true, sort_order: 0 },
        { id: "vr2", display_name: "Black", price: PRICE_MARK + 1, is_active: true, sort_order: 1 },
      ],
    },
  ],
  category_pricing: [],
  accessory_pricing: [
    {
      id: "ag1", group_name: "Add-ons", group_is_required: false, is_active: true, sort_order: 0,
      items: [
        { id: "ac1", item_name: "Cable Tray", price: PRICE_MARK, currency: "AED", is_active: true, sort_order: 0, role: "normal" },
        { id: "ac2", item_name: "Hidden Tray", price: PRICE_MARK, is_active: false, sort_order: 1 },
        { id: "ac3", price: PRICE_MARK, is_active: true, sort_order: 2 },
      ],
    },
    { id: "ag2", group_name: "Retired", is_active: false, items: [{ id: "ac4", item_name: "Gone", price: 5 }] },
  ],
  desking_size_pricing: [],
};

const stored = (selections: Record<string, unknown>) => ({
  recipe_version: 1,
  template_id: TEMPLATE,
  selections: { modular_quantities: {}, pricing_accessory_quantities: {}, component_accessory_quantities: {}, skipped_accessory_group_ids: [], component_option_selections: {}, accessory_category_choices: {}, ...selections },
  linked: { selections: {} },
});

test("images: default, proposed in order, reference last; empty and duplicate removed; at most 12", () => {
  assert.deepEqual(galleryDetailImages(priceyTemplate), ["product-images/a.webp", "product-images/b.webp", "product-images/ref.webp"]);
  assert.deepEqual(galleryDetailImages({ default_image_url: "  ", proposed_image_url_1: null, reference_image_url: "x.webp" }), ["x.webp"]);
  assert.deepEqual(galleryDetailImages({}), []);
  const many: Record<string, unknown> = { default_image_url: "d.webp", reference_image_url: "ref.webp" };
  for (let index = 1; index <= 20; index += 1) many[`proposed_image_url_${index}`] = `p${index}.webp`;
  const capped = galleryDetailImages(many);
  assert.equal(capped.length, GALLERY_DETAIL_IMAGES_MAX);
  assert.equal(capped.length, 12);
  assert.equal(new Set(capped).size, 12);
  assert.equal(capped[0], "d.webp");
});

test("plain text: trimmed, empty is null, bounded", () => {
  assert.equal(plainText("  Mesh back.\r\nFive star.  "), "Mesh back.\nFive star.");
  assert.equal(plainText("   "), null);
  assert.equal(plainText(5), null);
  assert.equal(plainText("x".repeat(9000))?.length, 4000);
});

test("materials: grouped by the template group, label override wins, full_group vs selected_items, long lists are capped with a count", () => {
  const materials = Array.from({ length: 45 }, (_, index) => ({ id: `m${index}`, material_group_id: "g1", material_code: `C${index}`, material_name: `Fabric ${index}`, sort_order: index }));
  const result = mapMaterials({
    links: [
      { id: "l1", material_group_id: "g1", selection_mode: "full_group", label_override: null, sort_order: 0 },
      { id: "l2", material_group_id: "g2", selection_mode: "selected_items", label_override: "Seat finish", sort_order: 1 },
      { id: "l3", material_group_id: "g3", selection_mode: "full_group", label_override: null, sort_order: 2 },
    ],
    groups: [{ id: "g1", group_name: "Fabrics" }, { id: "g2", group_name: "Leathers" }, { id: "g3", group_name: "Empty group" }],
    linkItems: [{ product_template_material_group_id: "l2", brand_material_id: "x1", sort_order: 1 }, { product_template_material_group_id: "l2", brand_material_id: "x2", sort_order: 0 }],
    materials: [
      ...materials,
      { id: "x1", material_group_id: "g2", material_code: null, material_name: "Nappa", sort_order: 0 },
      { id: "x2", material_group_id: "g2", material_code: "L9", material_name: "Aniline", sort_order: 0 },
      { id: "x3", material_group_id: "g2", material_code: null, material_name: "Not chosen", sort_order: 0 },
    ],
  });
  assert.deepEqual(result.map((group) => group.groupName), ["Fabrics", "Seat finish"], "a group with no materials is left out");
  assert.equal(result[0].items.length, GALLERY_DETAIL_MATERIALS_PER_GROUP_MAX);
  assert.equal(result[0].moreCount, 5);
  assert.equal(result[0].items[0], "C0 - Fabric 0");
  assert.deepEqual(result[1].items, ["L9 - Aniline", "Nappa"], "only the chosen materials, in their order");
  assert.equal(result[1].moreCount, 0);
});

test("options and accessories: names only, grouped, inactive left out, no item without a name", () => {
  const groups = accessoryGroups(priceyTemplate.accessory_pricing);
  assert.deepEqual(groups, [{ groupName: "Add-ons", kind: "accessory", items: ["Cable Tray"] }]);
  assert.deepEqual(accessoryGroups(null), []);
  assert.deepEqual(accessoryGroups([{ item_name: "Loose item", is_active: true }]), [{ groupName: "Accessories", kind: "accessory", items: ["Loose item"] }]);
  const options = mapOptions({
    components: [
      { id: "c1", component_group: "Casters", component_name: "Hard", option_type: "component_option", sort_order: 1 },
      { id: "c2", component_group: "Casters", component_name: "Soft", option_type: "component_option", sort_order: 0 },
      { id: "c3", component_group: null, component_name: "Headrest", option_type: "component_option", sort_order: 2 },
      { id: "c4", component_group: "Casters", component_name: null, option_type: null, sort_order: 3 },
    ],
    accessoryPricing: priceyTemplate.accessory_pricing,
    linkedFamilies: [{ id: "f1", label: "Matching table", sort_order: 0 }, { id: "f2", label: null, sort_order: 1 }],
  });
  assert.deepEqual(options.map((group) => [group.kind, group.groupName, group.items]), [
    ["option", "Casters", ["Soft", "Hard"]],
    ["option", "Options", ["Headrest"]],
    ["accessory", "Add-ons", ["Cable Tray"]],
    ["linked", "Linked products", ["Matching table"]],
  ]);
});

const describe = (selections: Record<string, unknown>, extra: { components?: ComponentRow[]; linkedFamilies?: LinkedFamilyRow[] } = {}) =>
  describeRecipe({ recipe: stored(selections), template: priceyTemplate, components: extra.components ?? [], linkedFamilies: extra.linkedFamilies ?? [] });

test("saved configuration: ids become readable lines; an unknown id is skipped, never shown", () => {
  const report = describe({
    variant_row_id: "vr1",
    pricing_accessory_quantities: { ac1: 2 },
    component_option_selections: { casters: [COMPONENT, "gone-component"] },
  }, { components: [{ id: COMPONENT, component_group: "Casters", component_name: "Soft", option_type: "component_option", sort_order: 0 }] });
  const text = JSON.stringify(report.lines);
  assert.ok(report.lines.some((line) => line.value === "Chrome"), "the base is named");
  assert.ok(report.lines.some((line) => line.label === "Add-ons" && line.value === "Cable Tray x 2"), "an accessory with its quantity");
  assert.ok(report.lines.some((line) => line.label === "Casters" && line.value === "Soft"), "an option component by name");
  assert.doesNotMatch(text, /vr1|ac1|cccccccc|gone-component/, "no raw ids");
  assert.ok(report.resolvedKinds.includes("variant_row") && report.resolvedKinds.includes("accessory") && report.resolvedKinds.includes("component_option"));
  assert.ok(report.skippedKinds.includes("component_option") === false, "a kind with at least one readable line is reported as resolved");
});

test("saved configuration: unresolved selections are skipped and reported, and a bad recipe gives nothing", () => {
  const report = describe({ variant_row_id: "does-not-exist", component_option_selections: { casters: ["nope"] } });
  assert.deepEqual(report.lines, [], "nothing readable, nothing shown");
  assert.ok(report.skippedKinds.includes("component_option"));
  assert.deepEqual(describeRecipe({ recipe: { not: "a recipe" }, template: priceyTemplate, components: [], linkedFamilies: [] }).lines, []);
  assert.deepEqual(describeRecipe({ recipe: stored({ variant_row_id: "vr1" }), template: { ...priceyTemplate, id: "other-template" }, components: [], linkedFamilies: [] }).lines, [], "a recipe of another product is refused");
  const linked = describeRecipe({
    recipe: { ...stored({}), linked: { selections: { fam1: { accessory_quantities: {} }, fam2: { accessory_quantities: {} } } } },
    template: priceyTemplate,
    components: [],
    linkedFamilies: [{ id: "fam1", label: "Matching table", sort_order: 0 }],
  });
  assert.deepEqual(linked.lines, [{ label: "Linked product", value: "Matching table" }], "only the linked product that has a name");
  assert.ok(linked.skippedKinds.includes("linked") === false);
});

test("a readable line never contains a uuid", () => {
  const uuid = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
  const report = describeRecipe({
    recipe: stored({ component_option_selections: { casters: [COMPONENT] } }),
    template: priceyTemplate,
    components: [{ id: COMPONENT, component_group: "Casters", component_name: `Option ${uuid}`, option_type: null, sort_order: 0 }],
    linkedFamilies: [],
  });
  assert.deepEqual(report.lines, []);
});

test("PRIVACY: the mapped detail of a template that holds price data has no price-like key and no price value", () => {
  const { detail } = buildGalleryDetail({
    item: { id: ITEM, template_id: TEMPLATE, item_name: "Buddy Chair", display_name: null, item_code: "BD1", tags: ["chair"], quoted_count: 3, recipe: stored({ variant_row_id: "vr2", pricing_accessory_quantities: { ac1: 1 } }) },
    template: priceyTemplate,
    brandName: "Acme",
    categoryName: "Chairs",
    subCategoryName: "Task",
    materials: [],
    components: [],
    linkedFamilies: [],
  });
  const json = JSON.stringify(detail);
  assert.ok(detail.configuration.length > 0 && detail.options.length > 0, "the fixture produced real content");
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) { keys.push(key); walk(entry); }
    else if (typeof value === "string") assert.equal(looksLikeMoneyText(value), false, `money-like text: ${value}`);
    else if (typeof value === "number") assert.notEqual(value, PRICE_MARK);
  };
  walk(detail);
  assert.deepEqual(keys.filter(isPriceLikeKey), [], "no price, prices, unit_price, cost, discount, amount or rate key");
  assert.ok(!json.includes(String(PRICE_MARK)) && !json.includes(String(PRICE_MARK + 1)), "no price number anywhere");
  assert.doesNotMatch(json, /default_unit_price|variant_pricing|category_pricing|accessory_pricing|desking_size_pricing|recipe_version|selections/, "no raw template JSON, no recipe");
  assert.deepEqual(Object.keys(detail).sort(), ["brandName", "categoryName", "configuration", "description", "displayName", "id", "images", "itemCode", "itemName", "materials", "options", "quotedCount", "specification", "subCategoryName", "tags", "templateCode", "templateId"]);
});

test("the last guard removes any price-like key and nothing else", () => {
  assert.equal(isPriceLikeKey("price"), true);
  assert.equal(isPriceLikeKey("prices"), true);
  assert.equal(isPriceLikeKey("unit_price"), true);
  assert.equal(isPriceLikeKey("listPrice"), true);
  assert.equal(isPriceLikeKey("internal_cost"), true);
  assert.equal(isPriceLikeKey("discountValue"), true);
  assert.equal(isPriceLikeKey("exchange_rate"), true);
  assert.equal(isPriceLikeKey("amount"), true);
  assert.equal(isPriceLikeKey("displayName"), false);
  assert.equal(isPriceLikeKey("templateCode"), false);
  assert.equal(isPriceLikeKey("quotedCount"), false);
  assert.deepEqual(removePriceLikeKeys({ name: "a", price: 1, nested: [{ unit_price: 2, label: "x" }], discount: 3 }), { name: "a", nested: [{ label: "x" }] });
  assert.equal(looksLikeMoneyText("AED 1,200"), true);
  assert.equal(looksLikeMoneyText("250 USD"), true);
  assert.equal(looksLikeMoneyText("1800 x 900 mm"), false);
});
