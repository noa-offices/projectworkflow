import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const builder = read("components/quotations/local-quotation-builder.tsx");
const page = read("app/quotations/[id]/local-builder/page.tsx");
const header = builder.slice(builder.indexOf('<header className="sticky top-0 z-20'), builder.indexOf("</header>"));
const tools = header.slice(header.indexOf('data-builder-header-cluster="tools"'), header.indexOf('data-builder-header-cluster="actions"'));
const checksStart = tools.indexOf("Checks\n");
const panel = tools.slice(tools.indexOf("data-pre-send-checks"));

test("Checks button: in the tools cluster after Compact, with count badge states and an accessible name", () => {
  assert.ok(tools.indexOf(">\n                Compact\n              </button>") > 0 && tools.indexOf("Compact") < checksStart, "after Compact");
  assert.ok(checksStart < tools.indexOf('setView("client")'), "before the view toggle");
  assert.match(tools, /bg-red-600[^>]*>\{preSendChecks\.length\}/, "red-ish with errors");
  assert.match(tools, /bg-amber-400[^>]*>\{preSendChecks\.length\}/, "amber with only warnings");
  assert.match(tools, /aria-hidden="true" className="font-bold text-emerald-700">&#10003;/, "a green check and no number when fine");
  assert.match(tools, /<span className="sr-only">\{preSendChecks\.length \? `\$\{preSendErrorCount\} errors, \$\{preSendWarningCount\} warnings` : "no problems"\}<\/span>/);
  assert.match(tools, /open=\{openToolbarDropdown === "checks"\}\s+onOpenChange=\{\(open\) => setOpenToolbarDropdown\(open \? "checks" : null\)\}/, "the existing dropdown pattern, so click-away works");
});

test("panel: anchored like the Columns panel, viewport safe and scrollable, with the reminder text", () => {
  assert.match(tools, /className="relative xl:static"[\s\S]{0,400}buttonLabel=\{\(\s*<>\s*Checks/);
  assert.match(panel, /^data-pre-send-checks className="absolute right-0 xl:right-3 xl:top-full z-30 mt-2 xl:mt-1 flex w-\[560px\] max-w-\[calc\(100vw-2rem\)\] xl:max-w-\[calc\(100vw-1\.5rem\)\] max-h-\[calc\(100dvh-10rem\)\] flex-col overflow-hidden /);
  assert.match(panel, /Check before sending/);
  assert.match(panel, /These are reminders\. Nothing is blocked\./);
  assert.match(panel, /<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">/);
  assert.match(panel, /check\.severity === "error" \? "Fix" : "Check"/);
});

test("Go to row: opens a folded section first, scrolls and flashes the row; document items press the existing Document Setup button", () => {
  const go = builder.slice(builder.indexOf("function goToCheckTarget"), builder.indexOf("const sectionCollapseControl"));
  assert.match(go, /setOpenToolbarDropdown\(null\)/);
  assert.match(go, /button\.textContent\?\.trim\(\) === "Document Setup"\)\?\.click\(\)/);
  assert.match(go, /next\.delete\(sectionId\);\s*if \(parentId\) next\.delete\(parentId\);/, "the section and its main section are opened first");
  assert.match(go, /\[data-section-id="\$\{target\.id\}"\]/);
  assert.match(go, /\[data-row-id="\$\{target\.id\}"\]/);
  assert.match(go, /scrollIntoView\(\{ behavior: "smooth", block: "center" \}\)/);
  assert.match(go, /outline = "3px solid #f59e0b"/);
  assert.match(go, /\{check\.target\.kind|window\.setTimeout\(\(\) => \{ element\.style\.outline = ""/);
  assert.match(builder, /<tr\n\s+data-row-id=\{item\.id\}\n\s+className=\{`align-middle/);
  assert.equal((builder.match(/data-section-id=\{section\.id\}/g) ?? []).length, 2, "the main bar and the sub bar");
  assert.match(panel, /\{check\.target\.kind === "document" \? "Open Document Setup" : "Go to row"\}/);
});

test("the checks only read: no writes, no storage, no price code, nothing blocked, not on the server builder or exports", () => {
  const block = builder.slice(builder.indexOf("// Pre-send reminders"), builder.indexOf("const sectionCollapseControl"));
  assert.ok(block.length > 200);
  assert.doesNotMatch(block, /commit\(|updateItem\(|persistWorkspace|localStorage|sessionStorage|layout_settings|saveToSoftware|setWorkspace/);
  assert.match(block, /useMemo\(\(\) => runPreSendChecks\(/);
  assert.match(block, /rows: preSendRowsFromWorkspace\(workspace, rowSerialByItemId, itemCountsInLocalTotals\)/, "rows come from the read-only adapter");
  const adapter = read("lib/local/pre-send-rows.ts");
  assert.match(adapter, /unitPrice: workspaceItemDisplayPricing\(workspace, item\)\.unitPrice/, "the builder's own displayed unit price is read, not recomputed");
  assert.doesNotMatch(adapter, /commit\(|localStorage|sessionStorage|itemLinePricing|workspaceTotals/);
  assert.match(block, /finalTotal: workspace\.totals\.grand_total/, "the existing computed total");
  const lib = read("lib/quotations/pre-send-checks.ts");
  assert.doesNotMatch(lib, /quotation-pricing|itemLinePricing|workspaceTotals/);
  // Nothing else uses the check result, so no action can be blocked by it.
  const uses = [...builder.matchAll(/preSendChecks|preSendErrorCount|preSendWarningCount/g)].length;
  assert.ok(uses > 0);
  assert.doesNotMatch(builder, /disabled=\{[^}]*preSend/);
  for (const path of ["app/quotations/[id]/builder/page.tsx", "app/api/export-quotation/route.ts", "components/quotations/quotation-pdf-document.tsx", "lib/quotations/presentation-pptx.ts"]) {
    assert.doesNotMatch(read(path), /pre-send-checks|runPreSendChecks/, path);
  }
});

test("document facts come from the existing resolved document setup; the numbering of rows no longer depends on folded sections", () => {
  assert.match(page, /preSendFacts=\{\{\s*clientName: resolvedDocumentSetup\.header\.clientDisplayName,\s*contactEmail: resolvedDocumentSetup\.header\.contactEmail,\s*paymentTerms: resolvedDocumentSetup\.commercial\.paymentTerms,\s*validity: resolvedDocumentSetup\.commercial\.validity,\s*deliveryTerms: resolvedDocumentSetup\.commercial\.deliveryTerms,/);
  assert.match(builder, /const rowSerial = rowSerialByItemId\.get\(item\.id\) \?\? 0;/);
  assert.doesNotMatch(builder, /\+\+runningSerialNumber/);
});

test("adapter: numbered rows only, the displayed unit price, sorted by row number", async () => {
  const { preSendRowsFromWorkspace } = await import("./pre-send-rows");
  const item = (id: string, extra: Record<string, unknown>) => ({ id, item_type: "product", item_name_snapshot: id, model_snapshot: null, item_code_snapshot: null, qty: 2, unit_price: 500, discount_type: "amount", discount_value: 0, proposed_image_url_snapshot: null, specification_snapshot: " ", ...extra });
  const workspace = { items: [item("b", {}), item("note", { item_type: "note" }), item("a", { unit_price: 0 })], metadata: {}, layout_settings: {} };
  const rows = preSendRowsFromWorkspace(workspace as never, new Map([["a", 1], ["b", 2]]), () => true);
  assert.deepEqual(rows.map((row) => [row.id, row.rowNumber, row.unitPrice, row.hasImage, row.hasSpecification]), [["a", 1, 0, false, false], ["b", 2, 500, false, false]]);
});
