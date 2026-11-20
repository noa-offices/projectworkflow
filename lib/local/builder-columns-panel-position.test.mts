import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const builder = readFileSync(new URL("../../components/quotations/local-quotation-builder.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const start = builder.indexOf('buttonLabel="Columns"');
const wrapperStart = builder.lastIndexOf("<ClickAwayWrapper", start);
const panelStart = builder.indexOf('<div className="absolute right-0 xl:right-3', start);
const panelEnd = builder.indexOf("</ClickAwayWrapper>", start);
const wrapper = builder.slice(wrapperStart, start);
const panel = builder.slice(panelStart, panelEnd);
const panelClasses = /<div className="([^"]*)">/.exec(panel)?.[1] ?? "";

test("Columns panel: anchored to the sticky header (not the button), right edge in view, below the header", () => {
  assert.ok(panelStart > start);
  assert.doesNotMatch(builder, /xl:left-0 xl:right-auto/);
  assert.match(wrapper, /className="relative xl:static"/, "at xl the wrapper is not positioned, so the sticky header is the containing block; below xl it stays as before");
  for (const cls of ["absolute", "right-0", "xl:right-3", "xl:top-full", "z-30", "xl:mt-1", "w-[760px]", "max-w-[calc(100vw-2rem)]", "xl:max-w-[calc(100vw-1.5rem)]", "shadow-lg", "border", "flex-col"]) {
    assert.ok(panelClasses.split(" ").includes(cls), cls);
  }
  assert.match(builder, /<header className="sticky top-0 z-20 border-b border-zinc-300 bg-white">/, "the sticky header is the containing block");
});

test("Columns panel: never taller than the screen; the footer stays reachable", () => {
  assert.ok(panelClasses.split(" ").includes("max-h-[calc(100dvh-10rem)]"));
  assert.match(panel, /<div className="max-h-\[68vh\] min-h-0 flex-1 overflow-y-auto px-4 py-3">/);
  assert.match(panel, /<div className="sticky bottom-0 flex items-center justify-between gap-2 border-t border-zinc-200 bg-white px-4 py-3">[\s\S]*?Internal columns stay local to this quotation/);
  assert.match(panel, />\s*Reset defaults\s*</);
});

test("Columns panel: contents and handlers are unchanged, click-away is still wired", () => {
  for (const text of ["Local Column Settings", "Specification Display", "specificationMetadataFields.map", "updateSpecificationMetadataSetting(key, event.target.checked)", "columnSettingsGroups.map", "Custom Printable Columns", "setAddInternalColumnOpen(true)", "Internal columns stay local to this quotation"]) assert.ok(panel.includes(text), text);
  assert.match(builder.slice(wrapperStart, start + 300), /open=\{openToolbarDropdown === "columns"\}\s+onOpenChange=\{\(open\) => setOpenToolbarDropdown\(open \? "columns" : null\)\}/);
  const shared = readFileSync(new URL("../../components/quotations/shared-quotation-row-details-panel.tsx", import.meta.url), "utf8");
  assert.match(shared, /wrapper\.contains\(target\)/);
});

test("Specification Display box no longer stretches to the neighbouring column", () => {
  assert.match(panel, /<div className="grid items-start gap-3 xl:grid-cols-2">/);
});

test("the other header dropdowns keep their anchoring (checked in a browser harness: inside the viewport at 1280-1920)", () => {
  assert.match(builder, /xl:absolute xl:inset-x-auto xl:bottom-auto xl:right-0 xl:top-auto xl:z-30 xl:mt-2 xl:w-\[560px\] xl:max-w-\[calc\(100vw-2rem\)\]/);
  assert.match(builder, /absolute right-0 z-30 mt-2 grid min-w-\[220px\] gap-2/);
});
