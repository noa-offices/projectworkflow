import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import JSZip from "jszip";
import { buildLinkedFinishSnapshot, blockLinkedFinishServerAdd, documentFinishRows } from "./linked-finish-snapshot";
import { reconfigureLocalRows } from "../../components/quotations/local-reconfigure";
import { buildMockPresentationPreviewData } from "./mock-presentation-data";
import { exportQuotationPresentationPptx } from "./presentation-pptx";
import type { LocalQuotationItem } from "../local/quotation-workspace";
import type { LinkedFinishChoice } from "../products/saved-setups/recipe";

// Rebuilt screen keys, group, fabric codes, names and relative swatch paths.
function fixture(screenCount: number, finishCount: number) {
  const screens = Array.from({ length: screenCount }, (_, i) => ({
    instanceKey: `aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa:screen-${i}`,
    instance: { label: ["Front screen", "Side screen"][i] ?? `Panel ${i}` },
    childTemplate: { id: "child", template_name: "Universal Screen" }, link: {}, qty: 1,
  }));
  const materials = new Map(Array.from({ length: finishCount + 1 }, (_, i) => {
    const material = { id: String(i), material_group_id: "fabric", material_code: String(528 + i),
      material_name: i === 0 ? "Acid green" : `Fabric ${i}`, image_url: `swatches/fabric-${i}.webp`,
      brand_id: "brand", description: null, material_category: null, sort_order: i, is_active: true };
    return [material.id, material] as const;
  }));
  const choices = Object.fromEntries(screens.map((s, i) => [s.instanceKey, Array.from({ length: finishCount },
    (_, n): LinkedFinishChoice => ["link", String(i === 1 && n === finishCount - 1 && finishCount < 131 ? finishCount : n)])]));
  const link = { id: "link", label_override: "Fabric", product_template_id: "child", material_group_id: "fabric",
    sort_order: 0, is_required: false, allow_multiple: true, show_in_specification: true, show_in_quotation: false };
  const build = (visible = true) => buildLinkedFinishSnapshot(screens, choices, [{ ...link, show_in_specification: visible }], [], materials);
  return { screens, choices, build };
}

const parent = [{ id: "parent", group_label: "Metal", finish_name: "Desk metal" }];
const rowsFor = (snapshot: ReturnType<ReturnType<typeof fixture>["build"]>) =>
  documentFinishRows(parent, snapshot, () => parent) as Record<string, unknown>[];

test("local snapshot isolates linked finishes, shares swatches and keeps both visibility flags", (t) => {
  const { build, screens, choices } = fixture(2, 5);
  const snapshot = build()!;
  assert.equal(snapshot[0].length, 6);
  assert.deepEqual(snapshot[1][0][2][0].slice(1, 3), [true, false]);
  assert.equal(rowsFor(snapshot).length, 11);
  assert.equal(rowsFor(snapshot).filter((row) => row.finish_name === "Acid green").length, 2);
  assert.equal(new Set(rowsFor(snapshot).map((row) => row.id)).size, 11);
  assert.deepEqual(rowsFor(build(false)), parent);
  assert.equal(rowsFor(undefined), parent);
  assert.deepEqual(parent, [{ id: "parent", group_label: "Metal", finish_name: "Desk metal" }]);
  assert.equal(blockLinkedFinishServerAdd(false, false, screens, choices), true);
  assert.equal(blockLinkedFinishServerAdd(true, false, screens, choices), false);
  assert.equal(blockLinkedFinishServerAdd(false, true, screens, choices), false);
  assert.equal(blockLinkedFinishServerAdd(false, false, screens, {}), false);
  t.diagnostic(`Snapshot UTF-8 bytes: 2 x 5 = ${Buffer.byteLength(JSON.stringify(snapshot))}, 6 x 131 = ${Buffer.byteLength(JSON.stringify(fixture(6, 131).build()))}`);
});

