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
  requiredComponentsFromEngine,
  buildUpdates,
  staleFingerprint,
  supplierCodeIndex,
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
        { id: "vr1", display_name: "Chrome", supplier_price_list_code: "BASE 55", price: PRICE_MARK, is_active: true, sort_order: 0 },
        { id: "vr2", display_name: "Black", price: PRICE_MARK + 1, is_active: true, sort_order: 1 },
      ],
    },
  ],
  category_pricing: [],
  accessory_pricing: [
    {
      id: "ag1", group_name: "Add-ons", group_is_required: false, is_active: true, sort_order: 0,
      items: [
        { id: "ac1", item_name: "Cable Tray", supplier_price_list_code: "CT 100 200", price: PRICE_MARK, currency: "AED", is_active: true, sort_order: 0, role: "normal" },
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
  id, material_group_id: group, material_code: code, material_name: name, image_url: imageUrl, sort_order: sort, material_category: null as string | null, material_collection: null as string | null, subgroup_id: null as string | null, ...extra,
});
const link = (id: string, group: string, mode: string, order = 0, label: string | null = null) => ({ id, material_group_id: group, selection_mode: mode, label_override: label, sort_order: order });
const item = (linkId: string, materialId: string) => ({ product_template_material_group_id: linkId, brand_material_id: materialId, sort_order: 0 });

test("swatches: sections are headed like the quotation selector: 'category · collection' (SG3 · CHILI), A-Z, Other last; swatches by sort order then code", () => {
  const result = mapMaterials({
    links: [link("l1", "g1", "full_group")],
    groups: [{ id: "g1", group_name: "Fabric Finishes" }],
    linkItems: [],
    materials: [
      material("m1", "g1", "CH02", "Chili Two", null, 2, { material_category: "SG3", material_collection: "CHILI" }),
      material("m2", "g1", "CH01", "Chili One", "materials/ch01.webp", 1, { material_category: "SG3", material_collection: "CHILI" }),
      material("m3", "g1", "AM01", "Amalfi One", "product-images:materials/am01.webp", 0, { material_category: "SG 2", material_collection: "AMALFI" }),
      material("m4", "g1", "JT01", "Jet One", null, 0, { material_category: "SG3", material_collection: "" }),
      material("m5", "g1", "XX01", "Loose", null, 0),
      material("m5", "g1", "XX01", "Loose", null, 0),
      material("m6", "g1", "  ", "  "),
    ],
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].groupName, "Fabric Finishes");
  assert.equal(result[0].count, 5, "a duplicate and an empty row are not counted");
  assert.deepEqual(result[0].collections.map((collection) => [collection.name, collection.swatches.length]), [
    ["SG 2 · AMALFI", 1],
    ["SG3 · CHILI", 2],
    ["SG3", 1],
    ["Other", 1],
  ], "the selector's own order and labels: just the category when there is no collection; Other last");
  assert.deepEqual(result[0].collections[1].swatches.map((swatch) => swatch.code), ["CH01", "CH02"]);
  assert.deepEqual(result[0].collections[0].swatches[0], { code: "AM01", name: "Amalfi One", imagePath: "product-images:materials/am01.webp" });
  assert.deepEqual(result[0].collections[3].swatches[0], { code: "XX01", name: "Loose", imagePath: null }, "a missing picture is null: the box shows the code");
  assert.equal(result[0].moreCount, 0);
});

test("swatches: a material with no category or collection but a sub-group uses the sub-group's grade and name", () => {
  const result = mapMaterials({
    links: [link("l1", "g1", "full_group")],
    groups: [{ id: "g1", group_name: "Leathers" }],
    linkItems: [],
    subgroups: [{ id: "s1", name: "NAPPA-LEATHER", grade: "LG6", sort_order: 0 }, { id: "s2", name: "Plain", grade: null, sort_order: 1 }],
    materials: [material("a", "g1", "N1", "Nappa One", null, 0, { subgroup_id: "s1" }), material("b", "g1", "P1", "Plain One", null, 0, { subgroup_id: "s2" })],
  });
  assert.deepEqual(result[0].collections.map((collection) => collection.name), ["LG6 · NAPPA-LEATHER", "Other · Plain"], "the builder's format: grade · name; no grade, only the name (after Other like the builder does)");
});

test("swatches: label override wins; a group with no connected materials, or no name, is left out; the same code in two sections stays", () => {
  const result = mapMaterials({
    links: [link("l1", "g1", "full_group", 0, "Seat finish"), link("l2", "g2", "full_group", 1), link("l3", "gx", "full_group", 2)],
    groups: [{ id: "g1", group_name: "Leathers" }, { id: "g2", group_name: "Empty" }],
    linkItems: [],
    materials: [material("a", "g1", "L1", "One", null, 0, { material_category: "A" }), material("b", "g1", "L1", "One again", null, 0, { material_category: "B" })],
  });
  assert.deepEqual(result.map((group) => group.groupName), ["Seat finish"]);
  assert.equal(result[0].count, 2);
  assert.equal(swatchImagePath("  "), null);
  assert.equal(swatchImagePath(5), null);
  assert.equal(swatchImagePath("a/b.webp"), "product-images:a/b.webp");
});

// A fixture that mirrors the live product Buddy: three template groups saved as "selected_categories" whose item rows connect only a
// subset of each brand group (Fabric 155 of 209, Leather 12 of 36, Meshes 7 of 35).
function buddy() {
  const materials: ReturnType<typeof material>[] = [];
  const add = (group: string, total: number, category: string, collection: (index: number) => string) => {
    for (let index = 0; index < total; index += 1) materials.push(material(`${group}-${index}`, group, `${group.toUpperCase()}${String(index).padStart(3, "0")}`, `${group} finish ${index}`, `m/${group}-${index}.webp`, index, { material_category: category, material_collection: collection(index) }));
  };
  add("fab", 209, "SG3", (index) => (index % 2 ? "CHILI" : "JET"));
  add("lea", 36, "LG6", () => "NAPPA-LEATHER");
  add("mes", 35, "MG1", (index) => (index < 7 ? "PUREIS3, AIMIS1, EVERYIS1, BUDDYIS3, HEJIS3 Visitor chairs" : "OTHER MESH"));
  const links = [link("lf", "fab", "selected_categories", 0), link("ll", "lea", "selected_categories", 1), link("lm", "mes", "selected_categories", 2)];
  const linkItems = [
    ...materials.filter((entry) => entry.material_group_id === "fab").slice(0, 155).map((entry) => item("lf", entry.id)),
    ...materials.filter((entry) => entry.material_group_id === "lea").slice(0, 12).map((entry) => item("ll", entry.id)),
    ...materials.filter((entry) => entry.material_group_id === "mes").slice(0, 7).map((entry) => item("lm", entry.id)),
  ];
  const groups = [{ id: "fab", group_name: "Fabric Finishes" }, { id: "lea", group_name: "Leather Finishes" }, { id: "mes", group_name: "Meshes" }];
  return { materials, links, linkItems, groups };
}

test("Buddy: a template saved as selected_categories shows only its CONNECTED materials (155, 12 and 7), never the brand's 209, 36 and 35", () => {
  const { materials, links, linkItems, groups } = buddy();
  const result = mapMaterials({ links, groups, linkItems, materials });
  assert.deepEqual(result.map((group) => [group.groupName, group.count]), [["Fabric Finishes", 155], ["Leather Finishes", 12], ["Meshes", 7]]);
  assert.equal(result[0].collections.reduce((sum, collection) => sum + collection.swatches.length, 0), 155);
  assert.deepEqual(result[2].collections.map((collection) => collection.name), ["MG1 · PUREIS3, AIMIS1, EVERYIS1, BUDDYIS3, HEJIS3 Visitor chairs"], "only that subgroup of the mesh materials");
  const shown = new Set(result.flatMap((group) => group.collections.flatMap((collection) => collection.swatches.map((swatch) => swatch.code))));
  assert.equal(shown.has("FAB200"), false, "a material that is not connected is not shown");
  assert.equal(shown.has("FAB000"), true);
  assert.equal(shown.has("MES020"), false);
});

test("selection modes: full_group shows the whole group; selected_items behaves like selected_categories; an unknown mode is restricted like the selector; inactive items are not passed in", () => {
  const { materials, groups } = buddy();
  const all = mapMaterials({ links: [link("l1", "lea", "full_group")], groups, linkItems: [], materials });
  assert.equal(all[0].count, 36, "an 'all materials' group still shows the whole brand group");
  const items = [item("l1", "lea-0"), item("l1", "lea-1"), item("l1", "fab-0"), item("other-link", "lea-5")];
  const byItems = mapMaterials({ links: [link("l1", "lea", "selected_items")], groups, linkItems: items, materials });
  assert.deepEqual(byItems[0].collections[0].swatches.map((swatch) => swatch.code), ["LEA000", "LEA001"], "only this link's rows, and only materials of this brand group");
  const unknown = mapMaterials({ links: [link("l1", "lea", "something_new")], groups, linkItems: [item("l1", "lea-2")], materials });
  assert.equal(unknown[0].count, 1, "anything but full_group uses the item rows, exactly like the selector");
  const none = mapMaterials({ links: [link("l1", "lea", "selected_categories")], groups, linkItems: [], materials });
  assert.deepEqual(none, [], "a restricted group with no connected materials shows nothing");
});

test("swatches: at most 400 per group and 1200 in all; the cap cuts the END of the order, the rest is only counted", () => {
  const many = (group: string, count: number, collection: string) => Array.from({ length: count }, (_, index) => material(`${group}-${collection}-${index}`, group, `C${String(index).padStart(3, "0")}`, `Finish ${index}`, `m/${group}-${collection}-${index}.webp`, index, { material_category: "A", material_collection: collection }));
  const one = mapMaterials({ links: [link("l1", "g1", "full_group")], groups: [{ id: "g1", group_name: "Big" }], linkItems: [], materials: [...many("g1", 300, "ONE"), ...many("g1", 150, "TWO")] });
  assert.equal(one[0].count, GALLERY_DETAIL_SWATCHES_PER_GROUP_MAX);
  assert.equal(one[0].moreCount, 50);
  assert.deepEqual(one[0].collections.map((collection) => collection.swatches.length), [300, 100], "the first section is whole; the cut is in the last one, at its tail");
  assert.equal(one[0].collections[1].swatches.at(-1)?.code, "C099");
  const three = mapMaterials({
    links: [link("l1", "g1", "full_group", 0), link("l2", "g2", "full_group", 1), link("l3", "g3", "full_group", 2), link("l4", "g4", "full_group", 3)],
    groups: ["g1", "g2", "g3", "g4"].map((id) => ({ id, group_name: id })),
    linkItems: [],
    materials: [...many("g1", 400, "X"), ...many("g2", 400, "X"), ...many("g3", 400, "X"), ...many("g4", 10, "X")],
  });
  assert.equal(three.reduce((sum, group) => sum + group.count, 0), GALLERY_DETAIL_SWATCHES_TOTAL_MAX, "the whole popup is capped");
  assert.deepEqual(three.map((group) => group.groupName), ["g1", "g2", "g3"], "a group that gets no room is not listed");
  const small = mapMaterials({ links: [link("l1", "g1", "full_group")], groups: [{ id: "g1", group_name: "Small" }], linkItems: [], materials: many("g1", 5, "X") });
  assert.equal(small[0].moreCount, 0, "no note when no cap was hit");
});

test("swatches: no price, cost or supplier field in the payload", () => {
  const rows = [{ ...material("m1", "g1", "ER01", "Jet Black", "a.webp", 0, { material_category: "SG3", material_collection: "JET" }), price: 98765, supplier_price: 98765, cost: 98765 }];
  const result = mapMaterials({ links: [link("l1", "g1", "full_group")], groups: [{ id: "g1", group_name: "Fabrics" }], linkItems: [], materials: rows });
  assert.doesNotMatch(JSON.stringify(result), /98765|price|cost|supplier/i);
  assert.deepEqual(Object.keys(result[0]).sort(), ["collections", "count", "groupName", "moreCount"]);
  assert.deepEqual(Object.keys(result[0].collections[0]).sort(), ["name", "swatches"]);
  assert.deepEqual(Object.keys(result[0].collections[0].swatches[0]).sort(), ["code", "imagePath", "name"]);
});

test("options and accessories: names only, grouped, inactive left out, no item without a name", () => {
  const groups = accessoryGroups(priceyTemplate.accessory_pricing);
  assert.deepEqual(groups, [{ groupName: "Add-ons", kind: "accessory", items: [{ name: "Cable Tray", supplierCode: "CT 100 200" }] }], "name and supplier code");
  assert.deepEqual(accessoryGroups(null), []);
  assert.deepEqual(accessoryGroups([{ item_name: "Loose item", is_active: true }]), [{ groupName: "Accessories", kind: "accessory", items: [{ name: "Loose item" }] }]);
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
    ["option", "Casters", [{ name: "Soft" }, { name: "Hard" }]],
    ["option", "Options", [{ name: "Headrest" }]],
    ["accessory", "Add-ons", [{ name: "Cable Tray", supplierCode: "CT 100 200" }]],
    ["linked", "Linked products", [{ name: "Matching table" }]],
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
  assert.deepEqual(Object.keys(detail).sort(), ["brandName", "categoryName", "configuration", "description", "dimension", "displayName", "id", "images", "itemCode", "itemName", "materials", "options", "quotedCount", "requiredComponents", "specification", "specificationSource", "staleNotice", "subCategoryName", "tags", "templateCode", "templateId", "updates"]);
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

// ── required components and supplier codes ─────────────────────────────────
// A modular product (like OXI_P) whose template rules add a required component for the selected modules.
const MODULAR_GROUP = "mgrp1";
const oxiModular = [{
  id: MODULAR_GROUP, pricing_type: "modular_group", group_name: "Benches", is_active: true, sort_order: 0,
  modular_pricing_mode: "direct", modular_composition: { min_starters: 1, max_starters: 4 },
  items: [
    { id: "bench-a", pricing_type: "modular_item", modular_role: "starter", display_name: "Bench with Panel Base (A) W:140", supplier_price_list_code: "OXI 0A 140", price: 98765, currency: "EUR", is_active: true, sort_order: 0 },
    { id: "bench-b", pricing_type: "modular_item", modular_role: "starter", display_name: "Bench with Central Panels (B) W:140", price: 98766, currency: "EUR", is_active: true, sort_order: 1 },
  ],
}];
const requiredGroup = (extra: Record<string, unknown> = {}) => [{
  id: "req-top", group_name: "Top-Access", is_active: true, sort_order: 0,
  items: [{ id: "top-access", item_name: "Top-Access with Soft-Close", supplier_price_list_code: "111 058", dimension: "W:60", price: 98765, currency: "EUR", is_active: true, sort_order: 0, role: "companion", ...extra }],
  conditional_configuration: {
    role: "companion", selection: "choose_multiple",
    applicability: [{ target: { kind: "modular", group_id: MODULAR_GROUP, row_id: "bench-a" }, required: true, visible: true, allowed_item_ids: ["top-access"], fixed_quantity: 2, scale_with_target_quantity: true }],
  },
}];
const oxiTemplate = (accessory: unknown = requiredGroup(), extra: Record<string, unknown> = {}) => ({ ...priceyTemplate, variant_pricing: [], category_pricing: oxiModular, accessory_pricing: accessory, ...extra });
const oxiRecipe = (selections: Record<string, unknown> = { modular_quantities: { "bench-a": 2 } }) => stored(selections);

test("required components: the engine's quantity, the supplier code and the size; no price", () => {
  const report = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate(), components: [], linkedFamilies: [] });
  assert.deepEqual(report.requiredComponents, [{ name: "Top-Access with Soft-Close", quantity: 4, supplierCode: "111 058", size: "W:60" }]);
  assert.doesNotMatch(JSON.stringify(report.requiredComponents), /98765|price|currency/i);
});

test("required components: the quantity follows the saved modules (the rule engine, not a stored number)", () => {
  const one = describeRecipe({ recipe: oxiRecipe({ modular_quantities: { "bench-a": 1 } }), template: oxiTemplate(requiredGroup()), components: [], linkedFamilies: [] });
  assert.equal(one.requiredComponents[0]?.quantity, 2, "2 per bench x 1 bench");
  const two = describeRecipe({ recipe: oxiRecipe({ modular_quantities: { "bench-a": 2 } }), template: oxiTemplate(requiredGroup()), components: [], linkedFamilies: [] });
  assert.equal(two.requiredComponents[0]?.quantity, 4, "2 per bench x 2 benches");
  const none = describeRecipe({ recipe: oxiRecipe({ modular_quantities: { "bench-b": 1 } }), template: oxiTemplate(requiredGroup()), components: [], linkedFamilies: [] });
  assert.deepEqual(none.requiredComponents, [], "no rule for bench B: no required component");
});

test("required components: no item name falls back to the supplier code; no name and no code is skipped; empty case is an empty list", () => {
  const byCode = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate(requiredGroup({ item_name: "" })), components: [], linkedFamilies: [] });
  assert.deepEqual(byCode.requiredComponents.map((component) => [component.name, component.supplierCode]), [["111 058", "111 058"]]);
  const unnamed = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate(requiredGroup({ item_name: "", supplier_price_list_code: "" })), components: [], linkedFamilies: [] });
  assert.deepEqual(unnamed.requiredComponents, []);
  const noCodeNoSize = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate(requiredGroup({ supplier_price_list_code: undefined, dimension: undefined })), components: [], linkedFamilies: [] });
  assert.deepEqual(noCodeNoSize.requiredComponents, [{ name: "Top-Access with Soft-Close", quantity: 4 }], "missing code and size show nothing");
  const plain = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate([]), components: [], linkedFamilies: [] });
  assert.deepEqual(plain.requiredComponents, []);
});

