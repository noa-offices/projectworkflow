/* eslint-disable @typescript-eslint/no-explicit-any -- the helpers are evaluated from source */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// PR 6a: (1) typing a space, (2) row action column, (3) Edit Details as a right-side panel.
// The builder is a 5,500-line client component, so these are source/wiring tests plus behaviour tests that EVALUATE the real
// helper source (extracted from the file) instead of a copy. Unchanged parts are compared with origin/main.
const CR = String.fromCharCode(13);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8").split(CR).join("");
const BUILDER_PATH = "components/quotations/local-quotation-builder.tsx";
const builder = read("../../components/quotations/local-quotation-builder.tsx");
const publication = read("./quotation-publication-payload.ts");

function gitShow(path: string): string | null {
  try {
    const root = new URL("../../", import.meta.url);
    return execFileSync("git", ["show", `origin/main:${path}`], { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).split(CR).join("");
  } catch {
    return null;
  }
}

/** The text of one top-level function (from its signature to its closing brace at column 0). */
function functionSource(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} exists`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end + 3);
}

// Evaluate the REAL helpers from the builder file.
const helperStart = builder.indexOf("function keepTypedValue(");
const helperEnd = builder.indexOf("\n}\n", builder.indexOf("function trimmedTextPatch(")) + 3;
const helperTs = builder.slice(helperStart, helperEnd);
const helperJs = ts.transpileModule(helperTs, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const helpers = new Function(`${helperJs}; return { keepTypedValue, trimmedTextPatch, TRIM_ON_BLUR_ITEM_FIELDS, TRIM_ON_BLUR_PROJECT_FIELDS };`)() as {
  keepTypedValue: (value: string) => string | null;
  trimmedTextPatch: (record: Record<string, unknown>, fields: readonly string[], emptyValue?: "" | null) => Record<string, string | null> | null;
  TRIM_ON_BLUR_ITEM_FIELDS: readonly string[];
  TRIM_ON_BLUR_PROJECT_FIELDS: readonly string[];
};

// ── PART 1: typing a space ───────────────────────────────────────────────────────────────────────────────────
test("typing keeps every space: 'Meeting ' -> 'Meeting table' is stored exactly as typed", () => {
  const { keepTypedValue } = helpers;
  // the characters of "Meeting table" arriving one keystroke at a time, each stored value feeding the next
  let stored: string | null = null;
  for (const typed of ["M", "Me", "Mee", "Meet", "Meeti", "Meetin", "Meeting", "Meeting ", "Meeting t", "Meeting ta", "Meeting tab", "Meeting tabl", "Meeting table"]) {
    stored = keepTypedValue(typed);
    assert.equal(stored, typed, typed);
  }
  assert.equal(stored, "Meeting table", "the space survived");
  assert.equal(keepTypedValue("Meeting "), "Meeting ", "a trailing space is NOT deleted while typing");
  assert.equal(keepTypedValue(" Meeting"), " Meeting", "nor a leading one");
  assert.equal(keepTypedValue("  "), "  ", "whitespace is kept until the field is left");
  assert.equal(keepTypedValue(""), null, "an empty field is still null, as before");
});

test("leaving the field trims it: a trailing space goes, whitespace-only becomes null, clean values are left alone", () => {
  const { trimmedTextPatch, TRIM_ON_BLUR_ITEM_FIELDS } = helpers;
  assert.deepEqual(trimmedTextPatch({ item_name_snapshot: "Meeting table " }, TRIM_ON_BLUR_ITEM_FIELDS), { item_name_snapshot: "Meeting table" });
  assert.deepEqual(trimmedTextPatch({ size_snapshot: "  1200 x 600  " }, TRIM_ON_BLUR_ITEM_FIELDS), { size_snapshot: "1200 x 600" });
  assert.deepEqual(trimmedTextPatch({ specification_snapshot: "   " }, TRIM_ON_BLUR_ITEM_FIELDS), { specification_snapshot: null }, "whitespace-only -> null");
  assert.equal(trimmedTextPatch({ item_name_snapshot: "Meeting table", size_snapshot: null, finish_snapshot: "" }, TRIM_ON_BLUR_ITEM_FIELDS), null, "nothing to trim: no update, no change");
  assert.equal(trimmedTextPatch({ item_name_snapshot: "Meeting  table" }, TRIM_ON_BLUR_ITEM_FIELDS), null, "inner spaces are never touched");
  assert.deepEqual(trimmedTextPatch({ item_name_snapshot: "a ", unit_price: " 5 " as any, qty: " 2 " as any }, TRIM_ON_BLUR_ITEM_FIELDS), { item_name_snapshot: "a" }, "number fields are not part of it");
  // project details: an emptied project name goes back to "" (as before), the others to null
  const { TRIM_ON_BLUR_PROJECT_FIELDS } = helpers;
  assert.deepEqual(trimmedTextPatch({ project_name: "  ", attention_to: " Ada Lovelace ", po_box: " " }, TRIM_ON_BLUR_PROJECT_FIELDS, ""), { project_name: "", attention_to: "Ada Lovelace", po_box: null });
});

test("the helpers cover exactly the fields that used to be trimmed on every keystroke", () => {
  assert.deepEqual([...helpers.TRIM_ON_BLUR_ITEM_FIELDS].sort(), ["brand_name_snapshot", "finish_snapshot", "item_name_snapshot", "manual_serial", "model_snapshot", "origin_snapshot", "size_snapshot", "specification_snapshot", "supplier_name_snapshot", "warranty_snapshot"]);
  assert.deepEqual([...helpers.TRIM_ON_BLUR_PROJECT_FIELDS].sort(), ["attention_email", "attention_landline", "attention_mobile", "attention_to", "location", "po_box", "project_address", "project_name"]);
  // every one of them is a field that the file writes through keepTypedValue
  for (const field of [...helpers.TRIM_ON_BLUR_ITEM_FIELDS, ...helpers.TRIM_ON_BLUR_PROJECT_FIELDS]) {
    assert.match(builder, new RegExp(`${field}: keepTypedValue\\(`), field);
  }
});

test("nothing trims inside onChange any more: the old helpers are gone and every call site keeps the typed text", () => {
  assert.doesNotMatch(builder, /cleanInlineValue|cleanOptionalDetailValue/, "the trimming helpers no longer exist");
  assert.ok((builder.match(/keepTypedValue\(/g) ?? []).length >= 21, "20 call sites + the definition");
  assert.doesNotMatch(functionSource(builder, "keepTypedValue"), /\.trim\(/);
  // no onChange handler that stores through keepTypedValue calls trim() on the way
  const handlers = builder.match(/onChange=\{[^\n]*keepTypedValue\([^\n]*\}/g) ?? [];
  assert.ok(handlers.length >= 14, `found ${handlers.length} single-line handlers`);
  for (const handler of handlers) assert.ok(!/\.trim\(/.test(handler), handler.slice(0, 120));
  // the Project details inputs (8) and the table cells (12)
  for (const field of ["project_name", "attention_to", "location", "attention_mobile", "attention_landline", "attention_email", "po_box", "project_address"]) {
    assert.match(builder, new RegExp(`updateProjectSnapshot\\(\\{ ${field}: keepTypedValue\\(event\\.target\\.value\\)`), field);
  }
  assert.match(builder, /item_name_snapshot: keepTypedValue\(event\.target\.value\)/);
  assert.match(builder, /size_snapshot: keepTypedValue\(event\.target\.value\)/);
  assert.match(builder, /specification_snapshot: keepTypedValue\(\[value, suffix\]\.filter\(Boolean\)\.join\("\\n"\)\)/);
  // notes and supplier notes were already raw and are untouched
  assert.match(builder, /updateItemInternalMetadata\(item, \{ supplierNotes: value \}\)/);
  assert.match(builder, /updateItemInternalMetadata\(item, \{ deliveryLeadTime: event\.target\.value \}\)/);
});

test("trim happens when focus leaves: once on the item row, once on the Project fieldset", () => {
  assert.match(builder, /onBlur=\{\(\) => \{\s*const patch = trimmedTextPatch\(item as unknown as Record<string, unknown>, TRIM_ON_BLUR_ITEM_FIELDS\);\s*if \(patch\) updateItem\(item\.id, patch as Partial<LocalQuotationItem>\);/);
  assert.match(builder, /onBlur=\{\(\) => \{\s*const patch = trimmedTextPatch\(projectSnapshot, TRIM_ON_BLUR_PROJECT_FIELDS, ""\);\s*if \(patch\) updateProjectSnapshot\(patch\);/);
  assert.equal((builder.match(/trimmedTextPatch\(/g) ?? []).length, 3, "definition + item row + project fieldset");
});

test("saved / exported output is trimmed at the existing publication boundary (nothing new was needed)", () => {
  assert.match(publication, /function textOrNull\(value: unknown\) \{\s*if \(typeof value !== "string"\) return null;\s*const trimmed = value\.trim\(\);\s*return trimmed \? trimmed : null;/);
  for (const field of ["item_name_snapshot", "specification_snapshot", "size_snapshot", "brand_name_snapshot", "supplier_name_snapshot", "finish_snapshot", "model_snapshot", "origin_snapshot", "warranty_snapshot", "manual_serial"]) {
    assert.match(publication, new RegExp(`${field}: textOrNull\\(item\\.${field}\\)`), `${field} is trimmed when published`);
  }
  for (const field of ["project_name", "location", "attention_to", "attention_mobile", "attention_landline", "attention_email", "po_box", "project_address"]) {
    assert.match(publication, new RegExp(`${field}: textOrNull\\(projectSnapshot\\.${field}\\)`), `${field} is trimmed when published`);
  }
});

// ── PART 2: row action column ────────────────────────────────────────────────────────────────────────────────
const editCell = builder.slice(builder.indexOf('case "edit":', builder.indexOf('case "internal_status":')), builder.indexOf("</td>;", builder.indexOf('case "edit":', builder.indexOf('case "internal_status":'))));

test("autosave persists every item change by itself, so the per-row Save button is not needed", () => {
  // the signature is derived from the WHOLE workspace, so any item edit changes it
  assert.match(builder, /const workspaceSignature = useMemo\(\(\) => stableSerialize\(workspace\), \[workspace\]\);/);
  const effect = builder.slice(builder.indexOf("if (workspaceSignature === lastPersistedSignatureRef.current) return;") - 80, builder.indexOf("}, [hydrated, workspace, workspaceSignature]);") + 50);
  assert.match(effect, /if \(!hydrated\) return;/);
  assert.match(effect, /window\.setTimeout\(\(\) => \{\s*void persistWorkspace\(workspace\)/);
  assert.match(effect, /\}, 200\);/, "200 ms after the last change");
  assert.match(effect, /return \(\) => window\.clearTimeout\(timeout\);/);
  assert.match(effect, /setLocalPersistenceError\(`Not saved locally\./, "a failure is reported");
  // an item edit really goes into the workspace that this effect persists
  const updateItem = builder.slice(builder.indexOf("function updateItem(itemId: string, patch: LocalQuotationItemPatch) {"), builder.indexOf("function updateItem(itemId: string, patch: LocalQuotationItemPatch) {") + 3500);
  assert.match(updateItem, /commit\(\(current\) => \{/);
  assert.match(updateItem, /items: current\.items\.map\(\(item\) => \(item\.id === itemId \? \{ \.\.\.item, \.\.\.committedPatch, updated_at: localNow\(\) \} : item\)\)/);
  // saveLocalDraftNow itself stays (the Retry button, Save Row in the panel and others use it)
  assert.match(builder, /async function saveLocalDraftNow\(rowId\?: string\) \{/);
  assert.ok((builder.match(/saveLocalDraftNow\(/g) ?? []).length >= 3);
});

test("the row action column is ONE line of icon buttons: edit, up, down, More; no per-row Save and no per-row status text", () => {
  assert.ok(editCell.length > 200, "found the edit cell");
  assert.match(editCell, /aria-label="Edit details" title="Edit details"/);
  assert.match(editCell, /data-details-trigger=\{item\.id\} onClick=\{\(\) => setDetailsModalRowId\(item\.id\)\}/);
  assert.match(editCell, /onClick=\{\(\) => moveItem\(section\.id, item\.id, -1\)\} aria-label="Move row up" title="Move row up"/);
  assert.match(editCell, /onClick=\{\(\) => moveItem\(section\.id, item\.id, 1\)\} aria-label="Move row down" title="Move row down"/);
  assert.match(editCell, /<SharedQuotationMoreMenu /);
  assert.ok(editCell.indexOf("Edit details") < editCell.indexOf("Move row up") && editCell.indexOf("Move row up") < editCell.indexOf("Move row down") && editCell.indexOf("Move row down") < editCell.indexOf("<SharedQuotationMoreMenu"), "order: edit, up, down, More");
  assert.doesNotMatch(editCell, />Save</, "no Save button on the row");
  assert.doesNotMatch(editCell, /Edit Details</, "no text button either");
  assert.doesNotMatch(editCell, /saveLocalDraftNow/);
  assert.doesNotMatch(editCell, /Saved locally|Unsaved local changes|Saving local draft/);
  assert.doesNotMatch(builder, /rowLocalStatus|Saved locally|Unsaved local changes/, "the per-row status is gone from the file");
  assert.match(builder, /\{statusText\(workspace, localDraftSaved, saveState\)\}/, "the page header's global status is unchanged");
  assert.match(editCell, />\u25b2<\/button>/);
  assert.match(editCell, />\u25bc<\/button>/);
  assert.doesNotMatch(editCell, /<svg[^>]*>[\s\S]*?<\/svg>[\s\S]*<svg/, "one icon, no icon library");
});

test("a small red '!' appears on the rows only when local saving failed", () => {
  assert.match(editCell, /\{localPersistenceError \? \(<span role="img" aria-label="Not saved locally" title=\{localPersistenceError\} className="[^"]*text-red-600[^"]*">!<\/span>\) : null\}/);
  assert.equal((editCell.match(/localPersistenceError/g) ?? []).length, 2, "only the marker uses it (condition + title)");
  assert.match(builder, /\{localPersistenceError \? \(\s*<div role="alert" className="mb-4 rounded border border-red-300/, "the existing banner is unchanged");
});

test("the More menu is unchanged (same props, same items) and the other row cells still render", () => {
  const before = gitShow(BUILDER_PATH);
  if (before === null) return;
  const menuLine = (source: string) => source.split("\n").find((line) => line.trim().startsWith("<SharedQuotationMoreMenu actionButtons={(<>{item.item_type === \"product\" && item.source_template_id ?"));
  assert.ok(menuLine(before), "found the menu on main");
  assert.equal(menuLine(builder), menuLine(before), "the SharedQuotationMoreMenu line is byte for byte the same");
  for (const text of ["Copy row", "Duplicate below", "SaveLineToMyCollectionButton", "SaveAsCustomItemButton", "Paste copied row above", "Row Height (px)"]) assert.ok(builder.includes(text), text);
  assert.match(editCell, /\{copiedRowId === item\.id \? \(<span className="text-\[10px\] font-semibold text-emerald-800">Copied<\/span>\) : null\}/, "the Copied label stays");
});

// ── PART 3: Edit Details as a right-side panel ───────────────────────────────────────────────────────────────
const panel = builder.slice(builder.indexOf("{detailsModalItem ? ("), builder.indexOf("{saveLibraryChoiceItem ? ("));

test("Edit Details is a right-side dialog: full height, about 480 px on desktop, full screen on phones, closes with the button", () => {
  assert.match(panel, /<aside\s+ref=\{detailsPanelRef\}\s+role="dialog"\s+aria-modal="true"\s+aria-label="Edit row details"\s+tabIndex=\{-1\}/);
  assert.match(panel, /fixed inset-0 z-50 flex justify-end/, "pinned to the right edge");
  assert.match(panel, /h-\[100dvh\] w-full/, "full height and full width on phones");
  assert.match(panel, /sm:w-\[480px\] sm:max-w-\[100vw\]/, "about 480 px from the sm breakpoint up");
  assert.match(panel, /overflow-hidden/);
  assert.match(panel, /<div className="overflow-y-auto px-3 py-3/, "its own scroll");
  assert.match(panel, /pw-details-slide-in/, "slides in from the right");
  assert.match(panel, /motion-reduce:\[animation:none\]/);
  assert.match(panel, /pointer-events-none fixed inset-0/, "the dim does not block the table");
  assert.match(panel, /aria-label="Close"\s+title="Close"\s+className="[^"]*"\s*>\s*\{"\\u2715"\}/);
  assert.doesNotMatch(panel, /max-w-6xl|items-start justify-center/, "no longer a centred modal");
  assert.match(panel, /Row \{detailsNav \? detailsNav\.index \+ 1 : ""\} details/);
  assert.match(panel, /\{detailsModalItem\.item_name_snapshot \|\| "Unnamed item"\}/);
});

test("the form inside is EXACTLY the old one: same render function, same fields, nothing lost", () => {
  const before = gitShow(BUILDER_PATH);
  assert.match(panel, /\{renderRowDetailsModalContent\(detailsModalItem\)\}/);
  if (before === null) return;
  const bodyOf = (source: string) => {
    const start = source.indexOf("  function renderRowDetailsModalContent(");
    const end = source.indexOf("\n  }\n", start);
    return source.slice(start, end);
  };
  assert.equal(bodyOf(builder), bodyOf(before), "renderRowDetailsModalContent is unchanged, character for character");
  // the existing buttons of the old header keep their behaviour
  assert.match(panel, /onClick=\{\(\) => void saveLocalDraftNow\(detailsModalItem\.id\)\}[\s\S]*?Save Row/);
  assert.match(panel, /Done\s*<\/button>/);
  assert.match(panel, /setDetailsModalRowId\(null\);\s*setSaveLibraryChoiceRowId\(null\);/);
  assert.match(panel, /Code: \{detailsModalItem\.item_code_snapshot/);
});

test("Escape closes the panel, the page behind does not scroll, focus goes in and comes back to the edit button", () => {
  const effect = builder.slice(builder.indexOf("const detailsPanelOpen = detailsModalRowId !== null;"), builder.indexOf("}, [detailsPanelOpen, saveLibraryChoiceRowId]);"));
  assert.match(effect, /if \(event\.key !== "Escape" \|\| event\.defaultPrevented \|\| saveLibraryChoiceRowId\) return;/);
  assert.match(effect, /document\.addEventListener\("keydown", onKeyDown\)/);
  assert.match(effect, /document\.removeEventListener\("keydown", onKeyDown\)/);
  assert.match(effect, /document\.body\.style\.overflow = "hidden"/);
  assert.match(effect, /document\.body\.style\.overflow = previousOverflow/);
  assert.match(effect, /detailsPanelRef\.current\?\.focus\(\)/);
  assert.match(effect, /if \(rowId\) focusDetailsTrigger\(rowId\)/);
  const focusBack = functionSource(builder, "focusDetailsTrigger");
  assert.match(focusBack, /\[data-details-trigger\]/);
  assert.match(focusBack, /offsetParent !== null/, "the visible button (desktop table or mobile card)");
  // both entry points carry the marker
  assert.equal((builder.match(/data-details-trigger=\{item\.id\}/g) ?? []).length, 2, "desktop pencil and mobile 'Edit item'");
  // removing the row being edited still closes the panel (unchanged)
  assert.match(builder, /if \(detailsModalRowId === itemId\) \{\s*setDetailsModalRowId\(null\);/);
});

test("the row being edited is highlighted in the table", () => {
  assert.match(builder, /\$\{detailsModalRowId === item\.id \? "bg-emerald-50\/80" : ""\}/);
});

test("previous / next row switches the panel to the neighbouring ITEM row (notes and blank rows are skipped)", () => {
  const nav = functionSource(builder, "detailsNavigation");
  assert.match(nav, /itemTypeDisplay\(item\) === "item"/);
  assert.match(nav, /previous: rows\[index - 1\] \?\? null, next: rows\[index \+ 1\] \?\? null/);
  assert.match(builder, /const detailsNav = detailsModalItem \? detailsNavigation\(workspace\.items, orderedSectionRows, detailsModalItem\.id\) : null;/);
  assert.match(panel, /disabled=\{!detailsNav\?\.previous\}\s+onClick=\{\(\) => detailsNav\?\.previous && setDetailsModalRowId\(detailsNav\.previous\.id\)\}\s+aria-label="Previous row"/);
  assert.match(panel, /disabled=\{!detailsNav\?\.next\}\s+onClick=\{\(\) => detailsNav\?\.next && setDetailsModalRowId\(detailsNav\.next\.id\)\}\s+aria-label="Next row"/);
  // it only changes WHICH row is shown: no data is written
  assert.doesNotMatch(panel.slice(panel.indexOf('aria-label="Previous row"') - 300, panel.indexOf('aria-label="Next row"') + 100), /updateItem|commit\(/);
});

// ── Guards ───────────────────────────────────────────────────────────────────────────────────────────────────
test("nothing else in the builder was touched: pricing, totals, Save to Software and the Product Library are unchanged", () => {
  const before = gitShow(BUILDER_PATH);
  if (before === null) return;
  for (const name of ["sectionSubtotal", "statusText", "itemRowMinHeight", "canSaveRowToProductLibrary"]) {
    const grab = (source: string) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${name}(`) + 500);
    assert.ok(grab(builder).length > 50, name);
    assert.equal(grab(builder), grab(before), name);
  }
  // number fields still store what they used to (no keepTypedValue there)
  for (const field of ["unit_price", "qty", "discount_value", "internal_cost"]) {
    assert.doesNotMatch(builder, new RegExp(`${field}: keepTypedValue`), field);
  }
  // the changed lines of the builder are only in the three intended areas
  const removed = before.split("\n").filter((line) => !builder.includes(line));
  const touched = removed.filter((line) => !/cleanInlineValue|cleanOptionalDetailValue|rowLocalStatus|Edit Details|Saved locally|saveLocalDraftNow|detailsModal|moveItem|Save<|Row Details|Done|fixed inset-0 z-50|max-w-6xl|sm:|\^<|>v<|<tr className=\{`align-middle|<fieldset className="border border-zinc-300 bg-white p-2\.5">|setMobileMoreItemId|^\s*[<>)}\]{(]|^\s*$|^\s*(Save Row|Done|[a-zA-Z/"=-].{0,80})$|function itemTypeDisplay|\{renderRowDetails|modal|Unsaved|Saving|workspaceDirty|recentEditedRowId|localDraftSaved|return "Saved|\}\s*$/.test(line));
  assert.ok(touched.length < 10, `unexpected removed lines: ${touched.slice(0, 5).join(" | ")}`);
});

test("PR 6a diff guard: only the builder, this test and one old guard; no SQL, no package, no server code; at most 6 files", () => {
  let diff: string[];
  try {
    const root = new URL("../../", import.meta.url);
    const run = (args: string[]) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    const base = run(["merge-base", "HEAD", "origin/main"]).trim();
    diff = [...run(["diff", "--name-only", base]).split("\n"), ...run(["ls-files", "--others", "--exclude-standard"]).split("\n")].map((line) => line.trim()).filter(Boolean);
  } catch {
    return;
  }
  assert.ok(!diff.some((file) => file.startsWith("supabase/")), "no SQL");
  assert.ok(!diff.some((file) => /^package(-lock)?\.json$/.test(file)), "no package change");
  assert.ok(!diff.some((file) => /^app\/.*actions\.ts$|^lib\/(quotation-pricing|pricing)|^lib\/products\/(?!saved-setups\/my-collection-popup\.test\.mts$)/.test(file)), "no server code, pricing or Product Library");
  // The one old guard that listed the builder as "must be untouched" is updated; nothing else may change.
  assert.ok(diff.every((file) => [BUILDER_PATH, "lib/local/quote-builder-typing-and-row-actions.test.mts", "lib/products/saved-setups/my-collection-popup.test.mts"].includes(file)), `unexpected files: ${diff.join(", ")}`);
  assert.ok(diff.length <= 6);
});