test("selector sends linked swatches only in the local item source and guards server submission", () => {
  const selector = readFileSync("components/quotations/product-library-selector.tsx", "utf8");
  assert.match(selector, /source_component_data: \{\s*\.\.\.\(linkedFinishSnapshot && \{ linked_finish_snapshot: linkedFinishSnapshot \}\)/);
  assert.ok(selector.includes("onAddLocalItem?.(localProductItem)"));
  assert.ok(selector.includes("finish_selections_snapshot: selectedFinishes,"));
  assert.ok(selector.includes("finish_snapshot: finishSnapshotValue(selectedFinishes)"));
  assert.ok(selector.includes("onSubmit={reconfigure || blockServerFinishAdd ? (event) => event.preventDefault()"));
  assert.ok(selector.includes("|| linkedNeedsLocalBuilder || blockServerFinishAdd}"));
  assert.ok(selector.includes("Use the local quotation builder to add linked screens with finishes."));
});

test("snapshot-only Update preserves every other saved field, including timestamps", () => {
  const snapshot = fixture(2, 5).build();
  for (const existing of [{}, { linked_finish_snapshot: fixture(1, 1).build() }]) {
    const source = { configuration_recipe: { untouched: true }, ...existing };
    const saved = { id: "saved", source_template_id: "desk", updated_at: "old", qty: 2, unit_price: 789,
      finish_snapshot: "Metal", finish_selections_snapshot: parent, source_component_data: source } as unknown as LocalQuotationItem;
    const draft = { ...saved, updated_at: "now", unit_price: 1, qty: 4, finish_snapshot: null, finish_selections_snapshot: [],
      source_component_data: { linked_finish_snapshot: snapshot } };
    const before = JSON.stringify(saved);
    const [updated] = reconfigureLocalRows([saved], saved, draft, {
      linkedFinishes: true, configuration: false, price: false, specification: false, dimension: false, image: false,
    });
    assert.deepEqual(updated, { ...saved, source_component_data: { ...source, linked_finish_snapshot: snapshot } });
    assert.equal(JSON.stringify(saved), before);
  }
});

test("specification page and preview render separate screen headings, codes and swatches", async (t) => {
  const require = createRequire(import.meta.url);
  const mock = buildMockPresentationPreviewData({ layout: "single", scale: "default", finishes: "on" });
  const tables: Record<string, unknown> = {
    quotations: { ...mock.quotation, layout_settings: {}, currency: "AED" }, clients: mock.client,
    quotation_sections: mock.sections, product_template_material_groups: [],
    quotation_items: [{ ...mock.items[0], finish_selections_snapshot: parent, linked_finish_snapshot: fixture(2, 2).build() }],
  };
  const client = {
    from(table: string) {
      assert.ok(Object.hasOwn(tables, table));
      return {
        select(columns: string) {
          if (table === "quotation_items") assert.ok(columns.includes("linked_finish_snapshot:source_component_data->linked_finish_snapshot"));
          return this;
        },
        eq() { return this; }, order() { return this; },
        single() { return { data: tables[table] }; }, returns() { return { data: tables[table] }; },
      };
    },
    storage: { from: () => ({ createSignedUrl: (path: string) => ({ data: { signedUrl: "/fixture/" + path } }) }) },
  };
  for (const [id, exports] of [
    ["@/lib/auth", { requireActiveUser: async () => ({ profile: {} }) }],
    ["@/lib/company-profile", { ...require("@/lib/company-profile"), getCompanyProfile: async () => mock.companyProfile }],
    ["@/lib/supabase/server", { createClient: async () => client }],
    ["@/app/quotations/actions", { updateSpecificationSettings: assert.fail }],
  ] as const) {
    const key = require.resolve(id);
    const previous = require.cache[key];
    require.cache[key] = { loaded: true, exports } as NodeModule;
    t.after(() => { if (previous) require.cache[key] = previous; else delete require.cache[key]; });
  }
  const page = require("../../app/quotations/[id]/specification/page").default;
  const html = renderToStaticMarkup(await page({ params: Promise.resolve({ id: "fixture" }) }));
  assert.match(html, /Materials &amp; Finishes/);
  assert.match(html, /Desk metal/);
  assert.match(html, /Front screen \/ Fabric/);
  assert.match(html, /Side screen \/ Fabric/);
  assert.equal(html.match(/528 \| Acid green/g)?.length, 2);
  assert.match(html, /swatches\/fabric-0.webp/);
});

test("web product slide and exported PPTX include both screens and cap swatches at 25", async () => {
  const require = createRequire(import.meta.url);
  // Next normally substitutes these font exports at compile time.
  const fonts = require.resolve("../../components/quotations/presentation-fonts");
  require.cache[fonts] = { loaded: true, exports: { presentationSans: { variable: "" }, presentationSerif: { variable: "" } } } as NodeModule;
  const { QuotationPresentation } = require("../../components/quotations/quotation-presentation");
  const mock = buildMockPresentationPreviewData({ layout: "single", scale: "default", finishes: "on" });
  const item = { ...mock.items[0], is_optional: false, is_rate_only: false, finish_selections_snapshot: rowsFor(fixture(2, 13).build()) };
  const data = { ...mock, items: [item] };
  const html = renderToStaticMarkup(React.createElement(QuotationPresentation, { ...data, printMode: true }));
  const pptx = await exportQuotationPresentationPptx(data as Parameters<typeof exportQuotationPresentationPptx>[0]);
  const zip = await JSZip.loadAsync(pptx.content);
  const xml = (await Promise.all(zip.file(/^ppt\/slides\/slide\d+\.xml$/).map((slide) => slide.async("string")))).join("");
  for (const text of [html, xml]) {
    assert.match(text, /Front screen \/ Fabric/i);
    assert.match(text, /Side screen \/ Fabric/i);
    assert.match(text, /Desk metal/i);
    assert.match(text, /\+2 more/i);
    assert.doesNotMatch(text, />Fabric 13</i);
  }
});