test("required components: a stale or incomplete recipe, or one the engine cannot compute, skips the block silently (no crash)", () => {
  const stale = describeRecipe({ recipe: oxiRecipe({ modular_quantities: { "bench-a": 2, "bench-gone": 1 } }), template: oxiTemplate(), components: [], linkedFamilies: [] });
  assert.deepEqual(stale.requiredComponents, []);
  const incomplete = describeRecipe({ recipe: oxiRecipe({}), template: oxiTemplate(), components: [], linkedFamilies: [] });
  assert.deepEqual(incomplete.requiredComponents, []);
  const broken = describeRecipe({ recipe: oxiRecipe(), template: { ...oxiTemplate(), accessory_pricing: { not: "an array" }, category_pricing: "nonsense" }, components: [], linkedFamilies: [] });
  assert.deepEqual(broken.requiredComponents, []);
  assert.deepEqual(describeRecipe({ recipe: { not: "a recipe" }, template: oxiTemplate(), components: [], linkedFamilies: [] }).requiredComponents, []);
  assert.deepEqual(requiredComponentsFromEngine([{ stepKey: "accessory:req-top", optionId: "top-access", reason: "Required companion applied automatically (quantity 4)." }], "nonsense"), []);
});

test("required components: the engine's override wording is read too, and other auto-applied entries are ignored", () => {
  const entries = [
    { stepKey: "accessory:req-top", optionId: "top-access", reason: "Required companion quantity overridden to 6 by an earlier selection." },
    { stepKey: "variant_row", optionId: "vr1", reason: "Only one Base / Model row is available." },
    { stepKey: "accessory:req-top", optionId: "top-access", reason: "Required companion applied automatically (quantity 0)." },
  ];
  assert.deepEqual(requiredComponentsFromEngine(entries, requiredGroup()), [{ name: "Top-Access with Soft-Close", quantity: 6, supplierCode: "111 058", size: "W:60" }]);
});

