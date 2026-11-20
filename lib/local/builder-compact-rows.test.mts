import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const builder = read("components/quotations/local-quotation-builder.tsx");
const sheet = read("components/quotations/quotation-sheet-table.tsx");
const imageBase = read("components/quotations/quotation-image-cell-base.tsx");
const header = builder.slice(builder.indexOf('<header className="sticky top-0 z-20'), builder.indexOf("</header>"));
const tools = header.slice(header.indexOf('data-builder-header-cluster="tools"'), header.indexOf('data-builder-header-cluster="actions"'));
const css = /const compactRowsCss = \[([\s\S]*?)\]\.join/.exec(builder)?.[1] ?? "";

test("Compact button: in the tools cluster next to Columns, aria-pressed, default off", () => {
  assert.match(tools, /buttonLabel="Columns"[\s\S]*?onClick=\{\(\) => setCompactRows\(\(on\) => !on\)\}\s+aria-pressed=\{compactRows\}[\s\S]*?>\s*Compact\s*<\/button>[\s\S]*?setView\("client"\)/);
  assert.match(builder, /const \[compactRows, setCompactRows\] = useState\(false\);/);
});

test("compact and fold state are plain React state: never saved, not in the workspace, undo history or storage", () => {
  const state = builder.slice(builder.indexOf("// Display-only view state"), builder.indexOf("const [collapsedSections"));
  assert.doesNotMatch(state, /localStorage|sessionStorage|commit\(|layout_settings|cell_layout/);
  for (const name of ["compactRows", "specExpandedRowIds", "collapsedSections"]) {
    assert.doesNotMatch(builder, new RegExp(`\b${name}\s*:`), `${name} is never an object key (so it cannot be written into a saved record)`);
    assert.doesNotMatch(builder, new RegExp(`(layout_settings|cell_layout|workspace)\.${name}\b`), name);
  }
  assert.doesNotMatch(builder.slice(builder.indexOf("const toggleSectionCollapsed"), builder.indexOf("const sectionCollapseControl")), /commit\(|localStorage|sessionStorage/);
});

test("compact styles are screen-only, scoped to the table, and never touch the stored row height", () => {
  assert.ok(css.length > 0);
  assert.match(css, /"@media screen \{"/);
  assert.match(css, /"\}",\s*$/);
  for (const rule of css.match(/'[^']*\{[^']*'/g) ?? []) assert.match(rule, /^'\[data-compact-rows="true"\]/, rule);
  assert.doesNotMatch(css, /@media print/);
  assert.match(css, /\[style\*="min-height"\]\{min-height:0 !important\}/, "a custom row height is ignored on screen only");
  assert.match(css, /\[data-quotation-image-box\]\{height:64px !important/);
  assert.match(css, /td\[data-cell="specification"\]:not\(\[data-spec-open="true"\]\):not\(:focus-within\) textarea\{max-height:2\.6em !important/, "two lines unless the row is opened or being edited");
  assert.match(builder, /<style>\{compactRowsCss\}<\/style>/);
  assert.match(sheet, /data-compact-rows=\{compactRows \? "true" : undefined\}/);
  assert.match(sheet, /compactRows = false,/);
  // No code writes row_height because of Compact.
  assert.doesNotMatch(builder, /compactRows[^\n]*row_height|row_height[^\n]*compactRows/);
});

test("image actions stay keyboard reachable: hidden by size/opacity, shown on hover or focus", () => {
  assert.match(css, /\[data-quotation-image-controls\]\{max-height:0;overflow:hidden;opacity:0\}/);
  assert.doesNotMatch(css, /display:none[^']*image/);
  assert.match(css, /\[data-quotation-image-cell\]:hover \[data-quotation-image-controls\],\[data-compact-rows="true"\] \[data-quotation-image-cell\]:focus-within \[data-quotation-image-controls\]/);
  assert.match(imageBase, /data-quotation-image-cell/);
  assert.equal((imageBase.match(/data-quotation-image-box/g) ?? []).length, 2);
  assert.match(imageBase, /<div className=\{resolvedControlsClassName\} data-quotation-image-controls>/);
});

test("per-row Show more / Show less is display-only and screen-only", () => {
  assert.match(builder, /data-cell="specification" data-spec-open=\{specExpandedRowIds\.has\(item\.id\) \? "true" : undefined\}/);
  assert.match(builder, /\{compactRows \? \(<button type="button" onClick=\{\(\) => setSpecExpandedRowIds\([^\n]*aria-expanded=\{specExpandedRowIds\.has\(item\.id\)\}[^\n]*print:hidden[^\n]*Show less" : "Show more"/);
});

test("section folding: chevrons with aria attributes on both bars, rows hidden on screen only, totals untouched", () => {
  assert.match(builder, /aria-expanded=\{!collapsed\}\s+aria-label=\{collapsed \? "Expand section" : "Collapse section"\}/);
  assert.match(builder, /\{sectionCollapseControl\(section\.id, "dark"\)\}/, "the black main bar");
  assert.match(builder, /\{sectionCollapseControl\(section\.id, "light"\)\}/, "the grey sub bar");
  assert.match(builder, /\{count\} \{count === 1 \? "item" : "items"\}/, "a collapsed bar shows an item count");
  assert.match(builder, /const parentCollapsed = Boolean\(section\.parent_section_id && isSectionCollapsed\(section\.parent_section_id\)\);/);
  assert.match(builder, /\{!parentCollapsed \? \(<>\s*<InsertSectionRow[\s\S]*?<\/>\) : null\}\s*\{!selfCollapsed && !parentCollapsed \? \(<>\s*<tr className="bg-zinc-100 text-\[11px\] font-bold uppercase text-zinc-700">[\s\S]*?<\/>\) : null\}\s*\{section\.parent_section_id && sectionsById[^\n]*nextSection\?\.parent_section_id !== section\.parent_section_id \? \(\s*<MainSectionTotalRow/, "the section bar, the column header and the rows fold; the main section total row is never inside a fold");
  // Totals and subtotals never look at the fold state.
  const totals = builder.slice(builder.indexOf("const sectionTotalById = useMemo"), builder.indexOf("const layoutSettings = localLayoutSettings"));
  assert.doesNotMatch(totals.replace(/const \{ sectionSizeById[\s\S]*$/, ""), /collapsedSections|isSectionCollapsed/);
  assert.doesNotMatch(read("lib/local/quotation-workspace.ts"), /collapsed|compact/i);
  assert.match(builder, /Collapse all sections/);
  assert.match(builder, /Expand all sections/);
});

test("adding something to a collapsed section opens it again (no new write path)", () => {
  assert.match(builder, /const grownCollapsedIds = \[\.\.\.collapsedSections\]\.filter\(\(\[id, size\]\) => \(sectionSizeById\.get\(id\) \?\? 0\) > size\)/);
  assert.match(builder, /const isSectionCollapsed = \(sectionId: string\) => collapsedSections\.has\(sectionId\) && \(sectionSizeById\.get\(sectionId\) \?\? 0\) <= \(collapsedSections\.get\(sectionId\) \?\? 0\)/);
});

test("the quotation sheet table, header clusters and shared pieces keep working; saved-data files are untouched", () => {
  assert.match(header, /data-builder-header-cluster="tools"/);
  assert.match(header, /data-builder-header-cluster="actions"/);
  let changed: string[];
  try {
    const base = execFileSync("git", ["merge-base", "HEAD", "origin/main"], { encoding: "utf8" }).trim();
    changed = execFileSync("git", ["diff", "--name-only", base, "HEAD"], { encoding: "utf8" }).split("\n").map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  for (const file of changed) assert.doesNotMatch(file, /^app\/|^lib\/(quotation-pricing|local\/quotation-workspace)|\.sql$|quotation-pdf|export-quotation|presentation/, `${file} must stay untouched`);
});
