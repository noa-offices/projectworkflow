import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const builder = read("components/quotations/local-quotation-builder.tsx");
const bar = read("components/quotations/local-bulk-action-bar.tsx");
const handlers = builder.slice(builder.indexOf("// ── Bulk row actions (local builder only)"), builder.indexOf("// ── end of bulk row actions ──"));
const commitFn = builder.slice(builder.indexOf("  function commit("), builder.indexOf("  function restoreWorkspaceFromHistory"));

test("row checkbox: inside the existing S. No. cell, only on numbered rows, keyboard reachable, hidden in print; no new column", () => {
  assert.match(builder, /case "s_no":\n\s*return <td key=\{column\.key\} className=\{`\$\{compactCellClassName\} break-words text-center text-xs`\}>\{rowSerial \? <input type="checkbox" checked=\{selectedRowIds\.has\(item\.id\)\}[^\n]*onClick=\{\(event\) => toggleRowSelected\(item\.id, event\.shiftKey\)\} aria-label=\{`Select row \$\{rowSerial\}`\} className="[^"]*print:hidden" \/> : null\}\{rowSerial \|\| "-"\}<\/td>;/);
  const columns = builder.slice(builder.indexOf("const allColumns = ["), builder.indexOf("];", builder.indexOf("const allColumns = [")));
  assert.doesNotMatch(columns, /select/i, "no selection column added to the table settings");
  assert.match(builder, /const rowSerial = rowSerialByItemId\.get\(item\.id\) \?\? 0;/, "the S. No. rule (isSerialCountedLine) decides which rows can be selected");
  assert.match(builder, /<tr\n\s+data-row-id=\{item\.id\}\n\s+className=\{`align-middle[^\n]*\n\s+data-selected=\{selectedRowIds\.has\(item\.id\) \? "true" : undefined\}/);
  assert.match(builder, /"@media screen \{ tr\[data-selected=\\"true\\"\] > td \{ background-color: rgb\(240 249 255\); \} \}"/, "a subtle screen-only highlight");
});

test("selection helpers: section select-all next to the chevron on sub bars, Shift range over the visible order, folded sections excluded", () => {
  assert.match(builder, /\{sectionCollapseControl\(section\.id, "light"\)\}\n\s*\{sectionSelectControl\(section\.id\)\}/);
  assert.match(handlers, /aria-label="Select all rows in this section"/);
  assert.match(handlers, /const visibleSelectableRowIds = useMemo/);
  assert.match(handlers, /return !folded\(sectionId\) && !\(parentId && folded\(parentId\)\);/);
  assert.match(handlers, /if \(withRange && from >= 0 && to >= 0\) \{\s*for \(const id of visibleSelectableRowIds\.slice/);
  assert.match(handlers, /const activeSelectedIds = selectableRowIds\.filter\(\(id\) => selectedRowIds\.has\(id\)\);/, "rows that no longer exist drop out of the selection");
});

test("selection is plain React state: never saved, not in the workspace, undo history or storage", () => {
  assert.match(builder, /const \[selectedRowIds, setSelectedRowIds\] = useState<Set<string>>\(\(\) => new Set\(\)\);/);
  for (const source of [handlers, bar]) assert.doesNotMatch(source, /localStorage|sessionStorage|layout_settings|cell_layout/);
  assert.doesNotMatch(builder, /commit\([^\n]*selectedRowIds|selectedRowIds\s*:/);
  assert.doesNotMatch(commitFn, /selectedRowIds|setSelectedRowIds/);
});

test("each action runs the existing row helpers inside ONE history step and clears the selection", () => {
  assert.match(commitFn, /const historyOptions = withHistoryBatch\(historyBatchRef\.current, options\);/);
  assert.match(commitFn, /const canMerge = canMergeHistory\(historyGroupRef\.current, historyOptions, now, localHistoryMergeWindowMs\);/);
  assert.match(commitFn, /historyGroupRef\.current = nextHistoryGroup\(historyGroupRef\.current, historyOptions, canMerge, now\);/);
  assert.match(handlers, /runInHistoryBatch\(historyBatchRef, \(\) => \{\s*for \(const item of eligible\) updateItem\(item\.id, bulkPercentPatch\(parsed\.value\)\);/, "the single-row editor path");
  assert.match(handlers, /runInHistoryBatch\(historyBatchRef, \(\) => \{\s*for \(const id of plan\.ids\) removeItem\(id\);/, "the single-row delete");
  assert.match(handlers, /commit\(\(current\) => duplicateRowsBelow\(current, ids,/);
  assert.match(handlers, /const result = moveRowsToSectionEnd\(current, ids, target\);/);
  assert.equal((handlers.match(/finishBulkAction\(/g) ?? []).length, 5, "every action (and the helper itself) clears the selection");
  assert.match(handlers, /if \(!parsed\.ok\) \{\s*setBulkMessage\(parsed\.message\);\s*return;/, "invalid input: a message and nothing else");
});

test("action bar: the buttons, inline delete confirmation with counts, no browser dialogs, screen only", () => {
  for (const label of ["selected", "Set discount %", ">Apply<", ">Duplicate<", "Move to section...", ">Move<", ">Delete<", ">Cancel<", ">Clear<"]) assert.ok(bar.includes(label), label);
  assert.match(bar, /\{confirmingDelete \? \([\s\S]*?\{deleteQuestion\}[\s\S]*?onClick=\{onConfirmDelete\}/);
  assert.doesNotMatch(bar + handlers, /window\.confirm|window\.alert|\bconfirm\(|\balert\(/);
  assert.match(bar, /fixed inset-x-0 bottom-3 z-30[^"]*print:hidden/);
  assert.match(builder, /onConfirmDelete=\{deleteSelectedRows\}/);
  assert.match(builder, /deleteQuestion=\{bulkDelete\.question\}/);
  assert.match(builder, /onAskDelete=\{\(\) => setBulkConfirmingDelete\(true\)\}/);
});

test("local builder only, and no price code in the builder diff", () => {
  for (const path of ["app/quotations/[id]/builder/page.tsx", "app/api/export-quotation/route.ts", "components/quotations/quotation-pdf-document.tsx", "lib/quotations/presentation-pptx.ts", "lib/local/quotation-workspace.ts"]) {
    assert.doesNotMatch(read(path), /bulk-row-actions|history-batch|LocalBulkActionBar/, path);
  }
  const lib = read("lib/local/bulk-row-actions.ts");
  assert.doesNotMatch(lib, /workspaceTotals|itemLinePricing|workspaceItemDisplayPricing|quotation-pricing/, "the bulk helpers never compute a price");
});