test("supplier codes: on the saved configuration lines (modular rows, accessories, base rows) and in the options lists; missing codes show nothing", () => {
  const report = describeRecipe({
    recipe: oxiRecipe({ modular_quantities: { "bench-a": 1, "bench-b": 1 }, pricing_accessory_quantities: {} }),
    template: oxiTemplate(requiredGroup()),
    components: [],
    linkedFamilies: [],
  });
  const a = report.lines.find((line) => line.value.includes("(A)"));
  const b = report.lines.find((line) => line.value.includes("(B)"));
  assert.equal(a?.supplierCode, "OXI 0A 140");
  assert.ok(b && !("supplierCode" in b), "a row without a code has no supplierCode at all");
  const base = describe({ variant_row_id: "vr1" }).lines.find((line) => line.value === "Chrome");
  assert.equal(base?.supplierCode, "BASE 55");
  const acc = describe({ variant_row_id: "vr1", pricing_accessory_quantities: { ac1: 2 } }).lines.find((line) => line.value.startsWith("Cable Tray"));
  assert.equal(acc?.supplierCode, "CT 100 200");
  assert.deepEqual(supplierCodeIndex(priceyTemplate).get("ac1"), "CT 100 200");
  assert.equal(supplierCodeIndex(priceyTemplate).has("vr2"), false);
});

