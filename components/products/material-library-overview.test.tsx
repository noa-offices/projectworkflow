import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MaterialBrandCard, MaterialGroupCard, MaterialLibraryOverview, type MaterialLibraryGroup } from "./material-library-overview";

const noop = () => {};
const group = (id: string, brandId: string, name: string, extra: Partial<MaterialLibraryGroup> = {}): MaterialLibraryGroup => ({ activeCount: 4, brandId, brandLabel: "Arca / AR", description: "", id, isActive: true, name, needsReview: false, searchText: name.toLowerCase(), sortOrder: 0, thumbs: [{ code: "L1", url: "/x.jpg" }], updatedAt: "2026-01-01", ...extra });
const brands = [{ id: "a", name: "Arca", code: "AR", isActive: true }, { id: "b", name: "Bolia", code: null, isActive: true }];
const groups = [group("1", "a", "Leather"), group("2", "a", "Fabric", { needsReview: true }), group("3", "a", "Wood"), group("4", "a", "Metal"), group("5", "a", "Glass")];
const render = (initialFilters = {}) => renderToStaticMarkup(<MaterialLibraryOverview addBrandHref="/products/brands?addBrand=1" brands={brands} createGroupAction={noop} deactivateGroupAction={noop} groups={groups} initialFilters={initialFilters} updateGroupAction={noop} />);
const count = (html: string, text: string) => html.split(text).length - 1;

test("one slim chip row, one toolbar with a single Add Group and Add Brand, and no big tiles", () => {
  const html = render();
  for (const label of ["Material groups", "Active groups", "Total materials", "Needs review"]) assert.match(html, new RegExp(label));
  assert.equal(count(html, "+ Add Group"), 1);
  assert.equal(count(html, "+ Add Brand"), 1);
  assert.match(html, /Back to products/); assert.match(html, /type="search"/); assert.match(html, /Search groups, materials, or keywords/);
  for (const label of ["All brands", "All groups", "All status"]) assert.match(html, new RegExp(label));
  assert.match(html, /2 of 2 brands/);
  assert.doesNotMatch(html, /Across all brands|Requires attention|Currently active/);
});

test("brand cards use a 1, 2, 3, 4 column grid and show name, code, counts, +N chips and one button", () => {
  const html = render();
  assert.match(html, /@min-.576px.:grid-cols-2/); assert.match(html, /@min-.896px.:grid-cols-3/); assert.match(html, /@min-.1040px.:grid-cols-4/); assert.match(html, /@container/);
  assert.match(html, /5 groups · 20 materials/); assert.match(html, /\+2/); assert.match(html, /Open brand/); assert.match(html, /Add first group/);
  const card = renderToStaticMarkup(<MaterialBrandCard onAddGroup={noop} onOpen={noop} row={{ brand: brands[0], groups: groups.slice(0, 1), materials: 4, thumbs: groups[0].thumbs }} />);
  assert.match(card, /Arca/); assert.match(card, />AR</); assert.match(card, /1 group · 4 materials/); assert.match(card, /loading="lazy"/);
});

test("group cards keep View Group and Edit; the list view and filtered views use the same compact layout", () => {
  const card = renderToStaticMarkup(<MaterialGroupCard deactivateGroupAction={noop} group={groups[0]} returnTo="/products/materials" updateGroupAction={noop} viewHref={(g, edit) => edit ? `/edit/${g.id}` : `/view/${g.id}`} />);
  assert.match(card, /View Group/); assert.match(card, /href="\/edit\/1"/); assert.match(card, /Deactivate/);
  const filtered = render({ status: "needs_review" });
  assert.match(filtered, /1 of 5 groups/); assert.match(filtered, /aria-pressed="true"/); assert.match(filtered, /View Group/);
  const list = render({ view: "list", level: "groups" });
  assert.match(list, /<table/); assert.match(list, /5 of 5 groups/);
});

test("an empty result names the search and offers Clear search", () => {
  const html = render({ q: "zzz" });
  assert.match(html, /No results for &quot;zzz&quot;\./); assert.match(html, /Clear search/);
});
