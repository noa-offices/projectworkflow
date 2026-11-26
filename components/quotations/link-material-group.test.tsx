import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { saveTemplateMaterialGroupLink, type TemplateMaterialGroupLinkInput } from "../../lib/products/template-material-group-link";
import { FinishSelectionsEditor } from "./finish-selections-editor";
import { LinkMaterialGroupList, mergeMaterialGroupLinks, submitMaterialGroupLink } from "./link-material-group-picker";

const groups = [
  { id: "fabric", brand_id: "colan", group_name: "Colan Fabrics", sort_order: 0 },
  { id: "wood", brand_id: "colan", group_name: "Colan Woods", sort_order: 1 },
  { id: "other", brand_id: "other-brand", group_name: "Other Brand Group", sort_order: 0 },
];
const materials = ["fabric", "fabric", "wood"].map((groupId, i) => ({
  id: `m${i}`, brand_id: "colan", material_group_id: groupId, material_category: null, material_code: `C${i}`,
  material_name: `Finish ${i}`, description: null, image_url: null, sort_order: i, is_active: true,
}));

const input: TemplateMaterialGroupLinkInput = {
  productTemplateId: "accordion", materialGroupId: "fabric", selectionMode: "full_group",
  selectedMaterialIds: [], selectedMaterialCategories: [], labelOverride: null,
  isRequired: false, showInSpecification: true, showInQuotation: false, sortOrder: 0,
};

type Write = { table: string; op: string; payload?: unknown };

// In-memory stand-in for the user-session client: records writes and fails the named "table.op".
function fakeClient({ existing = null, fail = "", rows = materials }: { existing?: unknown; fail?: string; rows?: unknown[] } = {}) {
  const writes: Write[] = [];
  const from = (table: string) => {
    let op = "select";
    let payload: unknown;
    const result = () => {
      if (op !== "select") writes.push({ table, op, payload });
      if (fail === `${table}.${op}`) return { data: null, error: { message: "new row violates row-level security policy" } };
      if (table === "brand_materials") return { data: rows, error: null };
      if (op === "select") return { data: existing, error: null };
      return { data: { id: "new-link" }, error: null };
    };
    const query = {
      select: () => query,
      eq: () => query,
      insert: (value: unknown) => { op = "insert"; payload = value; return query; },
      update: (value: unknown) => { op = "update"; payload = value; return query; },
      delete: () => { op = "delete"; return query; },
      maybeSingle: async () => result(),
      single: async () => result(),
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve),
    };
    return query;
  };
  return { client: { from } as never, writes };
}

const editor = (extra: Partial<Parameters<typeof FinishSelectionsEditor>[0]> = {}) => renderToStaticMarkup(
  <FinishSelectionsEditor initialBrandId="colan" initialFinishes={[]} materialGroups={groups} materials={materials}
    quotationId="q" templateMaterialGroupItems={[]} templateMaterialGroups={[]} {...extra} />,
);
const linking = { productTemplateId: "accordion", brandId: "colan", save: async () => ({ ok: false as const, message: "x" }), onLinked: () => {} };

test("the Link material group button is hidden without link permission, and shown with it in both states", async () => {
  assert.doesNotMatch(editor(), />Link material group</);
  assert.match(editor({ linkMaterialGroup: linking }), />Link material group</);
  const saved = await saveTemplateMaterialGroupLink(fakeClient().client, input);
  assert.ok(saved.ok);
  assert.match(editor({ linkMaterialGroup: linking, templateMaterialGroups: [saved.link] }), />Link material group</);
});

test("the local builder popup gives the button only to product library managers", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /linkMaterialGroup=\{canManageProductLibrary && onMaterialGroupLinked \?/);
});