test("PRIVACY: price fields everywhere still give a payload with no price key or amount, but WITH the supplier codes and required components", () => {
  const { detail } = buildGalleryDetail({
    item: { id: ITEM, template_id: TEMPLATE, item_name: "OXI_P", display_name: null, item_code: "OXI", tags: [], quoted_count: 2, recipe: oxiRecipe({ modular_quantities: { "bench-a": 1 } }) },
    template: oxiTemplate(requiredGroup(), { variant_pricing: priceyTemplate.variant_pricing }),
    brandName: "LAS MOBILI", categoryName: "", subCategoryName: "", materials: [], components: [], linkedFamilies: [],
  });
  const json = JSON.stringify(detail);
  assert.ok(json.includes("111 058") && json.includes("OXI 0A 140"), "the supplier codes are in the payload");
  assert.equal(detail.configuration.some((line) => line.supplierCode === "OXI 0A 140"), true);
  assert.equal(detail.options.some((group) => group.items.some((item) => item.supplierCode === "111 058")), true, "and in the options and accessories list");
  assert.ok(detail.requiredComponents.length === 1);
  const keys: string[] = [];
  const walk = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") for (const [key, entry] of Object.entries(value)) { keys.push(key); walk(entry); }
    else if (typeof value === "string") assert.equal(looksLikeMoneyText(value), false, `money-like text: ${value}`);
    else if (typeof value === "number") assert.notEqual(value, PRICE_MARK);
  };
  walk(detail);
  assert.deepEqual(keys.filter(isPriceLikeKey), []);
  assert.equal(isPriceLikeKey("supplierCode"), false, "a supplier code is not a price");
  assert.equal(looksLikeMoneyText("111 058"), false);
  assert.ok(!json.includes(String(PRICE_MARK)) && !json.includes(String(PRICE_MARK + 1)));
});

