import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const builder = readFileSync(new URL("../../components/quotations/local-quotation-builder.tsx", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const header = builder.slice(builder.indexOf('<header className="sticky top-0 z-20'), builder.indexOf("</header>"));
const tools = header.slice(header.indexOf('data-builder-header-cluster="tools"'), header.indexOf('data-builder-header-cluster="actions"'));
const actions = header.slice(header.indexOf('data-builder-header-cluster="actions"'));

test("header: still sticky, same z-index and the same two-row-free structure (one controls group)", () => {
  assert.match(header, /^<header className="sticky top-0 z-20 border-b border-zinc-300 bg-white">/);
  assert.equal((header.match(/data-builder-header="controls"/g) ?? []).length, 1);
  assert.doesNotMatch(header, /<div className="flex justify-start xl:justify-end">\s*<div className="flex border border-zinc-300 text-xs font-semibold">/, "the Client/Internal toggle is no longer alone in a second row");
});

test("tools cluster: Undo, Redo, Columns and the Client/Internal toggle, with the same handlers", () => {
  assert.match(tools, /onClick=\{undoLastChange\}\s+disabled=\{!historyPast\.length\}/);
  assert.match(tools, /onClick=\{redoLastChange\}\s+disabled=\{!historyFuture\.length\}/);
  assert.match(tools, /buttonLabel="Columns"/);
  assert.match(tools, /openToolbarDropdown === "columns"/);
  assert.match(tools, /onClick=\{\(\) => setView\("client"\)\}[^\n]*>Client View<\/button>/);
  assert.match(tools, /onClick=\{\(\) => setView\("internal"\)\}[^\n]*>Internal View<\/button>/);
  assert.ok(tools.indexOf("undoLastChange") < tools.indexOf("redoLastChange") && tools.indexOf("redoLastChange") < tools.indexOf('buttonLabel="Columns"') && tools.indexOf('buttonLabel="Columns"') < tools.indexOf('setView("client")'));
  assert.doesNotMatch(tools, /saveToSoftware|buttonLabel="Downloads"|buttonLabel="More"/);
});

test("actions cluster: Save to Software (primary green), Downloads, Summary, More, Final Total at the right end", () => {
  assert.match(actions, /onClick=\{\(\) => void saveToSoftware\(\)\} disabled=\{isPending\} className="inline-flex h-9 items-center bg-emerald-900[^"]*">Save to Software<\/button>/);
  const order = ["Save to Software", 'buttonLabel="Downloads"', "Summary", 'buttonLabel="More"', "Final Total:"].map((text) => actions.indexOf(text));
  assert.ok(order.every((position) => position >= 0), "every button is still there");
  assert.deepEqual([...order].sort((a, b) => a - b), order, "left-to-right order");
  assert.match(actions, /openToolbarDropdown === "downloads"/);
  assert.match(actions, /openToolbarDropdown === "more"/);
  assert.match(actions, /Final Total: \{formatWorkspaceMoney\(workspace\.currency, workspace\.totals\.grand_total, readPricingRule\(workspace\.layout_settings\)\)\}/);
  assert.match(actions, /href=\{`\/quotations\/\$\{workspace\.server_quotation_id\}`\}[^>]*>\s*Summary/);
});

test("identity cluster keeps the status badge and the save-state chip; 'Local Builder' moved into the More menu", () => {
  const identity = header.slice(0, header.indexOf('data-builder-header="controls"'));
  assert.match(identity, /<StatusBadge status=\{workspace\.status\} \/>/);
  assert.match(identity, /\{statusText\(workspace, localDraftSaved, saveState\)\}/);
  assert.match(identity, /workspace\.has_unsaved_changes\s*\? "border-amber-400 bg-amber-100 text-amber-950"/, "the unsaved warning is kept and stronger");
  assert.doesNotMatch(identity, />Local Builder</);
  const more = actions.slice(actions.indexOf('buttonLabel="More"'));
  assert.match(more, /<p [^>]*>Local Builder mode<\/p>/);
  assert.ok(more.indexOf("Local Builder mode") < more.indexOf("Export Backup JSON"), "a small label at the top of the menu");
  assert.match(more, /onClick=\{exportBackup\}/);
  assert.match(more, /importRef\.current\?\.click\(\)/);
});

test("dropdowns are not clipped: no overflow rule on the header, and the wide Columns panel opens to the right of its button", () => {
  assert.doesNotMatch(header.slice(0, 400), /overflow-/);
  assert.match(header, /absolute right-0 xl:left-0 xl:right-auto z-30 mt-2 flex w-\[760px\] max-w-\[calc\(100vw-2rem\)\]/);
});
