import assert from "node:assert/strict";
import test from "node:test";
import {
  GALLERY_DETAIL_IMAGES_MAX,
  GALLERY_DETAIL_SPECIFICATION_MAX,
  GALLERY_DETAIL_SWATCHES_PER_GROUP_MAX,
  GALLERY_DETAIL_SWATCHES_TOTAL_MAX,
  chooseSpecification,
  swatchImagePath,
  validSelectedImage,
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

const material = (id: string, group: string, code: string | null, name: string | null, imageUrl: string | null = null, sort = 0, extra: Record<string, unknown> = {}) => ({
  id, material_group_id: group, material_code: code, material_name: name, image_url: imageUrl, sort_order: sort, subgroup_id: null as string | null, material_collection: null as string | null, ...extra,
});
const fullLink = (id: string, group: string, order = 0, label: string | null = null) => ({ id, material_group_id: group, selection_mode: "full_group", label_override: label, sort_order: order });

test("swatches: each group has collections named by subgroup, else material_collection, else Other; counts, grade, ordering and fallbacks", () => {
  const result = mapMaterials({
    links: [fullLink("l1", "g1")],
    groups: [{ id: "g1", group_name: "Fabric Finishes" }],
    linkItems: [],
    subgroups: [
      { id: "sgEra", name: "Era", grade: "A", sort_order: 1 },
      { id: "sgFame", name: "Fame", grade: null, sort_order: 0 },
    ],
    materials: [
      material("m1", "g1", "ER02", "Sand", null, 2, { subgroup_id: "sgEra" }),
      material("m2", "g1", "ER01", "Jet Black", "materials/er01.webp", 1, { subgroup_id: "sgEra" }),
      material("m3", "g1", "FA01", "Fame One", "product-images:materials/fa01.webp", 0, { subgroup_id: "sgFame" }),
      material("m4", "g1", "CH01", "Chili Red", null, 0, { material_collection: "Chili" }),
      material("m5", "g1", "XX01", "Loose", null, 0),
      material("m5", "g1", "XX01", "Loose", null, 0),
      material("m6", "g1", "GH01", "Ghost", null, 0, { subgroup_id: "missing-subgroup", material_collection: "Jet" }),
      material("m7", "g1", "  ", "  "),
    ],
  });
  assert.equal(result.length, 1);
  const group = result[0];
  assert.equal(group.groupName, "Fabric Finishes");
  assert.equal(group.count, 6, "an empty row and a duplicate are not counted");
  assert.deepEqual(group.collections.map((collection) => [collection.name, collection.grade, collection.swatches.length]), [
    ["Fame", null, 1],
    ["Era", "A", 2],
    ["Chili", null, 1],
    ["Jet", null, 1],
    ["Other", null, 1],
  ], "subgroups by their sort order, then plain collection names, Other last; a missing subgroup falls back to material_collection");
  assert.deepEqual(group.collections[1].swatches.map((swatch) => swatch.code), ["ER01", "ER02"], "swatches by their own sort order");
  assert.deepEqual(group.collections[0].swatches[0], { code: "FA01", name: "Fame One", imagePath: "product-images:materials/fa01.webp" });
  assert.deepEqual(group.collections[1].swatches[1], { code: "ER02", name: "Sand", imagePath: null }, "a missing picture is null: the box shows the code");
  assert.equal(group.moreCount, 0);
});

test("swatches: same sort order falls back to the code (natural order); a subgroup with the same name but another grade is its own collection", () => {
  const result = mapMaterials({
    links: [fullLink("l1", "g1")],
    groups: [{ id: "g1", group_name: "Leathers" }],
    linkItems: [],
    subgroups: [{ id: "s1", name: "Amalfi", grade: "A", sort_order: 0 }, { id: "s2", name: "Amalfi", grade: "B", sort_order: 0 }],
    materials: [
      material("a", "g1", "L10", "Ten", null, 0, { subgroup_id: "s1" }),
      material("b", "g1", "L2", "Two", null, 0, { subgroup_id: "s1" }),
      material("c", "g1", "L1", "One", null, 0, { subgroup_id: "s2" }),
    ],
  });
  assert.deepEqual(result[0].collections.map((collection) => [collection.name, collection.grade]), [["Amalfi", "A"], ["Amalfi", "B"]]);
  assert.deepEqual(result[0].collections[0].swatches.map((swatch) => swatch.code), ["L2", "L10"]);
});

test("swatches: selected_items lists only the chosen materials in the chosen order, label override wins, an empty group is left out", () => {
  const result = mapMaterials({
    links: [
      fullLink("l0", "g1", 0),
      { id: "l2", material_group_id: "g2", selection_mode: "selected_items", label_override: "Seat finish", sort_order: 1 },
    ],
    groups: [{ id: "g1", group_name: "Empty" }, { id: "g2", group_name: "Leathers" }],
    linkItems: [{ product_template_material_group_id: "l2", brand_material_id: "x1", sort_order: 1 }, { product_template_material_group_id: "l2", brand_material_id: "x2", sort_order: 0 }],
    subgroups: [{ id: "s1", name: "Semi-Aniline", grade: null, sort_order: 0 }],
    materials: [material("x1", "g2", null, "Nappa", "https://cdn.example/n.webp", 0, { subgroup_id: "s1" }), material("x2", "g2", "L9", "Aniline", "a.webp", 0, { subgroup_id: "s1" }), material("x3", "g2", null, "Not chosen", null, 0, { subgroup_id: "s1" })],
  });
  assert.deepEqual(result.map((group) => group.groupName), ["Seat finish"]);
  assert.deepEqual(result[0].collections[0].swatches.map((swatch) => swatch.name), ["Aniline", "Nappa"]);
  assert.equal(result[0].collections[0].swatches[1].imagePath, "https://cdn.example/n.webp");
  assert.equal(result[0].collections[0].swatches[1].code, "Nappa", "no code: the name is the code");
  assert.equal(swatchImagePath("  "), null);
  assert.equal(swatchImagePath(5), null);
  assert.equal(swatchImagePath("a/b.webp"), "product-images:a/b.webp");
});

test("swatches: at most 400 per group and 1200 in all; the cap cuts the END of the order, the rest is only counted", () => {
  const many = (group: string, count: number, sub: string) => Array.from({ length: count }, (_, index) => material(`${group}-${sub}-${index}`, group, `C${String(index).padStart(3, "0")}`, `Finish ${index}`, `m/${group}-${sub}-${index}.webp`, index, { subgroup_id: sub }));
  const subs = ["s1", "s2", "s3", "s4"].map((id, index) => ({ id, name: `Collection ${index + 1}`, grade: null, sort_order: index }));
  const one = mapMaterials({ links: [fullLink("l1", "g1")], groups: [{ id: "g1", group_name: "Big" }], linkItems: [], subgroups: subs, materials: [...many("g1", 300, "s1"), ...many("g1", 150, "s2")] });
  assert.equal(one[0].count, GALLERY_DETAIL_SWATCHES_PER_GROUP_MAX);
  assert.equal(one[0].moreCount, 50);
  assert.deepEqual(one[0].collections.map((collection) => collection.swatches.length), [300, 100], "the first collection is whole; the cut is in the last one, at its tail");
  assert.equal(one[0].collections[1].swatches.at(-1)?.code, "C099", "the first swatches of that collection are kept");
  const three = mapMaterials({
    links: [fullLink("l1", "g1", 0), fullLink("l2", "g2", 1), fullLink("l3", "g3", 2), fullLink("l4", "g4", 3)],
    groups: ["g1", "g2", "g3", "g4"].map((id) => ({ id, group_name: id })),
    linkItems: [],
    subgroups: subs,
    materials: [...many("g1", 400, "s1"), ...many("g2", 400, "s2"), ...many("g3", 400, "s3"), ...many("g4", 10, "s4")],
  });
  assert.equal(three.reduce((sum, group) => sum + group.count, 0), GALLERY_DETAIL_SWATCHES_TOTAL_MAX, "the whole popup is capped");
  assert.deepEqual(three.map((group) => group.groupName), ["g1", "g2", "g3"], "a group that gets no room is not listed");
  const small = mapMaterials({ links: [fullLink("l1", "g1")], groups: [{ id: "g1", group_name: "Small" }], linkItems: [], subgroups: subs, materials: many("g1", 5, "s1") });
  assert.equal(small[0].moreCount, 0, "no note when no cap was hit");
});

test("swatches: no price, cost or supplier field in the payload", () => {
  const rows = [{ ...material("m1", "g1", "ER01", "Jet Black", "a.webp", 0, { subgroup_id: "s1" }), price: 98765, supplier_price: 98765, cost: 98765 }];
  const result = mapMaterials({ links: [fullLink("l1", "g1")], groups: [{ id: "g1", group_name: "Fabrics" }], linkItems: [], subgroups: [{ id: "s1", name: "Era", grade: "A", sort_order: 0, price: 98765 } as never], materials: rows });
  assert.doesNotMatch(JSON.stringify(result), /98765|price|cost|supplier/i);
  assert.deepEqual(Object.keys(result[0]).sort(), ["collections", "count", "groupName", "moreCount"]);
  assert.deepEqual(Object.keys(result[0].collections[0]).sort(), ["grade", "name", "swatches"]);
  assert.deepEqual(Object.keys(result[0].collections[0].swatches[0]).sort(), ["code", "imagePath", "name"]);
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
  assert.deepEqual(Object.keys(detail).sort(), ["brandName", "categoryName", "configuration", "description", "displayName", "id", "images", "itemCode", "itemName", "materials", "options", "quotedCount", "specification", "specificationSource", "subCategoryName", "tags", "templateCode", "templateId"]);
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

// ── specification ──────────────────────────────────────────────────────────
test("specification order: gallery text, generated from the saved choices, template specification, template description, none", () => {
  const all = { gallery: "  Saved by an editor.  ", generated: "Generated text.", templateSpecification: "Template spec.", templateDescription: "Template description." };
  assert.deepEqual(chooseSpecification(all), { text: "Saved by an editor.", source: "gallery", usedDescription: false });
  assert.deepEqual(chooseSpecification({ ...all, gallery: "   " }), { text: "Generated text.", source: "generated", usedDescription: false });
  assert.deepEqual(chooseSpecification({ ...all, gallery: null, generated: null }), { text: "Template spec.", source: "template", usedDescription: false });
  assert.deepEqual(chooseSpecification({ ...all, gallery: null, generated: "Template spec." }), { text: "Template spec.", source: "template", usedDescription: false }, "generated text equal to the template text is the template's");
  assert.deepEqual(chooseSpecification({ gallery: null, generated: null, templateSpecification: "  ", templateDescription: "Template description." }), { text: "Template description.", source: "template", usedDescription: true });
  assert.deepEqual(chooseSpecification({}), { text: null, source: "none", usedDescription: false });
  assert.equal(chooseSpecification({ gallery: "x".repeat(5000) }).text?.length, GALLERY_DETAIL_SPECIFICATION_MAX);
});

const accessoryTemplate = { ...priceyTemplate, default_specification: "Mesh back, 5-star base." };
const detailFor = (recipe: unknown, extra: Record<string, unknown> = {}, template: Record<string, unknown> = accessoryTemplate) =>
  buildGalleryDetail({
    item: { id: ITEM, template_id: TEMPLATE, item_name: "Buddy Chair", display_name: null, item_code: "BD1", tags: [], quoted_count: 1, recipe, ...extra },
    template: template as typeof priceyTemplate,
    brandName: "Acme", categoryName: "", subCategoryName: "", materials: [], components: [], linkedFamilies: [],
  }).detail;

test("detail specification: the gallery column wins; otherwise the generated text of a complete recipe; otherwise the template text", () => {
  const complete = stored({ variant_row_id: "vr1", pricing_accessory_quantities: { ac1: 1 } });
  assert.deepEqual([detailFor(complete, { specification: "Edited text." }).specification, detailFor(complete, { specification: "Edited text." }).specificationSource], ["Edited text.", "gallery"]);
  const generated = detailFor(complete);
  assert.equal(generated.specificationSource, "generated", "a complete saved configuration gives generated text");
  assert.notEqual(generated.specification, "Mesh back, 5-star base.");
  assert.match(generated.specification ?? "", /Cable Tray/, "the generated text names the chosen accessory");
  const incomplete = detailFor(stored({}));
  assert.deepEqual([incomplete.specification, incomplete.specificationSource], ["Mesh back, 5-star base.", "template"], "a recipe with an unresolved required step falls through to the template text");
  const stale = detailFor(stored({ variant_row_id: "does-not-exist" }));
  assert.equal(stale.specificationSource, "template", "a stale id falls through too");
  const onlyDescription = detailFor(stored({}), {}, { ...accessoryTemplate, default_specification: null });
  assert.deepEqual([onlyDescription.specification, onlyDescription.specificationSource, onlyDescription.description], ["A task chair.", "template", null], "the description is the specification and is not shown twice");
  const nothing = detailFor(stored({}), {}, { ...accessoryTemplate, default_specification: null, description: null });
  assert.deepEqual([nothing.specification, nothing.specificationSource], [null, "none"]);
});

test("detail specification: a template full of prices gives text without money, and a money-like generated text is never used", () => {
  const detail = detailFor(stored({ variant_row_id: "vr2", pricing_accessory_quantities: { ac1: 2 } }));
  const text = detail.specification ?? "";
  assert.ok(text.length > 0);
  assert.equal(looksLikeMoneyText(text), false);
  assert.doesNotMatch(text, /98765|98766/);
  assert.ok(text.length <= GALLERY_DETAIL_SPECIFICATION_MAX);
  const spec = describeRecipe({
    recipe: stored({ variant_row_id: "vr1" }),
    template: { ...priceyTemplate, variant_pricing: [{ id: "vg1", pricing_type: "base_model_group", group_name: "Bases", is_active: true, sort_order: 0, items: [{ id: "vr1", display_name: "Chrome", specification: "Chrome base, AED 1,200 each", price: 1, is_active: true, sort_order: 0 }] }] },
    components: [],
    linkedFamilies: [],
  }).generatedSpecification;
  assert.equal(spec, null, "text that looks like a price is dropped, so the next source is used");
});

// ── the picture chosen in the quotation builder ────────────────────────────
test("selected picture: valid only if it is one of the template's own pictures; the template's own spelling is returned", () => {
  const template = { default_image_url: "product-images:a.webp", proposed_image_url_1: "a.webp", proposed_image_url_2: "b.webp", proposed_image_url_3: "c.webp", reference_image_url: "ref.webp" };
  assert.equal(validSelectedImage(template, "b.webp"), "b.webp");
  assert.equal(validSelectedImage(template, "product-images:b.webp"), "b.webp", "with or without the usual prefix");
  assert.equal(validSelectedImage(template, "ref.webp"), "ref.webp", "the reference picture counts");
  assert.equal(validSelectedImage(template, "a.webp"), "product-images:a.webp", "the template's own spelling, never the stored text");
  for (const unknown of ["other.webp", "https://evil.example/x.png", "data:image/png;base64,AAAA", "../b.webp", "", "   ", null, undefined, 5]) assert.equal(validSelectedImage(template, unknown), null, String(unknown));
  assert.equal(validSelectedImage({}, "a.webp"), null, "a template with no pictures");
});

test("detail pictures: the chosen one first, the rest in the default order without duplicates; an invalid choice is ignored", () => {
  const template = { default_image_url: "a.webp", proposed_image_url_1: "a.webp", proposed_image_url_2: "b.webp", proposed_image_url_3: "c.webp", reference_image_url: "ref.webp" };
  assert.deepEqual(galleryDetailImages(template), ["a.webp", "b.webp", "c.webp", "ref.webp"], "default order");
  assert.deepEqual(galleryDetailImages(template, "c.webp"), ["c.webp", "a.webp", "b.webp", "ref.webp"]);
  assert.deepEqual(galleryDetailImages(template, "product-images:a.webp"), ["a.webp", "b.webp", "c.webp", "ref.webp"]);
  assert.deepEqual(galleryDetailImages(template, "removed.webp"), ["a.webp", "b.webp", "c.webp", "ref.webp"], "a picture that is no longer the template's is ignored");
  const many: Record<string, unknown> = { default_image_url: "d.webp", reference_image_url: "ref.webp" };
  for (let index = 1; index <= 20; index += 1) many[`proposed_image_url_${index}`] = `p${index}.webp`;
  const chosen = galleryDetailImages(many, "ref.webp");
  assert.equal(chosen.length, 12);
  assert.equal(chosen[0], "ref.webp", "the chosen picture is first even when it would have been cut");
});