test("required components: a modular product that also carries a legacy Base / Model group still shows them (Base / Model is not required there)", () => {
  const legacy = [{ id: "legacy", pricing_type: "base_model_group", group_name: "Legacy", is_active: true, sort_order: 0, items: [{ id: "d1", display_name: "Desk 1", price: 1, is_active: true, sort_order: 0 }, { id: "d2", display_name: "Desk 2", price: 2, is_active: true, sort_order: 1 }] }];
  const report = describeRecipe({ recipe: oxiRecipe(), template: oxiTemplate(requiredGroup(), { variant_pricing: legacy }), components: [], linkedFamilies: [] });
  assert.deepEqual(report.requiredComponents.map((component) => [component.name, component.quantity]), [["Top-Access with Soft-Close", 4]]);
  const plainBaseModel = describeRecipe({ recipe: oxiRecipe({}), template: { ...oxiTemplate(requiredGroup(), { variant_pricing: legacy }), category_pricing: [] }, components: [], linkedFamilies: [] });
  assert.deepEqual(plainBaseModel.requiredComponents, [], "a Base / Model product with no row chosen is still incomplete: no block");
});

// ── update offers (the compare data) and the stale fingerprint ─────────────
const pictureTemplate = { default_image_url: "a.webp", proposed_image_url_1: "a.webp", proposed_image_url_2: "b.webp", reference_image_url: "ref.webp" };
const offerRow = (kind: string, value: string | null, status = "open") => ({ kind, proposed_value: value, status });

