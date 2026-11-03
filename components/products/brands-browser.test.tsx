import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { mock } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultBrandFilters } from "@/lib/products/brands-filter";

// The browser component only needs a router at click time, so a stub is enough for static markup.
mock.module("next/navigation", { namedExports: { useRouter: () => ({ push() {}, replace() {} }) } });
type Props = Parameters<typeof import("./brands-browser").BrandsBrowser>[0];

const rows = [
  { id: "1", name: "Colan", code: "COL", origin: "China", isActive: true, method: "manual" as const, mainCount: 10, subCount: 42, openHref: "/products/brands?brand=1", editHref: "/products/brands?brand=1&editBrand=1" },
  { id: "2", name: "Arca", code: null, origin: "Italy", isActive: false, method: "codes" as const, mainCount: 2, subCount: 3, openHref: "/products/brands?brand=2", editHref: "/products/brands?brand=2&editBrand=2" },
];
const render = async (extra: Partial<Props> = {}) => { const { BrandsBrowser } = await import("./brands-browser"); return renderToStaticMarkup(
  <BrandsBrowser rows={rows} initialFilters={defaultBrandFilters} selectedBrandId="" drawer={<p>Drawer body for Colan</p>} cardActions={{ "1": <button>Archive</button>, "2": <button>Restore</button> }} addForm={null} addHref="/products/brands?addBrand=1" backHref="/products" message="" {...extra} />); };
const count = (html: string, text: string) => html.split(text).length - 1;

test("there is exactly one Add Brand button, also when there are no brands", async () => {
  assert.equal(count(await render(), "+ Add Brand"), 1);
  assert.equal(count(await render({ rows: [] }), "+ Add Brand"), 1);
  assert.match(await render({ rows: [] }), /No brands yet\./);
});

test("cards show name, code, status, method, origin, counts and the same actions", async () => {
  const html = await render();
  assert.match(html, /Colan/); assert.match(html, /Code: COL/); assert.match(html, />Manual</); assert.match(html, />Codes</);
  assert.match(html, /Origin: China/); assert.match(html, /10 categories · 42 subcategories/);
  assert.match(html, />Open</); assert.match(html, />Edit</); assert.match(html, />Archive</); assert.match(html, />Restore</);
  assert.match(html, /2 of 2 brands/);
  assert.match(html, /md:grid-cols-2/); assert.match(html, /2xl:grid-cols-3/); assert.match(html, /auto-rows-fr/);
});

test("the toolbar has a live search, the two filters, and no Search button", async () => {
  const html = await render();
  assert.match(html, /type="search"/); assert.match(html, /All statuses/); assert.match(html, />Archived</); assert.match(html, /All price check methods/);
  assert.doesNotMatch(html, />Search</);
});

test("the starting filters from the address are applied to the first render", async () => {
  const html = await render({ initialFilters: { q: "col", status: "active", method: "manual" } });
  assert.match(html, /1 of 2 brands/); assert.doesNotMatch(html, /Arca/);
  const none = await render({ initialFilters: { q: "zzz", status: "all", method: "all" } });
  assert.match(none, /No brands match &quot;zzz&quot;\./); assert.match(none, /Clear search/); assert.match(none, /0 of 2 brands/);
});

test("the drawer opens from ?brand= and is not there otherwise", async () => {
  const open = await render({ selectedBrandId: "1" });
  assert.match(open, /role="dialog"/); assert.match(open, /aria-modal="true"/); assert.match(open, /Drawer body for Colan/); assert.match(open, /data-drawer-close/); assert.match(open, />Close</);
  assert.match(open, /motion-reduce:transition-none/);
  const closed = await render();
  assert.doesNotMatch(closed, /role="dialog"/); assert.doesNotMatch(closed, /Drawer body/);
});

test("the page no longer has the permanent right panel, the title card or the Search form", async () => {
  const source = readFileSync(new URL("../../app/products/brands/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /Open a brand to manage its details/);
  assert.doesNotMatch(source, /action="\/products\/brands"/);
  assert.doesNotMatch(source, /<h1/);
  assert.match(source, /<BrandsBrowser/);
});