test("the picker lists this brand's groups with counts, and a linked group cannot be added again", () => {
  const html = renderToStaticMarkup(<LinkMaterialGroupList brandId="colan" groups={groups} linkedGroupIds={new Set(["fabric"])} materials={materials} search="" onChoose={() => {}} />);
  assert.doesNotMatch(html, /Other Brand Group/);
  assert.match(html, /<button[^>]*disabled=""[^>]*>.*?Colan Fabrics.*?2 materials.*?Linked.*?<\/button>/);
  const woods = html.slice(html.lastIndexOf("<button", html.indexOf("Colan Woods")), html.indexOf("Colan Woods"));
  assert.doesNotMatch(woods, /disabled=""/);
  assert.match(html, /1 material</);
  const searched = renderToStaticMarkup(<LinkMaterialGroupList brandId="colan" groups={groups} linkedGroupIds={new Set()} materials={materials} search="wood" onChoose={() => {}} />);
  assert.match(searched, /Colan Woods/);
  assert.doesNotMatch(searched, /Colan Fabrics/);
});

test("saving an already linked group is refused without any write", async () => {
  const { client, writes } = fakeClient({ existing: { id: "old", is_active: true } });
  const result = await saveTemplateMaterialGroupLink(client, input);
  assert.equal(result.ok, false);
  assert.deepEqual(writes, []);
});

test("a saved link keeps the setup defaults and appears in the Recommended tab", async () => {
  const { client, writes } = fakeClient();
  let added: Parameters<typeof mergeMaterialGroupLinks>[2] = [];
  const error = await submitMaterialGroupLink(() => saveTemplateMaterialGroupLink(client, input), new FormData(), (saved) => { added = [saved]; });
  assert.equal(error, "");
  assert.deepEqual(writes[0], { table: "product_template_material_groups", op: "insert", payload: {
    product_template_id: "accordion", material_group_id: "fabric", selection_mode: "full_group", label_override: null,
    is_required: false, allow_multiple: true, show_in_specification: true, show_in_quotation: false, sort_order: 0, is_active: true,
  } });
  const merged = mergeMaterialGroupLinks([], [], added);
  const html = editor({ templateMaterialGroups: merged.links, templateMaterialGroupItems: merged.items });
  assert.doesNotMatch(html, /No recommended material groups linked/);
  assert.match(html, /Colan Fabrics/);
  assert.match(html, /2 materials/);
  // A page refresh that already carries the link must not show it twice.
  assert.equal(mergeMaterialGroupLinks(merged.links, merged.items, added).links.length, 1);
});

test("selected finishes only saves the chosen items and offers just those", async () => {
  const { client, writes } = fakeClient({ rows: materials.slice(0, 2) });
  const result = await saveTemplateMaterialGroupLink(client, { ...input, selectionMode: "selected_items", selectedMaterialIds: ["m1"] });
  assert.ok(result.ok);
  assert.deepEqual(result.items.map((item) => item.brand_material_id), ["m1"]);
  assert.equal(writes.at(-1)?.table, "product_template_material_group_items");
});

test("a refused save changes nothing", async () => {
  const { client, writes } = fakeClient({ fail: "product_template_material_groups.insert" });
  let calls = 0;
  const error = await submitMaterialGroupLink(() => saveTemplateMaterialGroupLink(client, input), new FormData(), () => { calls += 1; });
  assert.equal(error, "Material group could not be linked.");
  assert.equal(calls, 0);
  assert.deepEqual(writes.map((write) => write.op), ["insert"]);
});

test("a selection with no matching finish writes nothing", async () => {
  const { client, writes } = fakeClient();
  const result = await saveTemplateMaterialGroupLink(client, { ...input, selectionMode: "selected_items", selectedMaterialIds: ["gone"] });
  assert.equal(result.ok, false);
  assert.deepEqual(writes, []);
});

test("if the finishes cannot be saved, the new link is switched off again", async () => {
  const { client, writes } = fakeClient({ fail: "product_template_material_group_items.insert" });
  const result = await saveTemplateMaterialGroupLink(client, { ...input, selectionMode: "selected_items", selectedMaterialIds: ["m0"] });
  assert.equal(result.ok, false);
  assert.deepEqual(writes.at(-1), { table: "product_template_material_groups", op: "update", payload: { is_active: false } });
});

test("a dropped connection shows a message and adds nothing", async () => {
  let calls = 0;
  const error = await submitMaterialGroupLink(async () => { throw new Error("fetch failed"); }, new FormData(), () => { calls += 1; });
  assert.match(error, /could not be linked/i);
  assert.equal(calls, 0);
});