test("compare data: only OPEN offers, only values that differ, picture only if it is one of the template's own", () => {
  const both = buildUpdates({ offers: [offerRow("specification", " New text. "), offerRow("picture", "product-images:b.webp")], currentSpecification: "Old text.", template: pictureTemplate, selectedImage: "a.webp" });
  assert.deepEqual(both, { specification: { current: "Old text.", proposed: "New text." }, picture: { currentPath: "a.webp", proposedPath: "b.webp" } });
  const ignored = buildUpdates({ offers: [offerRow("specification", "New", "ignored"), offerRow("picture", "b.webp", "ignored")], currentSpecification: "Old", template: pictureTemplate, selectedImage: null });
  assert.deepEqual(ignored, { specification: null, picture: null }, "an ignored offer is not shown");
  const same = buildUpdates({ offers: [offerRow("specification", "Old"), offerRow("picture", "b.webp")], currentSpecification: "Old", template: pictureTemplate, selectedImage: "b.webp" });
  assert.deepEqual(same, { specification: null, picture: null }, "nothing to compare when the value is already the current one");
  const unknownPicture = buildUpdates({ offers: [offerRow("picture", "https://evil.example/x.png")], currentSpecification: null, template: pictureTemplate, selectedImage: null });
  assert.equal(unknownPicture.picture, null, "a stored picture that is not the template's own is never sent");
  const noCurrent = buildUpdates({ offers: [offerRow("specification", "First text.")], currentSpecification: null, template: pictureTemplate, selectedImage: null });
  assert.deepEqual(noCurrent.specification, { current: null, proposed: "First text." });
  assert.deepEqual(buildUpdates({ offers: [], currentSpecification: "x", template: pictureTemplate, selectedImage: null }), { specification: null, picture: null });
  assert.equal(buildUpdates({ offers: [offerRow("specification", "AED 1,200 each")], currentSpecification: null, template: pictureTemplate, selectedImage: null }).specification, null, "text that looks like money is not offered");
});

test("compare data: the current picture falls back to the template's first picture; offers carry no price field", () => {
  const result = buildUpdates({ offers: [offerRow("picture", "b.webp")], currentSpecification: null, template: pictureTemplate, selectedImage: "gone.webp" });
  assert.equal(result.picture?.currentPath, "a.webp");
  assert.doesNotMatch(JSON.stringify(result), /price|cost|amount/i);
});

test("stale fingerprint: short, stable, order-independent, letters digits and dashes; null when nothing is stale", () => {
  assert.equal(staleFingerprint([]), null);
  const one = staleFingerprint([{ key: "variantRowId", id: "gone" }]);
  assert.match(one ?? "", /^stale1-[0-9a-f]+$/);
  assert.equal(staleFingerprint([{ key: "a", id: "1" }, { key: "b", id: "2" }]), staleFingerprint([{ key: "b", id: "2" }, { key: "a", id: "1" }]));
  assert.notEqual(staleFingerprint([{ key: "a", id: "1" }]), staleFingerprint([{ key: "a", id: "2" }]), "a different stale set gives a different fingerprint");
  assert.ok((staleFingerprint(Array.from({ length: 80 }, (_, index) => ({ key: "k", id: `id-${index}` }))) ?? "").length <= 200);
});

test("the editors-only fields are null for everyone else", () => {
  const { detail } = buildGalleryDetail({
    item: { id: ITEM, template_id: TEMPLATE, item_name: "x", display_name: null, item_code: null, tags: [], quoted_count: 1, recipe: stored({}) },
    template: priceyTemplate,
    brandName: "", categoryName: "", subCategoryName: "", materials: [], components: [], linkedFamilies: [],
  });
  assert.equal(detail.updates, null);
  assert.equal(detail.staleNotice, null);
});

test("saved recipe dimension comes from the engine, without exposing prices", () => {
  const template = { ...priceyTemplate, variant_pricing: [{ ...priceyTemplate.variant_pricing[0], items: [{ ...priceyTemplate.variant_pricing[0].items[0], dimension: "W:2800 D:1452 H:736 mm" }] }] };
  const report = describeRecipe({ recipe: stored({ variant_row_id: "vr1" }), template, components: [], linkedFamilies: [] });
  assert.equal(report.dimension, "W:2800 D:1452 H:736 mm");
  assert.equal(JSON.stringify(report).includes(String(PRICE_MARK)), false);
  const empty = describeRecipe({ recipe: null, template, components: [], linkedFamilies: [] });
  assert.equal(empty.dimension, null);
});

test("modular dimension uses the quotation builder's saved default", () => {
  const template = oxiTemplate([], { category_pricing: [...oxiModular, { pricing_type: "modular_meta", modular_default_dimension: "W:140: W:2800 D:1452 H:736 mm" }] });
  const report = describeRecipe({ recipe: oxiRecipe(), template, components: [], linkedFamilies: [] });
  assert.equal(report.dimension, "W:140: W:2800 D:1452 H:736 mm");
});
